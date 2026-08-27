// =============================================================================
// ModbusChannel.js — Proprietário Único do Socket TCP e Máquina de Estados (FSM)
// Garante 1 Socket Único por Dispositivo, Generation ID e Backoff com Jitter.
//
// POLÍTICA DE RECONEXÃO (Industrial):
//   Um timeout ISOLADO NÃO derruba o socket. Apenas CONSECUTIVE_FAIL_THRESHOLD
//   falhas consecutivas sem nenhuma leitura bem-sucedida no meio disparam
//   a reconexão. Isso evita o loop de connect/disconnect causado por jitter
//   momentâneo de rede ou CLP ocupado (ex: ciclo de scan longo).
// =============================================================================

const ModbusRTU = require('modbus-serial');
const ModbusPriorityQueue = require('./ModbusPriorityQueue');
const logger = require('./ModbusLogger');
const metrics = require('./ModbusMetrics');
const circuitBreaker = require('./ModbusCircuitBreaker');

// Número de falhas consecutivas antes de derrubar o socket e reconectar.
// Um valor de 3 significa: 3 timeouts seguidos sem nenhum sucesso no meio.
const CONSECUTIVE_FAIL_THRESHOLD = 3;

class ModbusChannel {
  constructor(deviceInfo) {
    this.deviceInfo = deviceInfo;
    this.deviceId = deviceInfo.id;
    this.ip = deviceInfo.ip_address;
    this.port = deviceInfo.port || 502;

    // FSM States: STOPPED, DISCONNECTED, CONNECTING, ONLINE, CLOSING, RECOVERING, BACKOFF
    this.state = 'STOPPED';

    // Proprietário Único do Socket
    this.client = null;

    // Generation ID: Incrementado a cada tentativa de conexão para invalidar callbacks antigos
    this.generationId = 0;

    // Fila de Prioridades (P0 - P3)
    this.queue = new ModbusPriorityQueue();

    // Estado interno
    this.inFlight = false;
    this.retryCount = 0;
    this.backoffTimer = null;
    this.executorLoopActive = false;

    // Contador de falhas consecutivas (reseta a cada sucesso)
    this.consecutiveFailures = 0;

    // Callbacks de atualização de dados e eventos
    this.onDataUpdate = null;
    this.onStateChange = null;
  }

  // ---------------------------------------------------------------------------
  // Transição de Estado FSM (Atômica)
  // ---------------------------------------------------------------------------
  setState(newState, reason = '') {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    logger.info(`[FSM Dispositivo ID ${this.deviceId}] ${oldState} ➔ ${newState}${reason ? ' (' + reason + ')' : ''}`, { deviceId: this.deviceId });
    if (this.onStateChange) {
      this.onStateChange(oldState, newState);
    }
  }

  // ---------------------------------------------------------------------------
  // Start / Stop Ciclo de Vida
  // ---------------------------------------------------------------------------
  start() {
    if (this.state !== 'STOPPED') return;
    this.setState('DISCONNECTED', 'Iniciando canal Modbus');
    this.connect();
  }

  stop() {
    this.setState('STOPPED', 'Canal encerrado manualmente');
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.queue.clear();
    this._purgeSocket('Stop solicitado');
  }

  // ---------------------------------------------------------------------------
  // Conexão TCP com Timeout e Purge Seguro
  // ---------------------------------------------------------------------------
  async connect() {
    if (this.state === 'CONNECTING' || this.state === 'ONLINE' || this.state === 'STOPPED') return;

    this.setState('CONNECTING');
    this.generationId++;
    const currentGen = this.generationId;

    // Purga qualquer socket antigo remanescente
    this._purgeSocket('Preparando nova conexão');

    logger.info(`[Modbus Channel] Tentando conectar ID ${this.deviceId} (${this.ip}:${this.port}) [Gen ${currentGen}]...`, { deviceId: this.deviceId, gen: currentGen });

    const client = new ModbusRTU();

    // Timeout de frame: mín 3s, máx 8s — adaptativo ao P95 RTT medido
    const frameTimeout = Math.min(Math.max(3000, Math.round(metrics.getP95RTT() * 2.0 + 1000)), 8000);
    client.setTimeout(frameTimeout);

    // Evento de erro de socket (nível TCP): sempre reconecta
    client.on('error', (err) => {
      if (currentGen !== this.generationId) return;
      logger.warn(`[Modbus Socket Error] ID ${this.deviceId} [Gen ${currentGen}]: ${err.message}`, { deviceId: this.deviceId });
      this._handleConnectionFailure(`Socket error: ${err.message}`, true);
    });

    this.client = client;

    try {
      // Handshake TCP com Hard Timeout de 8s
      const connectPromise = client.connectTCP(this.ip, { port: this.port });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TCP Handshake Timeout (8s)')), 8000)
      );

      await Promise.race([connectPromise, timeoutPromise]);

      if (currentGen !== this.generationId || this.state !== 'CONNECTING') {
        client.close(() => {});
        return;
      }

      client.setID(1);
      this.retryCount = 0;
      this.consecutiveFailures = 0; // Conexão bem-sucedida: zera contador
      metrics.recordReconnect();
      this.setState('ONLINE', 'Handshake TCP concluído');

      // Inicia a malha executora da fila
      this._startExecutorLoop();

    } catch (e) {
      if (currentGen !== this.generationId) return;
      logger.warn(`[Modbus Channel] Falha ao conectar ID ${this.deviceId}: ${e.message}`, { deviceId: this.deviceId });
      this._handleConnectionFailure(e.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Tratamento de Falhas com Exponential Backoff + Jitter
  // forceReconnect=true: falha de transporte TCP, reconecta imediatamente
  // forceReconnect=false: timeout de aplicação, aguarda threshold
  // ---------------------------------------------------------------------------
  _handleConnectionFailure(reason, forceReconnect = false) {
    if (this.state === 'STOPPED' || this.state === 'BACKOFF') return;

    this.consecutiveFailures++;

    if (!forceReconnect && this.consecutiveFailures < CONSECUTIVE_FAIL_THRESHOLD) {
      // Falha isolada — registra mas mantém o socket aberto e continua tentando
      logger.warn(
        `[Modbus] ID ${this.deviceId} — falha ${this.consecutiveFailures}/${CONSECUTIVE_FAIL_THRESHOLD}: "${reason}". Mantendo socket e continuando...`,
        { deviceId: this.deviceId }
      );
      return;
    }

    // Threshold atingido ou erro TCP real — agora sim derruba e reconecta
    logger.warn(
      `[Modbus] ID ${this.deviceId} — ${forceReconnect ? 'Erro TCP' : `${this.consecutiveFailures} falhas consecutivas`}. Reiniciando socket...`,
      { deviceId: this.deviceId }
    );

    this.consecutiveFailures = 0;
    this.setState('RECOVERING', reason);
    this._purgeSocket(reason);

    this.retryCount++;
    this.setState('BACKOFF');

    // Exponential Backoff: 1s, 1.5s, 2.25s... até 30s + jitter (0-500ms)
    const baseDelay = Math.min(1000 * Math.pow(1.5, this.retryCount - 1), 30000);
    const jitter = Math.floor(Math.random() * 500);
    const delay = Math.round(baseDelay + jitter);

    logger.info(`[Modbus Backoff] Reagendando reconexão ID ${this.deviceId} em ${(delay / 1000).toFixed(1)}s (tentativa #${this.retryCount})`, { deviceId: this.deviceId, delayMs: delay });

    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      if (this.state === 'BACKOFF') {
        this.setState('DISCONNECTED');
        this.connect();
      }
    }, delay);
  }

  // Purga e fecha com segurança o socket TCP atual
  _purgeSocket(reason) {
    if (this.client) {
      try {
        if (this.client.removeAllListeners) this.client.removeAllListeners();
        if (this.client.destroy) this.client.destroy();
        else if (this.client.close) this.client.close(() => {});
      } catch (e) {}
      this.client = null;
    }
    this.inFlight = false;
  }

  // ---------------------------------------------------------------------------
  // Enfileiramento de Requisições (Comando ou Polling)
  // ---------------------------------------------------------------------------
  request(options) {
    return new Promise((resolve, reject) => {
      this.queue.enqueue({
        id: options.id,
        priority: options.priority !== undefined ? options.priority : 3,
        deadline: options.deadline || (Date.now() + 15000),
        key: options.key,
        generationId: this.generationId,
        execute: options.execute,
        resolve,
        reject
      });

      this._triggerExecutor();
    });
  }

  _triggerExecutor() {
    if (this.state === 'ONLINE' && !this.inFlight) {
      this._processNextRequest();
    }
  }

  _startExecutorLoop() {
    if (this.executorLoopActive) return;
    this.executorLoopActive = true;
    this._processNextRequest();
  }

  // ---------------------------------------------------------------------------
  // Malha Executora: Single In-Flight Request
  // ---------------------------------------------------------------------------
  async _processNextRequest() {
    if (this.state !== 'ONLINE' || this.inFlight) {
      this.executorLoopActive = false;
      return;
    }

    const req = this.queue.dequeue();
    if (!req) {
      this.executorLoopActive = false;
      return;
    }

    this.inFlight = true;
    metrics.updateQueueStatus(this.queue.size(), 1);

    const currentGen = this.generationId;
    const startMs = Date.now();

    // Timeout adaptativo por transação (min 3s, max 8s)
    const adaptiveTimeoutMs = Math.min(Math.max(3000, Math.round(metrics.getP95RTT() * 2.0 + 1000)), 8000);

    const executePromise = req.execute(this.client);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out`)), adaptiveTimeoutMs)
    );

    try {
      const result = await Promise.race([executePromise, timeoutPromise]);
      const durationMs = Date.now() - startMs;

      if (currentGen !== this.generationId) {
        // Resposta de socket antigo — descarta silenciosamente
        if (req.reject) req.reject(new Error('Stale Socket Generation'));
      } else {
        // SUCESSO: zera contador de falhas consecutivas
        this.consecutiveFailures = 0;
        metrics.recordRequest(true, durationMs);
        if (req.resolve) req.resolve(result);
      }

    } catch (err) {
      const durationMs = Date.now() - startMs;
      metrics.recordRequest(false, durationMs, err.message);

      if (req.reject) req.reject(err);

      // Erros de configuração (Illegal Address) → quarentena, sem reconexão
      if (circuitBreaker.isConfigurationError(err)) {
        logger.warn(`[Modbus Error] Erro de configuração na transação ${req.id}: ${err.message}`);
        // Não conta como falha de transporte
      } else {
        logger.warn(`[Modbus Error] Falha na transação ${req.id}: ${err.message}`);
        // Timeout ou erro de transporte: incrementa contador, só reconecta se threshold atingido
        if (currentGen === this.generationId) {
          this._handleConnectionFailure(err.message, false);
        }
      }

    } finally {
      this.inFlight = false;
      metrics.updateQueueStatus(this.queue.size(), 0);

      // Continua processando fila (10ms de respiro entre transações)
      if (this.state === 'ONLINE') {
        setTimeout(() => this._processNextRequest(), 10);
      } else {
        this.executorLoopActive = false;
      }
    }
  }
}

module.exports = ModbusChannel;
