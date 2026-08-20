// =============================================================================
// plc.js — Serviço de Comunicação Modbus TCP/IP
// Gerencia conexão, polling, leitura e escrita de dispositivos industriais (CLPs)
// via protocolo Modbus TCP utilizando a biblioteca modbus-serial.
// =============================================================================

const EventEmitter = require('events');
const db           = require('./db');
const ModbusRTU    = require('modbus-serial');

// AsyncMutex — Sincronizador de exclusão mútua assíncrono para conexões Modbus TCP.
// Garante que operações de leitura (poll) e escrita (setpoint/botões) NUNCA
// sejam intercaladas no mesmo socket TCP, prevenindo race-conditions e desincronização.
class AsyncMutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }

  acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next(() => this.release());
    } else {
      this.locked = false;
    }
  }
}

// =============================================================================
// parseModbusValue — Interpreta os registros brutos do Modbus de acordo com
// o formato de dados (16_int, 16_uint, 32_int, 32_uint, 32_float) e ordem dos
// bytes (endianness: ABCD, BADC, DCBA, CDAB).
//
// Parâmetros:
//   registers   — Array de words (uint16) retornados pelo Modbus
//   dataFormat  — Formato de interpretação: '16_int' | '16_uint' | '32_int' | '32_uint' | '32_float'
//   endianness  — Ordem dos bytes: 'ABCD' (Big-Endian) | 'BADC' | 'DCBA' | 'CDAB'
//
// Retorna: número interpretado (inteiro ou ponto flutuante)
// =============================================================================
function parseModbusValue(registers, dataFormat = '16_int', endianness = 'ABCD') {
  if (!registers || !registers.length) return 0;

  const is32Bit = String(dataFormat).startsWith('32');

  if (is32Bit) {
    // Leitura de 32 bits requer 2 registros consecutivos
    const w1 = registers[0] || 0; // Word alta
    const w2 = registers[1] || 0; // Word baixa
    // Extrair os 4 bytes individuais
    const A = (w1 >> 8) & 0xFF; // Byte mais significativo da word alta
    const B =  w1       & 0xFF; // Byte menos significativo da word alta
    const C = (w2 >> 8) & 0xFF; // Byte mais significativo da word baixa
    const D =  w2       & 0xFF; // Byte menos significativo da word baixa

    // Reorganiza os bytes conforme a ordem configurada
    let bytes;
    switch (endianness) {
      case 'BADC': bytes = [B, A, D, C]; break; // Little-word, Big-byte
      case 'DCBA': bytes = [D, C, B, A]; break; // Little-Endian total
      case 'CDAB': bytes = [C, D, A, B]; break; // Middle-Endian invertido
      case 'ABCD':
      default:     bytes = [A, B, C, D]; break; // Big-Endian (padrão Modbus)
    }

    const buf = Buffer.from(bytes);
    if      (dataFormat === '32_int')   return buf.readInt32BE(0);
    else if (dataFormat === '32_uint')  return buf.readUInt32BE(0);
    else {
      // 32_float — Ponto flutuante IEEE 754
      const f = buf.readFloatBE(0);
      return (isNaN(f) || !isFinite(f)) ? 0 : f;
    }
  } else {
    // Leitura de 16 bits — 1 registro
    const w1 = registers[0] || 0;
    const A  = (w1 >> 8) & 0xFF;
    const B  =  w1       & 0xFF;

    let bytes;
    if (endianness === 'BADC' || endianness === 'DCBA') {
      bytes = [B, A]; // Little-Endian de 16 bits
    } else {
      bytes = [A, B]; // Big-Endian de 16 bits (padrão)
    }

    const buf = Buffer.from(bytes);
    if (dataFormat === '16_uint') return buf.readUInt16BE(0);
    else                          return buf.readInt16BE(0);
  }
}

// =============================================================================
// PLCService — Classe principal do serviço de comunicação com CLPs Modbus.
//
// Herda de EventEmitter para publicar eventos:
//   'update'         — Emitido a cada ciclo de polling com o estado atual
//   'alarms_updated' — Emitido quando um alarme é ativado ou resolvido
// =============================================================================
class PLCService extends EventEmitter {
  constructor() {
    super();

    // Estado global de todas as variáveis: { nome_variavel: valor }
    // Mantido em memória e nunca resetado completamente — apenas atualizado
    this.state = {
      connected: true, // Compatibilidade legada com frontend antigo
    };

    // Mapa de dispositivos ativos: { device_id: { info, client, variables, alarms, connected, ... } }
    this.devices = {};

    // Intervalo de gravação no histórico (segundos) — carregado das configurações gerais
    this.historyIntervalSeconds = 15;

    // Mapa de último timestamp de gravação no histórico por variável: { variable_id: ms }
    this.lastHistoryLogTime = {};

    // Mapa de último timestamp de leitura Modbus BEM SUCEDIDA por variável (Retentivo): { id/name: ms }
    this.lastReadTimes = {};

    // Conjunto de IDs de alarmes atualmente ativos (checagem em memória para alta performance)
    this.activeAlarmsSet = new Set();

    // Inicializa o serviço
    this.init();
  }

  // ---------------------------------------------------------------------------
  // init — Ponto de entrada após construção.
  // Carrega configurações, alarmes ativos, histórico de timestamps e inicia dispositivos.
  // ---------------------------------------------------------------------------
  init() {
    this.loadGeneralConfig();
    this.loadActiveAlarms();
    this.loadLastReadTimesFromDb();
    this.reloadDevices();
    this.startWatchdog();
  }

  // ---------------------------------------------------------------------------
  // loadLastReadTimesFromDb — Carrega do banco de dados o último timestamp
  // de leitura bem-sucedida para cada variável (Retentividade Real).
  // ---------------------------------------------------------------------------
  loadLastReadTimesFromDb() {
    db.all(`SELECT v.id, v.name, v.display_name, MAX(vh.timestamp) as last_ts FROM variable_history vh JOIN variables v ON v.id = vh.variable_id GROUP BY vh.variable_id`, [], (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          if (r.last_ts) {
            const dStr = r.last_ts.includes('Z') || r.last_ts.includes('+') ? r.last_ts : r.last_ts.replace(' ', 'T') + 'Z';
            const ms = new Date(dStr).getTime();
            if (!isNaN(ms)) {
              this.lastReadTimes[r.id] = ms;
              if (r.name) this.lastReadTimes[r.name] = ms;
              if (r.display_name) this.lastReadTimes[r.display_name] = ms;
            }
          }
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // startWatchdog — Monitoramento de autocura em segundo plano (roda a cada 10s).
  // Garante que QUALQUER travamento de socket, perda de rota VPN ou congelamento
  // de conexão seja detectado e corrigido automaticamente sem ação manual.
  // ---------------------------------------------------------------------------
  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      for (const devId in this.devices) {
        const dev = this.devices[devId];
        if (!dev) continue;

        // Caso 1: Dispositivo offline — o Watchdog garante tentativa de conexão contínua a cada 10s
        if (!dev.connected && !dev.connecting) {
          console.log(`[Watchdog Modbus] Dispositivo ID ${devId} offline. Tentando reconectar ao CLP...`);
          dev.connecting = false;
          dev.isPolling  = false;
          this.connectDevice(devId);
        }
        // Caso 2: Conexão presa em handshake por mais de 10s
        else if (dev.connecting && dev.connectStartTime && (now - dev.connectStartTime) > 10000) {
          console.warn(`[Watchdog Modbus] Handshake de conexão ID ${devId} preso (>10s). Resetando...`);
          dev.connecting = false;
          dev.isPolling  = false;
          this.resetDeviceConnection(devId, 'Watchdog: connect timeout stuck');
        }
        // Caso 3: Conectado porém sem resposta de dados há mais de 60s
        else if (dev.connected && dev.variables && dev.variables.length > 0 && dev.lastSuccessPollTime && (now - dev.lastSuccessPollTime) > 60000) {
          console.warn(`[Watchdog Modbus] Dispositivo ID ${devId} sem telemetria há mais de 60s. Resetando conexão...`);
          this.resetDeviceConnection(devId, 'Watchdog: telemetry stale >60s');
        }
      }
    }, 10000);
  }

  // ---------------------------------------------------------------------------
  // loadActiveAlarms — Carrega do banco os alarmes que já estão ativos
  // (status = 'ACTIVE') para sincronizar o estado em memória após reinicialização.
  // ---------------------------------------------------------------------------
  loadActiveAlarms() {
    db.all(`SELECT alarm_config_id FROM alarm_history WHERE status = 'ACTIVE'`, [], (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => this.activeAlarmsSet.add(r.alarm_config_id));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // loadGeneralConfig — Lê a configuração geral do banco (ex: intervalo histórico)
  // e atualiza os parâmetros internos do serviço.
  // ---------------------------------------------------------------------------
  loadGeneralConfig() {
    db.get("SELECT value FROM system_settings WHERE key = 'general_config'", [], (err, row) => {
      if (!err && row && row.value) {
        try {
          const cfg = JSON.parse(row.value);
          if (cfg.history_interval_seconds) {
            this.historyIntervalSeconds = parseInt(cfg.history_interval_seconds) || 15;
          }
        } catch(e) {}
      }
    });
  }

  // ---------------------------------------------------------------------------
  // reloadDevices — Recarrega todos os dispositivos do banco de forma encadeada.
  // ---------------------------------------------------------------------------
  async reloadDevices() {
    for (const id in this.devices) {
      const dev = this.devices[id];
      if (dev.pollTimeout) clearTimeout(dev.pollTimeout);
      if (dev.retryTimeout) clearTimeout(dev.retryTimeout);
      if (dev.client) {
        try {
          if (dev.client.removeAllListeners) dev.client.removeAllListeners();
          if (dev.client.destroy) dev.client.destroy();
          else dev.client.close(() => {});
        } catch(e) {}
      }
    }
    this.devices = {};

    db.all('SELECT * FROM devices', [], (err, devs) => {
      if (err || !devs) return;

      devs.forEach(device => {
        const devId = device.id;
        this.devices[devId] = {
          info:                   device,
          client:                 null,
          mutex:                  new AsyncMutex(),
          variables:              [],
          alarms:                 [],
          connected:              false,
          connecting:             false,
          connectStartTime:       0,
          lastSuccessPollTime:    Date.now(),
          isPolling:              false,
          retryCount:             0,
          pollTimeout:            null,
          retryTimeout:           null
        };

        // Carregar variáveis e alarmes em ordem antes de tentar conectar
        db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (vErr, vars) => {
          if (!vErr && vars && this.devices[devId]) {
            this.devices[devId].variables = vars;
            vars.forEach(v => {
              if (this.state[v.name] === undefined) {
                this.state[v.name] = v.type === 'analog' ? 0.0 : false;
              }
              if (v.display_name && this.state[v.display_name] === undefined) {
                this.state[v.display_name] = v.type === 'analog' ? 0.0 : false;
              }
              if (this.lastReadTimes[v.id]) {
                this.lastReadTimes[v.name] = this.lastReadTimes[v.id];
                if (v.display_name) this.lastReadTimes[v.display_name] = this.lastReadTimes[v.id];
              }
            });
          }

          db.all('SELECT * FROM alarm_configs WHERE device_id = ?', [devId], (aErr, alarms) => {
            if (!aErr && alarms && this.devices[devId]) {
              this.devices[devId].alarms = alarms;
            }
            this.connectDevice(devId);
          });
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // resetDeviceConnection — Reseta com segurança uma conexão Modbus TCP corrompida.
  // Destrói o socket atual e reagenda uma nova conexão limpa com backoff.
  // ---------------------------------------------------------------------------
  resetDeviceConnection(deviceId, reason) {
    const dev = this.devices[deviceId];
    if (!dev) return;

    console.warn(`[Modbus Reset] Reseta conexão do dispositivo ID ${deviceId} [Offline]: ${reason}`);
    dev.connected  = false;
    dev.connecting = false;
    dev.isPolling  = false;

    if (dev.pollTimeout) {
      clearTimeout(dev.pollTimeout);
      dev.pollTimeout = null;
    }

    // Fechar e desanexar ouvintes de eventos do socket antigo para evitar vazamentos/chamadas fantasmas
    if (dev.client) {
      try {
        if (dev.client.removeAllListeners) dev.client.removeAllListeners();
        if (dev.client.destroy) dev.client.destroy();
        else dev.client.close(() => {});
      } catch(e) {}
      dev.client = null;
    }

    // Se já existe uma reconexão agendada rodando, não cancela nem adia o timer!
    if (dev.retryTimeout) return;

    // Delay de reconexão limitado a 10 segundos no máximo (garante tentativas perpétuas a cada ~10s)
    const delay = Math.min(3000 * Math.pow(1.3, dev.retryCount || 0), 10000);
    dev.retryCount = (dev.retryCount || 0) + 1;

    dev.retryTimeout = setTimeout(() => {
      dev.retryTimeout = null;
      this.connectDevice(deviceId);
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // connectDevice — Estabelece a conexão TCP Modbus com o dispositivo.
  // ---------------------------------------------------------------------------
  connectDevice(deviceId) {
    const dev = this.devices[deviceId];
    if (!dev) return;

    if (dev.connecting) return;
    dev.connecting       = true;
    dev.connectStartTime = Date.now();

    // Limpar conexões e agendamentos anteriores
    if (dev.pollTimeout)  { clearTimeout(dev.pollTimeout);  dev.pollTimeout  = null; }
    if (dev.retryTimeout) { clearTimeout(dev.retryTimeout); dev.retryTimeout = null; }

    if (dev.client) {
      try {
        if (dev.client.removeAllListeners) dev.client.removeAllListeners();
        if (dev.client.destroy) dev.client.destroy();
        else dev.client.close(() => {});
      } catch(e) {}
      dev.client = null;
    }

    console.log(`[Modbus] Conectando ao dispositivo ID ${deviceId} (${dev.info.ip_address}:${dev.info.port})...`);

    // Criar novo client Modbus TCP com timeout de 2 segundos por frame
    const client = new ModbusRTU();
    client.setTimeout(2000);

    // Tratar erros no nível do socket TCP
    client.on('error', (err) => {
      console.warn(`[Modbus Socket Error] ID ${deviceId}: ${err?.message || err}`);
      dev.connecting = false;
      this.resetDeviceConnection(deviceId, err?.message || 'Socket error');
    });

    dev.client = client;

    // Hard Timeout de 5s no handshake TCP para evitar travamento de SO na VPN
    const connectPromise = client.connectTCP(dev.info.ip_address, { port: dev.info.port });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TCP Handshake Timeout (5s)')), 5000)
    );

    Promise.race([connectPromise, timeoutPromise])
      .then(() => {
        console.log(`[Modbus] Dispositivo ID ${deviceId} conectado com sucesso.`);
        dev.client.setID(1);
        dev.connected           = true;
        dev.connecting          = false;
        dev.retryCount          = 0; // Resetar backoff
        dev.lastSuccessPollTime = Date.now();

        // Iniciar ciclo de polling
        this.pollDevice(deviceId);
      })
      .catch(e => {
        console.warn(`[Modbus] Falha ao conectar ID ${deviceId}: ${e?.message || e}`);
        dev.connecting = false;
        this.resetDeviceConnection(deviceId, e?.message || 'Connection failed');
      });
  }

  // ---------------------------------------------------------------------------
  // reloadVariables — Atualiza somente a lista de variáveis de cada dispositivo
  // sem reconectar ou resetar estado. Chamado quando variáveis são
  // adicionadas/editadas/removidas via API.
  // ---------------------------------------------------------------------------
  reloadVariables() {
    for (const devId in this.devices) {
      db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (err, vars) => {
        if (!err && vars && this.devices[devId]) {
          this.devices[devId].variables = vars;
          // Inicializar estado somente para variáveis novas (não sobrescreve existentes)
          vars.forEach(v => {
            if (this.state[v.name] === undefined) {
              this.state[v.name] = v.type === 'analog' ? 0.0 : false;
            }
            if (v.display_name && this.state[v.display_name] === undefined) {
              this.state[v.display_name] = v.type === 'analog' ? 0.0 : false;
            }
          });
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // pollDevice — Ciclo de leitura (poll) de todas as variáveis de um dispositivo.
  //
  // Fluxo:
  //   1. Guard isPolling: cancela se o ciclo anterior ainda não terminou
  //   2. Para cada variável: lê o endereço Modbus conforme o tipo
  //   3. Interpreta o valor bruto (bit_index, escala, offset, decimais)
  //   4. Atualiza this.state e persiste no histórico (se atingiu o intervalo)
  //   5. Processa alarmes em memória
  //   6. Emite evento 'update' com o estado completo
  //   Em caso de erro grave: marca dispositivo como offline e agenda reconexão
  // ---------------------------------------------------------------------------
  async pollDevice(deviceId) {
    const dev = this.devices[deviceId];
    if (!dev || !dev.connected || !dev.client) return;

    // Guard: evita ciclos de polling sobrepostos no mesmo dispositivo
    if (dev.isPolling) return;
    dev.isPolling = true;

    // Adquirir Mutex para impedir que leituras e escritas concorrentes corrompam o socket TCP
    const releaseLock = await dev.mutex.acquire();

    try {
      if (!dev.connected || !dev.client) return;
      // -----------------------------------------------------------------------
      // Helper: parseia as opções JSON de uma variável
      // -----------------------------------------------------------------------
      const parseVarOpts = (v) => {
        try {
          return typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
        } catch(e) { return {}; }
      };

      // -----------------------------------------------------------------------
      // FASE 1: Agrupar variáveis por tipo e construir blocos de leitura
      //
      // Em vez de fazer 1 requisição TCP por variável, agrupamos endereços
      // estritamente consecutivos num único request FC03/FC01/FC04.
      //
      // MAX_GAP = 0: lê apenas registros estritamente contínuos. Isso evita
      // tentar ler endereços não mapeados na memória do CLP que geram Timeout!
      // -----------------------------------------------------------------------
      const MAX_GAP    = 0;   // apenas registros contínuos (sem buracos não mapeados)
      const MAX_BLOCK  = 120; // limite de registros por bloco

      const buildBlocks = (vars, getNumRegs) => {
        if (!vars.length) return [];
        const sorted = [...vars].sort((a, b) => (parseInt(a.modbus_address)||0) - (parseInt(b.modbus_address)||0));
        const blocks = [];
        let block = null;

        for (const v of sorted) {
          const addr   = parseInt(v.modbus_address) || 0;
          const nRegs  = getNumRegs(v);
          const newEnd = addr + nRegs;

          if (!block) {
            block = { start: addr, end: newEnd, vars: [v] };
          } else {
            const gap = addr - block.end;
            if (gap <= MAX_GAP && (newEnd - block.start) <= MAX_BLOCK) {
              block.end = Math.max(block.end, newEnd);
              block.vars.push(v);
            } else {
              blocks.push(block);
              block = { start: addr, end: newEnd, vars: [v] };
            }
          }
        }
        if (block) blocks.push(block);
        return blocks;
      };

      // Separar variáveis por tipo
      const holdingVars  = [], inputVars = [], coilVars = [], discreteVars = [];
      for (const v of dev.variables) {
        const mType = String(v.modbus_type || '').toLowerCase();
        if      (mType === 'holding' || mType === 'holdingregister') holdingVars.push(v);
        else if (mType === 'input'   || mType === 'inputregister')   inputVars.push(v);
        else if (mType === 'coil')                                   coilVars.push(v);
        else if (mType === 'discrete'|| mType === 'inputstatus')     discreteVars.push(v);
      }

      const getNumRegsForVar = (v) => {
        const opts = parseVarOpts(v);
        const df   = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
        return String(df).startsWith('32') ? 2 : 1;
      };

      const holdingBlocks  = buildBlocks(holdingVars,  getNumRegsForVar);
      const inputBlocks    = buildBlocks(inputVars,    getNumRegsForVar);
      const coilBlocks     = buildBlocks(coilVars,    () => 1);
      const discreteBlocks = buildBlocks(discreteVars, () => 1);

      // -----------------------------------------------------------------------
      // FASE 2: Executar leituras em bloco ou diretas (Adaptativo)
      //
      // Se o CLP/Gateway (ex: via VPN Tailscale) não suportar pacotes PDU grandes
      // e der Timeout na leitura em bloco, o sistema ativa dev.disableBlockRead = true.
      // Nos ciclos seguintes, o sistema lê as variáveis diretamente de forma individual,
      // rodando sem nenhum atraso de timeout (~15ms por variável).
      // -----------------------------------------------------------------------
      const blockData = new Map(); // key: `${type}:${startAddr}` → array de dados
      const individualData = new Map(); // key: `${type}:${addr}` → array de dados

      let successfulReadsThisCycle = 0;

      const readVarDirectly = async (type, v, readFn) => {
        const addr = parseInt(v.modbus_address) || 0;
        const nRegs = (type === 'holding' || type === 'input') ? getNumRegsForVar(v) : 1;
        try {
          const res = await readFn(addr, nRegs);
          if (res && res.data) {
            individualData.set(`${type}:${addr}`, res.data);
            successfulReadsThisCycle++;
          }
        } catch(err) {
          console.warn(`[Modbus Warning] Variável '${v.name}' [${type}#${addr}] com falha na leitura: ${err.message}`);
        }
      };

      const readBlock = async (type, block, readFn) => {
        // Se a leitura por bloco foi desativada para este dispositivo ou tipo (por timeout prévio),
        // ou se o bloco contém apenas 1 variável, lê diretamente sem tentar o bloco grande.
        if (dev.disableBlockRead || block.vars.length <= 1) {
          for (const v of block.vars) {
            await readVarDirectly(type, v, readFn);
          }
          return;
        }

        const count = block.end - block.start;
        try {
          const res = await readFn(block.start, count);
          if (res && res.data) {
            blockData.set(`${type}:${block.start}`, res.data);
            successfulReadsThisCycle += block.vars.length;
          }
        } catch(e) {
          console.warn(`[Modbus Warning] Bloco ${type}[${block.start}..${block.end-1}] falhou: ${e.message}. Ativando modo de leitura direta por variável...`);
          // Se deu timeout em bloco grande, memorizar para não atrasar os próximos ciclos
          dev.disableBlockRead = true;

          // Fallback imediato: ler cada variável do bloco separadamente
          for (const v of block.vars) {
            await readVarDirectly(type, v, readFn);
          }
        }
      };

      for (const b of holdingBlocks)  await readBlock('holding',  b, (a,c) => dev.client.readHoldingRegisters(a, c));
      for (const b of inputBlocks)    await readBlock('input',    b, (a,c) => dev.client.readInputRegisters(a, c));
      for (const b of coilBlocks)     await readBlock('coil',     b, (a,c) => dev.client.readCoils(a, c));
      for (const b of discreteBlocks) await readBlock('discrete', b, (a,c) => dev.client.readDiscreteInputs(a, c));

      // -----------------------------------------------------------------------
      // Gerenciar a saúde de conexão real do dispositivo (Online vs Offline)
      // -----------------------------------------------------------------------
      if (dev.variables.length > 0) {
        if (successfulReadsThisCycle === 0) {
          dev.failedPolls = (dev.failedPolls || 0) + 1;
          if (dev.failedPolls >= 2 && dev.connected) {
            console.warn(`[Modbus] Dispositivo ID ${deviceId} desconectado (marcado Offline) devido a falhas consecutivas de comunicação.`);
            dev.connected = false;
          }
        } else {
          dev.failedPolls = 0;
          dev.connected = true;
          dev.lastSuccessPollTime = Date.now();
        }
      }

      // -----------------------------------------------------------------------
      // FASE 3: Extrair valores de cada variável a partir dos blocos ou do fallback
      // -----------------------------------------------------------------------
      const getFromBlockOrIndividual = (typeKey, blocks, addr, nRegs) => {
        // Tentar primeiro do bloco agrupado
        for (const b of blocks) {
          if (addr >= b.start && (addr + nRegs) <= b.end) {
            const data = blockData.get(`${typeKey}:${b.start}`);
            if (data) {
              const offset = addr - b.start;
              return data.slice(offset, offset + nRegs);
            }
          }
        }
        // Tentar do fallback individual
        if (individualData.has(`${typeKey}:${addr}`)) {
          return individualData.get(`${typeKey}:${addr}`);
        }
        return null;
      };

      for (const v of dev.variables) {
        const opts         = parseVarOpts(v);
        const mType        = String(v.modbus_type || '').toLowerCase();
        const wireAddr     = parseInt(v.modbus_address) || 0;
        const dataFormat   = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
        const endianness   = opts.endianness || 'ABCD';
        const numRegisters = String(dataFormat).startsWith('32') ? 2 : 1;

        let rawValue    = null;
        let readSuccess = false;

        if (mType === 'holding' || mType === 'holdingregister') {
          const slice = getFromBlockOrIndividual('holding', holdingBlocks, wireAddr, numRegisters);
          if (slice) { rawValue = parseModbusValue(slice, dataFormat, endianness); readSuccess = true; }

        } else if (mType === 'input' || mType === 'inputregister') {
          const slice = getFromBlockOrIndividual('input', inputBlocks, wireAddr, numRegisters);
          if (slice) { rawValue = parseModbusValue(slice, dataFormat, endianness); readSuccess = true; }

        } else if (mType === 'coil') {
          const slice = getFromBlockOrIndividual('coil', coilBlocks, wireAddr, 1);
          if (slice) {
            rawValue = slice[0];
            readSuccess = true;
            const prevVal = this.state[v.name];
            if (prevVal !== Boolean(rawValue)) {
              console.log(`[Modbus Poll] Coil[${wireAddr}] '${v.name}': ${prevVal} → ${rawValue}`);
            }
          }

        } else if (mType === 'discrete' || mType === 'inputstatus') {
          const slice = getFromBlockOrIndividual('discrete', discreteBlocks, wireAddr, 1);
          if (slice) { rawValue = slice[0]; readSuccess = true; }
        }

        // -------------------------------------------------------------------
        // Interpretação do valor bruto → valor final
        // -------------------------------------------------------------------
        let finalValue;
        if (readSuccess) {
          if (
            opts.bit_index !== undefined &&
            opts.bit_index !== null &&
            parseInt(opts.bit_index) >= 0 &&
            (mType === 'holding' || mType === 'holdingregister' || mType === 'input' || mType === 'inputregister')
          ) {
            const bitIdx = parseInt(opts.bit_index);
            finalValue = ((rawValue >> bitIdx) & 1) === 1;

          } else if (v.type === 'analog') {
            let val = typeof rawValue === 'number' ? rawValue : (typeof rawValue === 'boolean' ? (rawValue ? 1 : 0) : 0);
            if (opts.scale !== undefined && opts.scale !== null && opts.scale !== '' &&
                !isNaN(opts.scale) && parseFloat(opts.scale) !== 1) {
              val = val * parseFloat(opts.scale);
            }
            if (opts.offset !== undefined && opts.offset !== null && opts.offset !== '' &&
                !isNaN(opts.offset) && parseFloat(opts.offset) !== 0) {
              val = val + parseFloat(opts.offset);
            }
            if (v.decimals > 0 && dataFormat !== '32_float') {
              finalValue = val / Math.pow(10, v.decimals || 0);
            } else {
              finalValue = val;
            }

          } else if (v.type === 'boolean') {
            finalValue = Boolean(rawValue);

          } else {
            finalValue = rawValue;
          }
        } else {
          finalValue = this.state[v.name] !== undefined ? this.state[v.name] : 0;
        }

        // Atualizar estado global
        this.state[v.name] = finalValue;
        if (v.display_name) this.state[v.display_name] = finalValue;

        if (readSuccess) {
          const nowMs = Date.now();
          this.lastReadTimes[v.id] = nowMs;
          this.lastReadTimes[v.name] = nowMs;
          if (v.display_name) this.lastReadTimes[v.display_name] = nowMs;
        }

        // -------------------------------------------------------------------
        // Persistência no histórico
        // -------------------------------------------------------------------
        const intervalMs = (this.historyIntervalSeconds || 15) * 1000;
        const nowMs      = Date.now();
        if (!this.lastHistoryLogTime[v.id] || (nowMs - this.lastHistoryLogTime[v.id]) >= intervalMs) {
          this.lastHistoryLogTime[v.id] = nowMs;
          db.run(
            `INSERT INTO variable_history (variable_id, value, timestamp) VALUES (?, ?, ?)`,
            [v.id, finalValue, new Date(nowMs).toISOString()]
          );
        }
      } // fim do loop de variáveis

      // -----------------------------------------------------------------------
      // Processamento de Alarmes em Memória (alta performance — sem I/O por alarme)
      // Reutiliza o valor já lido das variáveis através de this.state para
      // evitar duplicar requisições Modbus (era a causa da sobreposição de poll).
      // -----------------------------------------------------------------------
      if (dev.alarms && dev.alarms.length > 0) {
        for (const alarm of dev.alarms) {
          // Buscar o valor já lido da variável correspondente no estado global
          // Procura primeiro pelo nome técnico da variável vinculada ao alarme
          let rawAlarmVal;

          // Tentar localizar a variável do alarme pelo device_id + endereço
          const alarmVar = (dev.variables || []).find(v => {
            const vType = String(v.modbus_type || '').toLowerCase();
            const aType = String(alarm.modbus_type || '').toLowerCase();
            return (
              vType === aType &&
              parseInt(v.modbus_address) === parseInt(alarm.modbus_address)
            );
          });

          if (alarmVar && this.state[alarmVar.name] !== undefined) {
            // Variável encontrada: usar valor já lido neste ciclo
            rawAlarmVal = this.state[alarmVar.name];
            // Para alarmes booleanos, converter para 0/1
            if (typeof rawAlarmVal === 'boolean') rawAlarmVal = rawAlarmVal ? 1 : 0;
          } else {
            // Variável não cadastrada no dashboard: fazer leitura pontual
            // (caso raro: alarme configurado em endereço não monitorado)
            const aType = String(alarm.modbus_type || '').toLowerCase();
            const wireAlarmAddr = Math.max(0, parseInt(alarm.modbus_address) || 0);
            try {
              if (aType === 'holding' || aType === 'holdingregister') {
                const res = await dev.client.readHoldingRegisters(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? res.data[0] : undefined;
              } else if (aType === 'input' || aType === 'inputregister') {
                const res = await dev.client.readInputRegisters(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? res.data[0] : undefined;
              } else if (aType === 'coil') {
                const res = await dev.client.readCoils(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? (res.data[0] ? 1 : 0) : undefined;
              } else if (aType === 'discrete' || aType === 'inputstatus') {
                const res = await dev.client.readDiscreteInputs(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? (res.data[0] ? 1 : 0) : undefined;
              }
            } catch(errAlarm) {
              rawAlarmVal = undefined;
            }
          }

          if (rawAlarmVal === undefined) continue;

          // Avaliar condição do alarme em memória (sem acesso ao banco)
          const conditionMet      = this.evaluateCondition(rawAlarmVal, alarm.condition_type, alarm.condition_value);
          const isCurrentlyActive = this.activeAlarmsSet.has(alarm.id);

          if (conditionMet && !isCurrentlyActive) {
            // Alarme novo: ativar e registrar no banco
            this.activeAlarmsSet.add(alarm.id);
            db.run(
              `INSERT INTO alarm_history (alarm_config_id, trigger_value, status) VALUES (?, ?, 'ACTIVE')`,
              [alarm.id, rawAlarmVal],
              () => { this.emit('alarms_updated'); }
            );
          } else if (!conditionMet && isCurrentlyActive) {
            // Alarme resolvido: desativar e registrar no banco
            this.activeAlarmsSet.delete(alarm.id);
            db.run(
              `UPDATE alarm_history SET status = 'RESOLVED', resolve_time = CURRENT_TIMESTAMP
               WHERE alarm_config_id = ? AND status = 'ACTIVE'`,
              [alarm.id],
              () => { this.emit('alarms_updated'); }
            );
          }
        }
      }

      // Emitir o estado completo e timestamps retentivos para o frontend via WebSocket
      this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });

    } catch (e) {
      console.error(`[Modbus Critical] Erro na leitura do dispositivo ID ${deviceId}: ${e.message}`);
      this.resetDeviceConnection(deviceId, e.message);

    } finally {
      // Liberar a trava de exclusão mútua do socket Modbus TCP
      releaseLock();

      // Liberar o guard de polling ao final do ciclo
      dev.isPolling = false;

      // Se o dispositivo continua conectado, agendar o próximo ciclo de poll
      if (dev.connected) {
        if (dev.pollTimeout) clearTimeout(dev.pollTimeout);
        dev.pollTimeout = setTimeout(
          () => this.pollDevice(deviceId),
          dev.info.polling_interval_ms || 1000
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // writeModbus — Escreve um valor em um registrador Modbus.
  // Sincronizado por Mutex para NUNCA intercalar no socket durante uma leitura.
  // ---------------------------------------------------------------------------
  async writeModbus(deviceId, modbus_type, address, value, decimals = 0, bit_index = -1, var_name = null) {
    const dev      = this.devices[deviceId];
    const mType    = String(modbus_type || '').toLowerCase();
    const wireAddr = Math.max(0, parseInt(address) || 0);

    console.log(`[Modbus Write] Dispositivo=${deviceId} Tipo=${mType} Endereço=${wireAddr} Valor=${value} Bit=${bit_index} Var=${var_name}`);

    const updateState = (val) => {
      if (!var_name) return;
      this.state[var_name] = val;
      for (const devId in this.devices) {
        const vars  = this.devices[devId].variables || [];
        const found = vars.find(v => v.name === var_name);
        if (found && found.display_name) {
          this.state[found.display_name] = val;
        }
      }
    };

    // Dispositivo offline ou inexistente: atualiza estado local em memória apenas
    if (!dev || !dev.connected || !dev.client) {
      console.warn(`[Modbus Write] Dispositivo ${deviceId} offline — atualizando estado em memória apenas.`);
      if (mType === 'coil') {
        updateState(Boolean(value));
      } else if ((mType === 'holding' || mType === 'holdingregister') && parseInt(bit_index) >= 0) {
        const bitIdx  = parseInt(bit_index);
        const curWord = parseInt(this.state[var_name]) || 0;
        const newWord = Boolean(value) ? (curWord | (1 << bitIdx)) : (curWord & ~(1 << bitIdx));
        updateState(Boolean((newWord >> bitIdx) & 1));
      } else {
        updateState(value);
      }
      this.emit('update', this.state);
      return true;
    }

    // Adquirir a trava de exclusão mútua do socket TCP
    const releaseLock = await dev.mutex.acquire();

    try {
      if (!dev.connected || !dev.client) {
        updateState(value);
        this.emit('update', this.state);
        return true;
      }

      if (mType === 'coil') {
        const boolVal = Boolean(value);
        console.log(`[Modbus Write] writeCoil(addr=${wireAddr}, val=${boolVal})`);
        await dev.client.writeCoil(wireAddr, boolVal);
        updateState(boolVal);

      } else if (mType === 'holding' || mType === 'holdingregister') {
        if (bit_index !== undefined && bit_index !== null && parseInt(bit_index) >= 0) {
          const bitIdx  = parseInt(bit_index);
          let curWord   = 0;
          try {
            const res = await dev.client.readHoldingRegisters(wireAddr, 1);
            if (res && res.data) curWord = res.data[0];
          } catch(e) {
            console.warn(`[Modbus Write] Não foi possível ler word atual em [${wireAddr}] — usando 0 como base`);
          }
          const newWord = Boolean(value)
            ? (curWord |  (1 << bitIdx))
            : (curWord & ~(1 << bitIdx));
          console.log(`[Modbus Write] writeRegister(addr=${wireAddr}, word=${newWord}) bit#${bitIdx}=${Boolean(value)}`);
          await dev.client.writeRegister(wireAddr, newWord);
          updateState(Boolean((newWord >> bitIdx) & 1));

        } else {
          let dataFormat = '16_int';
          let endianness = 'ABCD';
          let varScale   = null;
          let varOffset  = null;
          let varDecimals = decimals || 0;

          if (var_name) {
            const vars = dev.variables || [];
            const found = vars.find(v => v.name === var_name);
            if (found) {
              let opts = {};
              try {
                opts = typeof found.options === 'string' ? JSON.parse(found.options || '{}') : (found.options || {});
              } catch(e) { opts = {}; }

              if (opts.data_format) dataFormat = opts.data_format;
              if (opts.endianness)  endianness  = opts.endianness;
              if (opts.scale  !== undefined && opts.scale  !== null && opts.scale  !== '') varScale  = parseFloat(opts.scale);
              if (opts.offset !== undefined && opts.offset !== null && opts.offset !== '') varOffset = parseFloat(opts.offset);
              if (found.decimals !== undefined && found.decimals !== null) varDecimals = parseInt(found.decimals) || 0;
            }
          }

          const is32Bit = String(dataFormat).startsWith('32');
          const isFloat = dataFormat === '32_float';

          let valueToEncode = Number(value);
          if (!isFloat) {
            if (varOffset !== null && !isNaN(varOffset) && varOffset !== 0) {
              valueToEncode = valueToEncode - varOffset;
            }
            if (varScale !== null && !isNaN(varScale) && varScale !== 0 && varScale !== 1) {
              valueToEncode = valueToEncode / varScale;
            }
          }

          console.log(`[Modbus Write] Holding fmt=${dataFormat} end=${endianness} scale=${varScale} offset=${varOffset} dec=${varDecimals} userVal=${value} encoded=${valueToEncode}`);

          if (is32Bit) {
            const valToWrite = isFloat ? valueToEncode : Math.round(valueToEncode * Math.pow(10, varDecimals));
            const buf = Buffer.alloc(4);
            
            if (isFloat) buf.writeFloatBE(valToWrite, 0);
            else if (dataFormat === '32_int')  buf.writeInt32BE(valToWrite, 0);
            else                               buf.writeUInt32BE(valToWrite >>> 0, 0);

            const A = buf[0], B = buf[1], C = buf[2], D = buf[3];
            let finalBytes;
            switch (endianness) {
              case 'BADC': finalBytes = [B, A, D, C]; break;
              case 'DCBA': finalBytes = [D, C, B, A]; break;
              case 'CDAB': finalBytes = [C, D, A, B]; break;
              case 'ABCD':
              default:     finalBytes = [A, B, C, D]; break;
            }
            const w1 = ((finalBytes[0] << 8) | finalBytes[1]) & 0xFFFF;
            const w2 = ((finalBytes[2] << 8) | finalBytes[3]) & 0xFFFF;
            const words = [w1, w2];
            
            console.log(`[Modbus Write] FC16 writeRegisters(addr=${wireAddr}, words=[${w1}, ${w2}]) rawVal=${valToWrite}`);
            await dev.client.writeRegisters(wireAddr, words);

          } else {
            const rawValue = Math.round(valueToEncode * Math.pow(10, varDecimals));
            console.log(`[Modbus Write] FC06 writeRegister(addr=${wireAddr}, raw=${rawValue}) encoded=${valueToEncode}`);
            await dev.client.writeRegister(wireAddr, rawValue);
          }

          updateState(Number(value));
        }
      } else {
        throw new Error(`Tipo Modbus '${mType}' não suporta escrita direta.`);
      }

      this.emit('update', this.state);
      return true;

    } catch(err) {
      console.error(`[Modbus Write Error] ID ${deviceId}: ${err.message}`);
      this.resetDeviceConnection(deviceId, `Falha na escrita: ${err.message}`);
      throw err;

    } finally {
      releaseLock();
    }
  }

  // ---------------------------------------------------------------------------
  // evaluateCondition — Avalia se um valor atual satisfaz a condição de um alarme.
  //
  // Operadores suportados: ==, !=, >, >=, <, <=
  // Todos os valores são comparados como números de ponto flutuante.
  // ---------------------------------------------------------------------------
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
}

// Criar a instância singleton do serviço — compartilhada por todo o backend
const plc = new PLCService();
module.exports = plc;
