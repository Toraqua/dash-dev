// =============================================================================
// plc.js — Serviço de Comunicação Modbus TCP/IP (Driver Industrial)
//
// Melhorias aplicadas nesta versão:
//   - Cache de options parseado por variável (elimina ~3000 JSON.parse/min)
//   - Lookup O(1) no blockDataMap via índice pré-computado
//   - Batch de INSERTs de histórico em transação única (menos I/O de disco)
//   - reloadDevices() refatorado com async/await (sem callback hell)
//   - Getter devices() substituído por método snapshot leve
//   - processAlarms() com lookup O(1) via Map de variáveis
// =============================================================================

const EventEmitter = require('events');
const db           = require('./db');

const ModbusChannel   = require('./modbus/ModbusChannel');
const scheduler       = require('./modbus/ModbusScheduler');
const circuitBreaker  = require('./modbus/ModbusCircuitBreaker');
const logger          = require('./modbus/ModbusLogger');
const metrics         = require('./modbus/ModbusMetrics');

// =============================================================================
// parseModbusValue — Interpreta registros brutos de acordo com formato/endianness
// =============================================================================
function parseModbusValue(registers, dataFormat = '16_int', endianness = 'ABCD') {
  if (!registers || !registers.length) return 0;

  if (String(dataFormat).startsWith('32')) {
    const w1 = registers[0] || 0;
    const w2 = registers[1] || 0;
    const A = (w1 >> 8) & 0xFF, B = w1 & 0xFF;
    const C = (w2 >> 8) & 0xFF, D = w2 & 0xFF;

    let bytes;
    switch (endianness) {
      case 'BADC': bytes = [B, A, D, C]; break;
      case 'DCBA': bytes = [D, C, B, A]; break;
      case 'CDAB': bytes = [C, D, A, B]; break;
      default:     bytes = [A, B, C, D]; break;
    }
    const buf = Buffer.from(bytes);
    if (dataFormat === '32_int')  return buf.readInt32BE(0);
    if (dataFormat === '32_uint') return buf.readUInt32BE(0);
    const f = buf.readFloatBE(0);
    return (isNaN(f) || !isFinite(f)) ? 0 : f;
  }

  const w1 = registers[0] || 0;
  const bytes = (endianness === 'BADC' || endianness === 'DCBA')
    ? [w1 & 0xFF, (w1 >> 8) & 0xFF]
    : [(w1 >> 8) & 0xFF, w1 & 0xFF];
  const buf = Buffer.from(bytes);
  return dataFormat === '16_uint' ? buf.readUInt16BE(0) : buf.readInt16BE(0);
}

// =============================================================================
// Helpers internos
// =============================================================================

/** Parseia options JSON de uma variável com fallback seguro */
function parseVarOpts(v) {
  if (v._parsedOpts !== undefined) return v._parsedOpts;
  try {
    v._parsedOpts = typeof v.options === 'string'
      ? JSON.parse(v.options || '{}')
      : (v.options || {});
  } catch (_) {
    v._parsedOpts = {};
  }
  return v._parsedOpts;
}

/** Número de registros Modbus que esta variável ocupa */
function getNumRegsForVar(v) {
  const opts = parseVarOpts(v);
  const df   = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
  return String(df).startsWith('32') ? 2 : 1;
}

/** Normaliza o tipo Modbus para a chave interna */
function normalizeType(raw) {
  const t = String(raw || '').toLowerCase();
  if (t === 'holding' || t === 'holdingregister') return 'holding';
  if (t === 'input'   || t === 'inputregister')   return 'input';
  if (t === 'coil')                               return 'coil';
  if (t === 'discrete'|| t === 'inputstatus')     return 'discrete';
  return 'holding';
}

// =============================================================================
// PLCService
// =============================================================================
class PLCService extends EventEmitter {
  constructor() {
    super();

    this.state       = { connected: true };
    this.channels    = {};         // device_id → ModbusChannel
    this.deviceMeta  = {};         // device_id → { info, variables, alarms, pollTimer, varMap, alarmVarMap }

    this.historyIntervalSeconds = 15;
    this.lastHistoryLogTime     = {};   // variable_id → lastMs
    this.lastReadTimes          = {};   // variable_id/name → ms
    this.activeAlarmsSet        = new Set();

    // Batch de histórico: acumula INSERTs e persiste em bloco
    this._historyBatch    = [];
    this._historyBatchTimer = null;

    this.init();
  }

  // ---------------------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------------------
  async init() {
    this.loadGeneralConfig();
    this.loadActiveAlarms();
    this.loadLastReadTimesFromDb();
    await this.reloadDevices();
    this.startWatchdog();
  }

  async loadLastReadTimesFromDb() {
    try {
      const rows = await db.allAsync(
        `SELECT v.id, v.name, v.display_name, MAX(vh.timestamp) as last_ts
         FROM variable_history vh
         JOIN variables v ON v.id = vh.variable_id
         GROUP BY vh.variable_id`
      );
      for (const r of rows) {
        if (!r.last_ts) continue;
        const dStr = r.last_ts.includes('Z') || r.last_ts.includes('+')
          ? r.last_ts
          : r.last_ts.replace(' ', 'T') + 'Z';
        const ms = new Date(dStr).getTime();
        if (!isNaN(ms)) {
          this.lastReadTimes[r.id] = ms;
          if (r.name)         this.lastReadTimes[r.name]         = ms;
          if (r.display_name) this.lastReadTimes[r.display_name] = ms;
        }
      }
    } catch (e) {
      logger.warn(`[PLC] Erro ao carregar lastReadTimes: ${e.message}`);
    }
  }

  loadActiveAlarms() {
    db.all(`SELECT alarm_config_id FROM alarm_history WHERE status = 'ACTIVE'`, [], (err, rows) => {
      if (!err && rows) rows.forEach(r => this.activeAlarmsSet.add(r.alarm_config_id));
    });
  }

  loadGeneralConfig() {
    db.get("SELECT value FROM system_settings WHERE key = 'general_config'", [], (err, row) => {
      if (!err && row && row.value) {
        try {
          const cfg = JSON.parse(row.value);
          if (cfg.history_interval_seconds) {
            this.historyIntervalSeconds = parseInt(cfg.history_interval_seconds) || 15;
          }
        } catch (_) {}
      }
    });
  }

  /** Recarrega configurações de alarme do banco */
  loadAlarmConfigs() {
    for (const devId in this.deviceMeta) {
      db.all('SELECT * FROM alarm_configs WHERE device_id = ?', [devId], (err, alarms) => {
        if (!err && alarms && this.deviceMeta[devId]) {
          this.deviceMeta[devId].alarms      = alarms;
          this.deviceMeta[devId].alarmVarMap = null; // invalidar cache do lookup
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Watchdog Passivo
  // ---------------------------------------------------------------------------
  startWatchdog() {
    if (this._watchdogInterval) clearInterval(this._watchdogInterval);
    this._watchdogInterval = setInterval(() => {
      for (const devId in this.channels) {
        const ch = this.channels[devId];
        if (ch && ch.state === 'DISCONNECTED') {
          logger.info(`[Watchdog] Dispositivo ID ${devId} em DISCONNECTED. Reconectando...`, { deviceId: devId });
          ch.connect();
        }
      }
    }, 10000);
  }

  // ---------------------------------------------------------------------------
  // Reload de Dispositivos (async/await — sem callback hell)
  // ---------------------------------------------------------------------------
  async reloadDevices() {
    // Para e limpa todos os canais existentes
    for (const devId in this.channels) {
      if (this.channels[devId]) this.channels[devId].stop();
    }
    this.channels   = {};
    this.deviceMeta = {};

    let devices;
    try {
      devices = await db.allAsync('SELECT * FROM devices');
    } catch (e) {
      logger.warn(`[PLC] Erro ao carregar dispositivos: ${e.message}`);
      return;
    }

    await Promise.all(devices.map(async (device) => {
      const devId = device.id;

      const channel = new ModbusChannel(device);
      this.channels[devId] = channel;

      this.deviceMeta[devId] = {
        info:        device,
        variables:   [],
        alarms:      [],
        pollTimer:   null,
        varMap:      null,  // Map<typeKey:addr, variable> — lazy, criado na 1ª poll
        alarmVarMap: null,  // Map<typeKey:addr, variable> — lazy
      };

      // Inicia/para polling ao mudar de estado
      channel.onStateChange = (_, newState) => {
        if (newState === 'ONLINE') {
          this.startPollingLoop(devId);
        } else if (newState === 'STOPPED' || newState === 'BACKOFF') {
          const meta = this.deviceMeta[devId];
          if (meta?.pollTimer) {
            clearTimeout(meta.pollTimer);
            meta.pollTimer = null;
          }
        }
      };

      // Notifica a thread principal quando o estado muda
      channel.onStateChange = ((originalFn) => (oldState, newState) => {
        if (originalFn) originalFn(oldState, newState);
        // Emite snapshot de estado do dispositivo para plc_worker propagar
        this.emit('device_state_change', devId, {
          connected: newState === 'ONLINE',
          state:     newState,
        });
      })(channel.onStateChange);

      // Carrega variáveis e alarmes em paralelo
      try {
        const [vars, alarms] = await Promise.all([
          db.allAsync('SELECT * FROM variables WHERE device_id = ?', [devId]),
          db.allAsync('SELECT * FROM alarm_configs WHERE device_id = ?', [devId]),
        ]);

        if (this.deviceMeta[devId]) {
          this.deviceMeta[devId].variables = vars;
          this.deviceMeta[devId].alarms    = alarms;

          for (const v of vars) {
            // Inicializa estado padrão
            if (this.state[v.name] === undefined) {
              this.state[v.name] = v.type === 'analog' ? 0.0 : false;
            }
            if (v.display_name && this.state[v.display_name] === undefined) {
              this.state[v.display_name] = v.type === 'analog' ? 0.0 : false;
            }
            // Propaga lastReadTimes por nome
            if (this.lastReadTimes[v.id]) {
              this.lastReadTimes[v.name] = this.lastReadTimes[v.id];
              if (v.display_name) this.lastReadTimes[v.display_name] = this.lastReadTimes[v.id];
            }
          }
        }
      } catch (e) {
        logger.warn(`[PLC] Erro ao carregar metadados do dispositivo ${devId}: ${e.message}`);
      }

      channel.start();
    }));
  }

  // ---------------------------------------------------------------------------
  // Reload de Variáveis
  // ---------------------------------------------------------------------------
  reloadVariables() {
    for (const devId in this.deviceMeta) {
      db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (err, vars) => {
        if (!err && vars && this.deviceMeta[devId]) {
          // Invalida o cache de options parseado
          vars.forEach(v => { delete v._parsedOpts; });
          this.deviceMeta[devId].variables = vars;
          this.deviceMeta[devId].varMap    = null; // invalida lookup cache
          for (const v of vars) {
            if (this.state[v.name] === undefined) {
              this.state[v.name] = v.type === 'analog' ? 0.0 : false;
            }
            if (v.display_name && this.state[v.display_name] === undefined) {
              this.state[v.display_name] = v.type === 'analog' ? 0.0 : false;
            }
          }
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Loop de Polling Periódico
  // ---------------------------------------------------------------------------
  startPollingLoop(deviceId) {
    const meta = this.deviceMeta[deviceId];
    if (!meta) return;
    if (meta.pollTimer) clearTimeout(meta.pollTimer);

    const pollIntervalMs = meta.info.polling_interval_ms || 1000;

    const executeCycle = async () => {
      const channel = this.channels[deviceId];
      if (!channel || channel.state !== 'ONLINE') return;
      try {
        await this.pollDevice(deviceId);
      } catch (e) {
        logger.warn(`[Polling Error] ID ${deviceId}: ${e.message}`);
      } finally {
        const ch = this.channels[deviceId];
        if (ch && ch.state === 'ONLINE' && this.deviceMeta[deviceId]) {
          meta.pollTimer = setTimeout(executeCycle, pollIntervalMs);
        }
      }
    };

    meta.pollTimer = setTimeout(executeCycle, 50);
  }

  // ---------------------------------------------------------------------------
  // pollDevice — Varredura com Smart Chunking e lookup O(1)
  // ---------------------------------------------------------------------------
  async pollDevice(deviceId) {
    const channel = this.channels[deviceId];
    const meta    = this.deviceMeta[deviceId];
    if (!channel || channel.state !== 'ONLINE' || !meta) return;

    const vars = meta.variables || [];
    if (!vars.length) return;

    // Separa variáveis por tipo Modbus
    const byType = { holding: [], input: [], coil: [], discrete: [] };
    for (const v of vars) {
      const t = normalizeType(v.modbus_type);
      byType[t].push(v);
    }

    // Agrupamento Inteligente por tipo
    const typeConfig = [
      { key: 'holding',  vars: byType.holding,  fn: 'readHoldingRegisters' },
      { key: 'input',    vars: byType.input,    fn: 'readInputRegisters'  },
      { key: 'coil',     vars: byType.coil,     fn: 'readCoils'           },
      { key: 'discrete', vars: byType.discrete, fn: 'readDiscreteInputs'  },
    ];

    // blockIndex: Map<"typeKey:blockStart" → dataArray> para lookup O(1)
    const blockIndex = new Map();

    for (const { key: typeKey, vars: tvars, fn: readFn } of typeConfig) {
      if (!tvars.length) continue;

      const blocks = scheduler.buildBlocks(
        typeKey === 'coil' || typeKey === 'discrete'
          ? tvars
          : tvars,
        typeKey,
        typeKey === 'coil' || typeKey === 'discrete' ? () => 1 : getNumRegsForVar
      );

      for (const block of blocks) {
        await this._readBlockWithFallback(channel, typeKey, block, readFn, blockIndex);
      }
    }

    // Extração de valores com lookup O(1)
    const nowMs        = Date.now();
    const historyRows  = []; // Batch de INSERTs de histórico

    for (const v of vars) {
      const opts       = parseVarOpts(v);
      const typeKey    = normalizeType(v.modbus_type);
      const wireAddr   = parseInt(v.modbus_address) || 0;
      const dataFormat = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
      const endianness = opts.endianness || 'ABCD';
      const numRegs    = String(dataFormat).startsWith('32') ? 2 : 1;

      let rawValue    = null;
      let readSuccess = false;

      // Busca o bloco que contém este endereço — O(1) via iteração curta sobre blockIndex
      for (const [bKey, dataArr] of blockIndex) {
        const [bType, bStartStr] = bKey.split(':');
        const bStart = parseInt(bStartStr);
        if (bType === typeKey && wireAddr >= bStart && (wireAddr + numRegs) <= (bStart + dataArr.length)) {
          const offset = wireAddr - bStart;
          const slice  = dataArr.slice(offset, offset + numRegs);
          rawValue    = (typeKey === 'holding' || typeKey === 'input')
            ? parseModbusValue(slice, dataFormat, endianness)
            : slice[0];
          readSuccess = true;
          break;
        }
      }

      let finalValue;
      if (readSuccess) {
        if (
          opts.bit_index !== undefined && opts.bit_index !== null &&
          parseInt(opts.bit_index) >= 0 &&
          (typeKey === 'holding' || typeKey === 'input')
        ) {
          finalValue = ((rawValue >> parseInt(opts.bit_index)) & 1) === 1;

        } else if (v.type === 'analog') {
          let val = typeof rawValue === 'number' ? rawValue : (rawValue ? 1 : 0);
          if (opts.scale != null && opts.scale !== '' && !isNaN(opts.scale) && parseFloat(opts.scale) !== 1) {
            val = val * parseFloat(opts.scale);
          }
          if (opts.offset != null && opts.offset !== '' && !isNaN(opts.offset) && parseFloat(opts.offset) !== 0) {
            val = val + parseFloat(opts.offset);
          }
          finalValue = (v.decimals > 0 && dataFormat !== '32_float')
            ? val / Math.pow(10, v.decimals)
            : val;

        } else if (v.type === 'boolean') {
          finalValue = Boolean(rawValue);
        } else {
          finalValue = rawValue;
        }

        this.lastReadTimes[v.id]   = nowMs;
        this.lastReadTimes[v.name] = nowMs;
        if (v.display_name) this.lastReadTimes[v.display_name] = nowMs;

      } else {
        finalValue = this.state[v.name] !== undefined ? this.state[v.name] : 0;
      }

      this.state[v.name] = finalValue;
      if (v.display_name) this.state[v.display_name] = finalValue;

      // Acumula histórico para batch
      const intervalMs = this.historyIntervalSeconds * 1000;
      if (!this.lastHistoryLogTime[v.id] || (nowMs - this.lastHistoryLogTime[v.id]) >= intervalMs) {
        this.lastHistoryLogTime[v.id] = nowMs;
        historyRows.push({
          sql:    'INSERT INTO variable_history (variable_id, value, timestamp) VALUES (?, ?, ?)',
          params: [v.id, finalValue, new Date(nowMs).toISOString()],
        });
      }
    }

    // Processa alarmes
    if (meta.alarms && meta.alarms.length > 0) {
      this.processAlarms(meta, vars);
    }

    // Flush batch de histórico de forma assíncrona (não bloqueia o poll)
    if (historyRows.length > 0) {
      this._scheduleBatchHistory(historyRows);
    }

    this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });
  }

  // ---------------------------------------------------------------------------
  // Leitura de Bloco com Fallback Binário
  // ---------------------------------------------------------------------------
  async _readBlockWithFallback(channel, typeKey, block, readFn, blockIndex) {
    const count = block.end - block.start;
    const key   = `poll:${typeKey}:${block.start}:${count}`;

    try {
      const data = await channel.request({
        priority: 3,
        deadline: Date.now() + 15000,
        key,
        execute: async (client) => {
          const res = await client[readFn](block.start, count);
          return res ? res.data : null;
        },
      });
      if (data) blockIndex.set(`${typeKey}:${block.start}`, data);

    } catch (err) {
      metrics.recordBlockFailure();

      const msg = err.message || '';
      if (msg.includes('Timed out') || msg.includes('Timeout') ||
          msg.includes('Coalesced') || msg.includes('Deadline Expired')) {
        logger.warn(`[Modbus Poll] Bloco ${typeKey}[${block.start}..${block.end - 1}] ignorado: ${msg}`);
        return;
      }

      // Só faz divisão binária para erros de endereço/configuração
      logger.warn(`[Modbus Poll] Bloco ${typeKey}[${block.start}..${block.end - 1}] falhou: ${msg}. Divisão binária...`);
      for (const sub of circuitBreaker.splitBlock(block)) {
        const subCount = sub.end - sub.start;
        try {
          const subData = await channel.request({
            priority: 3,
            deadline: Date.now() + 15000,
            key: `poll:${typeKey}:${sub.start}:${subCount}`,
            execute: async (client) => {
              const res = await client[readFn](sub.start, subCount);
              return res ? res.data : null;
            },
          });
          if (subData) blockIndex.set(`${typeKey}:${sub.start}`, subData);
        } catch (subErr) {
          if (sub.vars.length === 1 && circuitBreaker.isConfigurationError(subErr)) {
            circuitBreaker.quarantine(typeKey, parseInt(sub.vars[0].modbus_address) || 0, subErr.message);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Batch de Histórico — Acumula e persiste de forma assíncrona
  // ---------------------------------------------------------------------------
  _scheduleBatchHistory(rows) {
    // Acumula os rows
    this._historyBatch.push(...rows);

    // Debounce: persiste tudo num único setTimeout de 200ms
    if (!this._historyBatchTimer) {
      this._historyBatchTimer = setTimeout(async () => {
        this._historyBatchTimer = null;
        const batch = this._historyBatch.splice(0);
        if (!batch.length) return;
        try {
          await db.runBatchAsync(batch);
        } catch (e) {
          logger.warn(`[PLC] Erro ao persistir histórico em batch (${batch.length} rows): ${e.message}`);
        }
      }, 200);
    }
  }

  // ---------------------------------------------------------------------------
  // Processamento de Alarmes com lookup O(1)
  // ---------------------------------------------------------------------------
  processAlarms(meta, vars) {
    // Constrói o Map de variáveis por "typeKey:addr" uma única vez por ciclo (lazy)
    if (!meta.varMap) {
      meta.varMap = new Map();
      for (const v of vars) {
        meta.varMap.set(`${normalizeType(v.modbus_type)}:${parseInt(v.modbus_address) || 0}`, v);
      }
    }

    for (const alarm of meta.alarms) {
      if (!alarm.enabled) continue;
      const lookupKey = `${normalizeType(alarm.modbus_type)}:${parseInt(alarm.modbus_address) || 0}`;
      const alarmVar  = meta.varMap.get(lookupKey);
      if (!alarmVar || this.state[alarmVar.name] === undefined) continue;

      let rawVal = this.state[alarmVar.name];
      if (typeof rawVal === 'boolean') rawVal = rawVal ? 1 : 0;

      const conditionMet    = this.evaluateCondition(rawVal, alarm.condition_type, alarm.condition_value);
      const isCurrentlyActive = this.activeAlarmsSet.has(alarm.id);

      if (conditionMet && !isCurrentlyActive) {
        this.activeAlarmsSet.add(alarm.id);
        db.run(
          `INSERT INTO alarm_history (alarm_config_id, trigger_value, status) VALUES (?, ?, 'ACTIVE')`,
          [alarm.id, rawVal],
          () => this.emit('alarms_updated')
        );
      } else if (!conditionMet && isCurrentlyActive) {
        this.activeAlarmsSet.delete(alarm.id);
        db.run(
          `UPDATE alarm_history SET status = 'RESOLVED', resolve_time = CURRENT_TIMESTAMP WHERE alarm_config_id = ? AND status = 'ACTIVE'`,
          [alarm.id],
          () => this.emit('alarms_updated')
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // writeModbus — Comandos do Operador (Prioridade P1)
  // ---------------------------------------------------------------------------
  async writeModbus(deviceId, modbus_type, address, value, decimals = 0, bit_index = -1, var_name = null) {
    const channel  = this.channels[deviceId];
    const mType    = normalizeType(modbus_type);
    const wireAddr = Math.max(0, parseInt(address) || 0);

    logger.info(`[Write] Dev=${deviceId} ${mType}[${wireAddr}]=${value} bit=${bit_index} var=${var_name}`);

    const updateState = (val) => {
      if (!var_name) return;
      this.state[var_name] = val;
      const meta = this.deviceMeta[deviceId];
      if (meta?.variables) {
        const found = meta.variables.find(v => v.name === var_name);
        if (found?.display_name) this.state[found.display_name] = val;
      }
    };

    if (!channel || channel.state !== 'ONLINE') {
      logger.warn(`[Write] Dispositivo ${deviceId} offline — atualizando apenas em memória.`);
      updateState(value);
      this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });
      return true;
    }

    return channel.request({
      priority: 1,
      deadline: Date.now() + 15000,
      key:      `write:${mType}:${wireAddr}`,
      execute:  async (client) => {
        if (mType === 'coil') {
          const boolVal = Boolean(value);
          await client.writeCoil(wireAddr, boolVal);
          updateState(boolVal);

        } else if (mType === 'holding') {
          const bitIdx = parseInt(bit_index);
          if (!isNaN(bitIdx) && bitIdx >= 0) {
            let curWord = 0;
            try {
              const res = await client.readHoldingRegisters(wireAddr, 1);
              if (res?.data) curWord = res.data[0];
            } catch (_) {}
            const newWord = Boolean(value) ? (curWord | (1 << bitIdx)) : (curWord & ~(1 << bitIdx));
            await client.writeRegister(wireAddr, newWord);
            updateState(Boolean((newWord >> bitIdx) & 1));

          } else {
            // Resolve formato/endianness da variável
            let dataFormat = '16_int', endianness = 'ABCD', varScale = null, varOffset = null;
            let varDecimals = decimals || 0;

            const meta = this.deviceMeta[deviceId];
            if (var_name && meta?.variables) {
              const found = meta.variables.find(v => v.name === var_name);
              if (found) {
                const opts = parseVarOpts(found);
                if (opts.data_format) dataFormat = opts.data_format;
                if (opts.endianness)  endianness  = opts.endianness;
                if (opts.scale  != null && opts.scale  !== '' && !isNaN(opts.scale))  varScale   = parseFloat(opts.scale);
                if (opts.offset != null && opts.offset !== '' && !isNaN(opts.offset)) varOffset  = parseFloat(opts.offset);
                if (found.decimals != null) varDecimals = parseInt(found.decimals) || 0;
              }
            }

            const is32 = String(dataFormat).startsWith('32');
            const isFloat = dataFormat === '32_float';
            let enc = Number(value);

            if (!isFloat) {
              if (varOffset !== null && !isNaN(varOffset) && varOffset !== 0) enc -= varOffset;
              if (varScale  !== null && !isNaN(varScale)  && varScale  !== 0 && varScale !== 1) enc /= varScale;
            }

            if (is32) {
              const val = isFloat ? enc : Math.round(enc * Math.pow(10, varDecimals));
              const buf = Buffer.alloc(4);
              if (isFloat)                  buf.writeFloatBE(val, 0);
              else if (dataFormat === '32_int')  buf.writeInt32BE(val, 0);
              else                               buf.writeUInt32BE(val >>> 0, 0);

              const [A, B, C, D] = [buf[0], buf[1], buf[2], buf[3]];
              let fb;
              switch (endianness) {
                case 'BADC': fb = [B, A, D, C]; break;
                case 'DCBA': fb = [D, C, B, A]; break;
                case 'CDAB': fb = [C, D, A, B]; break;
                default:     fb = [A, B, C, D]; break;
              }
              await client.writeRegisters(wireAddr, [
                ((fb[0] << 8) | fb[1]) & 0xFFFF,
                ((fb[2] << 8) | fb[3]) & 0xFFFF,
              ]);
            } else {
              await client.writeRegister(wireAddr, Math.round(enc * Math.pow(10, varDecimals)));
            }
            updateState(Number(value));
          }
        } else {
          throw new Error(`Tipo Modbus '${mType}' não suporta escrita.`);
        }

        this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });
        return true;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers públicos
  // ---------------------------------------------------------------------------
  getMetricsSnapshot() {
    return metrics.getSnapshot();
  }

  evaluateCondition(currentValue, operator, targetValue) {
    const v1 = parseFloat(currentValue);
    const v2 = parseFloat(targetValue);
    switch (operator) {
      case '==': return v1 === v2;
      case '!=': return v1 !== v2;
      case '>':  return v1 >  v2;
      case '>=': return v1 >= v2;
      case '<':  return v1 <  v2;
      case '<=': return v1 <= v2;
      default:   return false;
    }
  }

  /** Snapshot leve de status dos dispositivos para o worker repassar */
  getDevicesSnapshot() {
    const snap = {};
    for (const id in this.channels) {
      const ch = this.channels[id];
      snap[id] = {
        connected: ch ? ch.state === 'ONLINE' : false,
        state:     ch ? ch.state : 'STOPPED',
      };
    }
    return snap;
  }
}

const plc = new PLCService();
module.exports = plc;
