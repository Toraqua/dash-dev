// =============================================================================
// plc.js — Serviço de Comunicação Modbus TCP/IP (Driver Industrial Modernizado)
// Refatorado com FSM, Proprietário Único do Socket, Fila de Prioridades (P0-P3),
// Single In-Flight Request, Smart Chunking, Circuit Breaker e Logging Assíncrono.
// =============================================================================

const EventEmitter = require('events');
const db           = require('./db');

// Módulos industriais Modbus
const ModbusChannel = require('./modbus/ModbusChannel');
const scheduler     = require('./modbus/ModbusScheduler');
const circuitBreaker= require('./modbus/ModbusCircuitBreaker');
const logger        = require('./modbus/ModbusLogger');
const metrics       = require('./modbus/ModbusMetrics');

// =============================================================================
// parseModbusValue — Interpreta os registros brutos do Modbus de acordo com
// o formato de dados (16_int, 16_uint, 32_int, 32_uint, 32_float) e ordem dos
// bytes (endianness: ABCD, BADC, DCBA, CDAB).
// =============================================================================
function parseModbusValue(registers, dataFormat = '16_int', endianness = 'ABCD') {
  if (!registers || !registers.length) return 0;

  const is32Bit = String(dataFormat).startsWith('32');

  if (is32Bit) {
    const w1 = registers[0] || 0;
    const w2 = registers[1] || 0;
    const A = (w1 >> 8) & 0xFF;
    const B =  w1       & 0xFF;
    const C = (w2 >> 8) & 0xFF;
    const D =  w2       & 0xFF;

    let bytes;
    switch (endianness) {
      case 'BADC': bytes = [B, A, D, C]; break;
      case 'DCBA': bytes = [D, C, B, A]; break;
      case 'CDAB': bytes = [C, D, A, B]; break;
      case 'ABCD':
      default:     bytes = [A, B, C, D]; break;
    }

    const buf = Buffer.from(bytes);
    if      (dataFormat === '32_int')   return buf.readInt32BE(0);
    else if (dataFormat === '32_uint')  return buf.readUInt32BE(0);
    else {
      const f = buf.readFloatBE(0);
      return (isNaN(f) || !isFinite(f)) ? 0 : f;
    }
  } else {
    const w1 = registers[0] || 0;
    const A  = (w1 >> 8) & 0xFF;
    const B  =  w1       & 0xFF;

    let bytes;
    if (endianness === 'BADC' || endianness === 'DCBA') {
      bytes = [B, A];
    } else {
      bytes = [A, B];
    }

    const buf = Buffer.from(bytes);
    if (dataFormat === '16_uint') return buf.readUInt16BE(0);
    else                          return buf.readInt16BE(0);
  }
}

// =============================================================================
// PLCService — Serviço principal do supervisório para gestão de dispositivos
// =============================================================================
class PLCService extends EventEmitter {
  constructor() {
    super();

    // Estado global de todas as variáveis: { nome_variavel: valor }
    this.state = { connected: true };

    // Canais Modbus por dispositivo: { device_id: ModbusChannel }
    this.channels = {};

    // Dados auxiliares de cada dispositivo (info, variables, alarms)
    this.deviceMetadata = {};

    // Intervalos e timestamps retentivos
    this.historyIntervalSeconds = 15;
    this.lastHistoryLogTime = {};
    this.lastReadTimes = {};
    this.activeAlarmsSet = new Set();

    this.init();
  }

  // Compatibilidade legada com APIs que consultam plc.devices
  get devices() {
    const map = {};
    for (const id in this.channels) {
      const channel = this.channels[id];
      const meta = this.deviceMetadata[id];
      map[id] = {
        connected: channel ? channel.state === 'ONLINE' : false,
        info: meta ? meta.info : null,
        state: channel ? channel.state : 'STOPPED'
      };
    }
    return map;
  }

  init() {
    this.loadGeneralConfig();
    this.loadActiveAlarms();
    this.loadLastReadTimesFromDb();
    this.reloadDevices();
    this.startWatchdog();
  }

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

  loadActiveAlarms() {
    db.all(`SELECT alarm_config_id FROM alarm_history WHERE status = 'ACTIVE'`, [], (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => this.activeAlarmsSet.add(r.alarm_config_id));
      }
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
        } catch(e) {}
      }
    });
  }

  // Watchdog Passivo: Apenas monitora o estado FSM sem forçar comandos no socket
  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      for (const devId in this.channels) {
        const channel = this.channels[devId];
        if (!channel) continue;

        // Se o canal estiver DISCONNECTED por algum motivo, solicita início
        if (channel.state === 'DISCONNECTED') {
          logger.info(`[Watchdog Modbus] Dispositivo ID ${devId} em DISCONNECTED. Disparando connect()...`, { deviceId: devId });
          channel.connect();
        }
      }
    }, 10000);
  }

  // Recarrega todos os dispositivos do banco
  async reloadDevices() {
    // Parar todos os canais existentes com segurança
    for (const devId in this.channels) {
      if (this.channels[devId]) {
        this.channels[devId].stop();
      }
    }
    this.channels = {};
    this.deviceMetadata = {};

    db.all('SELECT * FROM devices', [], (err, devs) => {
      if (err || !devs) return;

      devs.forEach(device => {
        const devId = device.id;

        // Criar o canal único proprietário do dispositivo
        const channel = new ModbusChannel(device);
        this.channels[devId] = channel;

        this.deviceMetadata[devId] = {
          info: device,
          variables: [],
          alarms: [],
          pollTimer: null
        };

        // Quando o estado do canal mudar para ONLINE, inicia o polling periódico
        channel.onStateChange = (oldState, newState) => {
          if (newState === 'ONLINE') {
            this.startPollingLoop(devId);
          } else if (newState === 'STOPPED' || newState === 'BACKOFF') {
            if (this.deviceMetadata[devId]?.pollTimer) {
              clearTimeout(this.deviceMetadata[devId].pollTimer);
              this.deviceMetadata[devId].pollTimer = null;
            }
          }
        };

        // Carregar variáveis e alarmes
        db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (vErr, vars) => {
          if (!vErr && vars && this.deviceMetadata[devId]) {
            this.deviceMetadata[devId].variables = vars;
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
            if (!aErr && alarms && this.deviceMetadata[devId]) {
              this.deviceMetadata[devId].alarms = alarms;
            }
            // Iniciar o canal Modbus
            channel.start();
          });
        });
      });
    });
  }

  reloadVariables() {
    for (const devId in this.deviceMetadata) {
      db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (err, vars) => {
        if (!err && vars && this.deviceMetadata[devId]) {
          this.deviceMetadata[devId].variables = vars;
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
  // Loop de Polling Periódico (Telemetria P3)
  // ---------------------------------------------------------------------------
  startPollingLoop(deviceId) {
    const meta = this.deviceMetadata[deviceId];
    if (!meta) return;

    if (meta.pollTimer) clearTimeout(meta.pollTimer);

    const pollIntervalMs = meta.info.polling_interval_ms || 1000;

    const executeCycle = async () => {
      const channel = this.channels[deviceId];
      if (!channel || channel.state !== 'ONLINE') return;

      try {
        await this.pollDevice(deviceId);
      } catch (e) {
        logger.warn(`[Polling Cycle Error] ID ${deviceId}: ${e.message}`);
      } finally {
        if (this.channels[deviceId] && this.channels[deviceId].state === 'ONLINE') {
          meta.pollTimer = setTimeout(executeCycle, pollIntervalMs);
        }
      }
    };

    meta.pollTimer = setTimeout(executeCycle, 50);
  }

  // ---------------------------------------------------------------------------
  // pollDevice — Varredura de Telemetria com Smart Chunking e Fallback Binário
  // ---------------------------------------------------------------------------
  async pollDevice(deviceId) {
    const channel = this.channels[deviceId];
    const meta = this.deviceMetadata[deviceId];
    if (!channel || channel.state !== 'ONLINE' || !meta) return;

    const vars = meta.variables || [];
    if (!vars.length) return;

    const parseVarOpts = (v) => {
      try { return typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {}); }
      catch(e) { return {}; }
    };

    const getNumRegsForVar = (v) => {
      const opts = parseVarOpts(v);
      const df   = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
      return String(df).startsWith('32') ? 2 : 1;
    };

    // Separar por função Modbus
    const holdingVars = [], inputVars = [], coilVars = [], discreteVars = [];
    for (const v of vars) {
      const mType = String(v.modbus_type || '').toLowerCase();
      if      (mType === 'holding' || mType === 'holdingregister') holdingVars.push(v);
      else if (mType === 'input'   || mType === 'inputregister')   inputVars.push(v);
      else if (mType === 'coil')                                   coilVars.push(v);
      else if (mType === 'discrete'|| mType === 'inputstatus')     discreteVars.push(v);
    }

    // Agrupamento Inteligente (Smart Chunking)
    const holdingBlocks  = scheduler.buildBlocks(holdingVars,  'holding',  getNumRegsForVar);
    const inputBlocks    = scheduler.buildBlocks(inputVars,    'input',    getNumRegsForVar);
    const coilBlocks     = scheduler.buildBlocks(coilVars,    'coil',     () => 1);
    const discreteBlocks = scheduler.buildBlocks(discreteVars, 'discrete', () => 1);

    const blockDataMap = new Map();

    // Helper para executar leitura de bloco via Fila com Prioridade P3 (Telemetria)
    const readBlockWithFallback = async (typeKey, block, readFnName) => {
      const count = block.end - block.start;
      const key = `poll:${typeKey}:${block.start}:${count}`;

      try {
        const data = await channel.request({
          priority: 3, // P3: Telemetria Normal
          deadline: Date.now() + 15000,
          key,
          execute: async (client) => {
            const res = await client[readFnName](block.start, count);
            return res ? res.data : null;
          }
        });

        if (data) {
          blockDataMap.set(`${typeKey}:${block.start}`, data);
        }
      } catch (err) {
        metrics.recordBlockFailure();
        logger.warn(`[Modbus Poll] Bloco ${typeKey}[${block.start}..${block.end - 1}] falhou: ${err.message}. Iniciando divisão binária...`);

        // Fallback por Divisão Binária (32 -> 16 -> 8 -> 4 -> 2 -> 1)
        const subBlocks = circuitBreaker.splitBlock(block);
        for (const subBlock of subBlocks) {
          const subCount = subBlock.end - subBlock.start;
          try {
            const subData = await channel.request({
              priority: 3,
              deadline: Date.now() + 15000,
              key: `poll:${typeKey}:${subBlock.start}:${subCount}`,
              execute: async (client) => {
                const res = await client[readFnName](subBlock.start, subCount);
                return res ? res.data : null;
              }
            });
            if (subData) {
              blockDataMap.set(`${typeKey}:${subBlock.start}`, subData);
            }
          } catch (subErr) {
            // Se o sub-bloco individual de 1 registrador falhou por erro de endereço, coloca em quarentena
            if (subBlock.vars.length === 1 && circuitBreaker.isConfigurationError(subErr)) {
              const badVar = subBlock.vars[0];
              circuitBreaker.quarantine(typeKey, parseInt(badVar.modbus_address) || 0, subErr.message);
            }
          }
        }
      }
    };

    // Executar varredura dos blocos agrupados
    for (const b of holdingBlocks)  await readBlockWithFallback('holding',  b, 'readHoldingRegisters');
    for (const b of inputBlocks)    await readBlockWithFallback('input',    b, 'readInputRegisters');
    for (const b of coilBlocks)     await readBlockWithFallback('coil',     b, 'readCoils');
    for (const b of discreteBlocks) await readBlockWithFallback('discrete', b, 'readDiscreteInputs');

    // Extrair valores de cada variável a partir dos dados lidos nos blocos
    const nowMs = Date.now();

    for (const v of vars) {
      const opts         = parseVarOpts(v);
      const mType        = String(v.modbus_type || '').toLowerCase();
      const wireAddr     = parseInt(v.modbus_address) || 0;
      const dataFormat   = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
      const endianness   = opts.endianness || 'ABCD';
      const numRegisters = String(dataFormat).startsWith('32') ? 2 : 1;

      let rawValue    = null;
      let readSuccess = false;

      let typeKey = 'holding';
      if      (mType === 'input'    || mType === 'inputregister')   typeKey = 'input';
      else if (mType === 'coil')                                    typeKey = 'coil';
      else if (mType === 'discrete' || mType === 'inputstatus')     typeKey = 'discrete';

      // Buscar o trecho correspondente no mapa de blocos lidos
      for (const [key, dataArr] of blockDataMap.entries()) {
        const [bType, bStartStr] = key.split(':');
        const bStart = parseInt(bStartStr);
        if (bType === typeKey && wireAddr >= bStart && (wireAddr + numRegisters) <= (bStart + dataArr.length)) {
          const offset = wireAddr - bStart;
          const slice = dataArr.slice(offset, offset + numRegisters);

          if (typeKey === 'holding' || typeKey === 'input') {
            rawValue = parseModbusValue(slice, dataFormat, endianness);
          } else {
            rawValue = slice[0];
          }
          readSuccess = true;
          break;
        }
      }

      // Processar valor final
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

        this.lastReadTimes[v.id] = nowMs;
        this.lastReadTimes[v.name] = nowMs;
        if (v.display_name) this.lastReadTimes[v.display_name] = nowMs;
      } else {
        finalValue = this.state[v.name] !== undefined ? this.state[v.name] : 0;
      }

      // Atualizar estado global
      this.state[v.name] = finalValue;
      if (v.display_name) this.state[v.display_name] = finalValue;

      // Persistência de Histórico
      const intervalMs = (this.historyIntervalSeconds || 15) * 1000;
      if (!this.lastHistoryLogTime[v.id] || (nowMs - this.lastHistoryLogTime[v.id]) >= intervalMs) {
        this.lastHistoryLogTime[v.id] = nowMs;
        db.run(
          `INSERT INTO variable_history (variable_id, value, timestamp) VALUES (?, ?, ?)`,
          [v.id, finalValue, new Date(nowMs).toISOString()]
        );
      }
    }

    // Processar Alarmes
    if (meta.alarms && meta.alarms.length > 0) {
      this.processAlarms(meta.alarms, vars);
    }

    // Publicar evento de atualização para a WebUI via Socket.IO
    this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });
  }

  processAlarms(alarms, vars) {
    for (const alarm of alarms) {
      let rawAlarmVal;
      const alarmVar = (vars || []).find(v => {
        const vType = String(v.modbus_type || '').toLowerCase();
        const aType = String(alarm.modbus_type || '').toLowerCase();
        return vType === aType && parseInt(v.modbus_address) === parseInt(alarm.modbus_address);
      });

      if (alarmVar && this.state[alarmVar.name] !== undefined) {
        rawAlarmVal = this.state[alarmVar.name];
        if (typeof rawAlarmVal === 'boolean') rawAlarmVal = rawAlarmVal ? 1 : 0;
      }

      if (rawAlarmVal === undefined) continue;

      const conditionMet = this.evaluateCondition(rawAlarmVal, alarm.condition_type, alarm.condition_value);
      const isCurrentlyActive = this.activeAlarmsSet.has(alarm.id);

      if (conditionMet && !isCurrentlyActive) {
        this.activeAlarmsSet.add(alarm.id);
        db.run(
          `INSERT INTO alarm_history (alarm_config_id, trigger_value, status) VALUES (?, ?, 'ACTIVE')`,
          [alarm.id, rawAlarmVal],
          () => { this.emit('alarms_updated'); }
        );
      } else if (!conditionMet && isCurrentlyActive) {
        this.activeAlarmsSet.delete(alarm.id);
        db.run(
          `UPDATE alarm_history SET status = 'RESOLVED', resolve_time = CURRENT_TIMESTAMP WHERE alarm_config_id = ? AND status = 'ACTIVE'`,
          [alarm.id],
          () => { this.emit('alarms_updated'); }
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // writeModbus — Comandos do Operador (Prioridade P1)
  // ---------------------------------------------------------------------------
  async writeModbus(deviceId, modbus_type, address, value, decimals = 0, bit_index = -1, var_name = null) {
    const channel = this.channels[deviceId];
    const mType   = String(modbus_type || '').toLowerCase();
    const wireAddr = Math.max(0, parseInt(address) || 0);

    logger.info(`[Modbus Write Request] Dispositivo=${deviceId} Tipo=${mType} Endereço=${wireAddr} Valor=${value} Bit=${bit_index} Var=${var_name}`);

    const updateState = (val) => {
      if (!var_name) return;
      this.state[var_name] = val;
      const meta = this.deviceMetadata[deviceId];
      if (meta && meta.variables) {
        const found = meta.variables.find(v => v.name === var_name);
        if (found && found.display_name) {
          this.state[found.display_name] = val;
        }
      }
    };

    if (!channel || channel.state !== 'ONLINE') {
      logger.warn(`[Modbus Write] Dispositivo ${deviceId} offline/ausente — atualizando estado em memória.`);
      updateState(value);
      this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });
      return true;
    }

    // Dispara requisição com Prioridade P1 na Fila
    return channel.request({
      priority: 1, // P1: Comando de Operador
      deadline: Date.now() + 15000,
      key: `write:${mType}:${wireAddr}`,
      execute: async (client) => {
        if (mType === 'coil') {
          const boolVal = Boolean(value);
          await client.writeCoil(wireAddr, boolVal);
          updateState(boolVal);

        } else if (mType === 'holding' || mType === 'holdingregister') {
          if (bit_index !== undefined && bit_index !== null && parseInt(bit_index) >= 0) {
            const bitIdx = parseInt(bit_index);
            let curWord = 0;
            try {
              const res = await client.readHoldingRegisters(wireAddr, 1);
              if (res && res.data) curWord = res.data[0];
            } catch(e) {}

            const newWord = Boolean(value) ? (curWord | (1 << bitIdx)) : (curWord & ~(1 << bitIdx));
            await client.writeRegister(wireAddr, newWord);
            updateState(Boolean((newWord >> bitIdx) & 1));

          } else {
            let dataFormat = '16_int';
            let endianness = 'ABCD';
            let varScale = null;
            let varOffset = null;
            let varDecimals = decimals || 0;

            const meta = this.deviceMetadata[deviceId];
            if (var_name && meta && meta.variables) {
              const found = meta.variables.find(v => v.name === var_name);
              if (found) {
                let opts = {};
                try { opts = typeof found.options === 'string' ? JSON.parse(found.options || '{}') : (found.options || {}); }
                catch(e) { opts = {}; }

                if (opts.data_format) dataFormat = opts.data_format;
                if (opts.endianness)  endianness  = opts.endianness;
                if (opts.scale !== undefined && opts.scale !== null && opts.scale !== '') varScale = parseFloat(opts.scale);
                if (opts.offset !== undefined && opts.offset !== null && opts.offset !== '') varOffset = parseFloat(opts.offset);
                if (found.decimals !== undefined && found.decimals !== null) varDecimals = parseInt(found.decimals) || 0;
              }
            }

            const is32Bit = String(dataFormat).startsWith('32');
            const isFloat = dataFormat === '32_float';
            let valueToEncode = Number(value);

            if (!isFloat) {
              if (varOffset !== null && !isNaN(varOffset) && varOffset !== 0) valueToEncode = valueToEncode - varOffset;
              if (varScale !== null && !isNaN(varScale) && varScale !== 0 && varScale !== 1) valueToEncode = valueToEncode / varScale;
            }

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
              await client.writeRegisters(wireAddr, [w1, w2]);

            } else {
              const rawValue = Math.round(valueToEncode * Math.pow(10, varDecimals));
              await client.writeRegister(wireAddr, rawValue);
            }

            updateState(Number(value));
          }
        } else {
          throw new Error(`Tipo Modbus '${mType}' não suporta escrita.`);
        }

        this.emit('update', { state: this.state, lastReadTimes: this.lastReadTimes });
        return true;
      }
    });
  }

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
}

const plc = new PLCService();
module.exports = plc;
