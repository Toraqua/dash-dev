const EventEmitter = require('events');
const db = require('./db');
const ModbusRTU = require('modbus-serial');

function parseModbusValue(registers, dataFormat = '16_int', endianness = 'ABCD') {
  if (!registers || !registers.length) return 0;

  const is32Bit = String(dataFormat).startsWith('32');
  if (is32Bit) {
    const w1 = registers[0] || 0;
    const w2 = registers[1] || 0;
    const A = (w1 >> 8) & 0xFF;
    const B = w1 & 0xFF;
    const C = (w2 >> 8) & 0xFF;
    const D = w2 & 0xFF;

    let bytes;
    switch (endianness) {
      case 'BADC': bytes = [B, A, D, C]; break;
      case 'DCBA': bytes = [D, C, B, A]; break;
      case 'CDAB': bytes = [C, D, A, B]; break;
      case 'ABCD':
      default:     bytes = [A, B, C, D]; break;
    }

    const buf = Buffer.from(bytes);
    if (dataFormat === '32_int') {
      return buf.readInt32BE(0);
    } else if (dataFormat === '32_uint') {
      return buf.readUInt32BE(0);
    } else {
      // 32_float (Default 32-bit Float IEEE 754)
      const f = buf.readFloatBE(0);
      return isNaN(f) || !isFinite(f) ? 0 : f;
    }
  } else {
    // 16-bit (1 Register)
    const w1 = registers[0] || 0;
    const A = (w1 >> 8) & 0xFF;
    const B = w1 & 0xFF;

    let bytes;
    if (endianness === 'BADC' || endianness === 'DCBA') {
      bytes = [B, A]; // Little byte
    } else {
      bytes = [A, B]; // Big byte
    }

    const buf = Buffer.from(bytes);
    if (dataFormat === '16_uint') {
      return buf.readUInt16BE(0);
    } else {
      return buf.readInt16BE(0);
    }
  }
}

class PLCService extends EventEmitter {
  constructor() {
    super();
    this.state = {
      connected: true, // Legacy compatibility
    };
    this.devices = {}; // device_id -> { client, variables, interval }
    this.historyIntervalSeconds = 15;
    this.lastHistoryLogTime = {};
    this.activeAlarmsSet = new Set();
    this.init();
  }

  init() {
    this.loadGeneralConfig();
    this.loadActiveAlarms();
    this.reloadDevices();
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
      if (row && row.value) {
        try {
          const cfg = JSON.parse(row.value);
          this.historyIntervalSeconds = parseInt(cfg.history_interval_seconds) || 15;
        } catch(e) {
          this.historyIntervalSeconds = 15;
        }
      } else {
        this.historyIntervalSeconds = 15;
      }
    });
  }

  async reloadDevices() {
    for (const id in this.devices) {
      clearInterval(this.devices[id].intervalId);
      if (this.devices[id].client) {
        this.devices[id].client.close();
      }
    }
    this.devices = {};

    db.all('SELECT * FROM devices', [], (err, devs) => {
      if (err || !devs) return;
      
      devs.forEach(device => {
        const client = new ModbusRTU();
        client.setTimeout(2000);
        client.on('error', (err) => {
          console.error(`Socket error on Modbus ID ${device.id}: ${err.message}`);
        });
        
        this.devices[device.id] = {
          info: device,
          client: client,
          variables: [],
          alarms: [],
          connected: false
        };

        // Load variables for this device
        db.all('SELECT * FROM variables WHERE device_id = ?', [device.id], (err, vars) => {
          if (!err && vars) {
            this.devices[device.id].variables = vars;
            vars.forEach(v => {
               this.state[v.name] = v.type === 'analog' ? 0.0 : false;
            });
            this.emit('update', this.state);
          }
        });
        
        // Load alarms for this device
        db.all('SELECT * FROM alarm_configs WHERE device_id = ?', [device.id], (err, alarms) => {
          if (!err && alarms) {
            this.devices[device.id].alarms = alarms;
          }
        });

        // Start connection attempts
        this.connectDevice(device.id);
      });
    });
  }

  connectDevice(deviceId) {
    const dev = this.devices[deviceId];
    if (!dev) return;

    console.log(`Tentando conectar ao dispositivo Modbus ID ${deviceId} (${dev.info.ip_address}:${dev.info.port})...`);
    
    const client = new ModbusRTU();
    client.setTimeout(2000);
    client.on('error', (err) => {
      console.error(`Socket error on Modbus ID ${deviceId}: ${err.message}`);
    });
    dev.client = client;

    dev.client.connectTCP(dev.info.ip_address, { port: dev.info.port })
      .then(() => {
        console.log(`Conectado ao dispositivo Modbus ID ${deviceId}`);
        dev.client.setID(1); 
        dev.connected = true;
        if (dev.intervalId) clearInterval(dev.intervalId);
        dev.intervalId = setInterval(() => this.pollDevice(deviceId), dev.info.polling_interval_ms);
      })
      .catch((e) => {
        console.error(`Falha ao conectar Modbus ID ${deviceId}: ${e.message}`);
        dev.connected = false;
        if (dev.retryTimeout) clearTimeout(dev.retryTimeout);
        dev.retryTimeout = setTimeout(() => this.connectDevice(deviceId), 5000);
      });
  }

  reloadVariables() {
    for (const devId in this.devices) {
      db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (err, vars) => {
        if (!err && vars && this.devices[devId]) {
          this.devices[devId].variables = vars;
        }
      });
    }
  }

  async pollDevice(deviceId) {
    const dev = this.devices[deviceId];
    if (!dev || !dev.connected) return;

    try {
      let stateChanged = false;
      
      for (const v of dev.variables) {
        let opts = {};
        try {
          opts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
        } catch(e) {}

        const dataFormat = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
        const endianness = opts.endianness || 'ABCD';
        const numRegisters = String(dataFormat).startsWith('32') ? 2 : 1;
        const mType = String(v.modbus_type || '').toLowerCase();

        // Endereço de offset direto para a rede Modbus
        const wireAddr = Math.max(0, parseInt(v.modbus_address) || 0);

        let rawValue = null;
        let readSuccess = false;
        try {
          if (mType === 'holding' || mType === 'holdingregister') {
            const res = await dev.client.readHoldingRegisters(wireAddr, numRegisters);
            rawValue = res && res.data ? parseModbusValue(res.data, dataFormat, endianness) : 0;
            readSuccess = true;
          } else if (mType === 'input' || mType === 'inputregister') {
            const res = await dev.client.readInputRegisters(wireAddr, numRegisters);
            rawValue = res && res.data ? parseModbusValue(res.data, dataFormat, endianness) : 0;
            readSuccess = true;
          } else if (mType === 'coil') {
            const res = await dev.client.readCoils(wireAddr, 1);
            rawValue = res && res.data ? res.data[0] : false;
            readSuccess = true;
          } else if (mType === 'discrete' || mType === 'inputstatus') {
            const res = await dev.client.readDiscreteInputs(wireAddr, 1);
            rawValue = res && res.data ? res.data[0] : false;
            readSuccess = true;
          }
        } catch (readErr) {
          console.warn(`[Modbus Warning] Falha ao ler '${v.name}' (Endereço ${v.modbus_address}): ${readErr.message}`);
        }

        let finalValue;
        if (readSuccess) {
          if (opts.bit_index !== undefined && opts.bit_index !== null && parseInt(opts.bit_index) >= 0 && (mType === 'holding' || mType === 'holdingregister' || mType === 'input' || mType === 'inputregister')) {
            const bitIdx = parseInt(opts.bit_index);
            finalValue = ((rawValue >> bitIdx) & 1) === 1;
          } else if (v.type === 'analog') {
            let val = typeof rawValue === 'number' ? rawValue : 0;
            if (opts.scale !== undefined && opts.scale !== null && opts.scale !== '' && !isNaN(opts.scale) && parseFloat(opts.scale) !== 1) {
              val = val * parseFloat(opts.scale);
            }
            if (opts.offset !== undefined && opts.offset !== null && opts.offset !== '' && !isNaN(opts.offset) && parseFloat(opts.offset) !== 0) {
              val = val + parseFloat(opts.offset);
            }
            if (v.decimals > 0 && dataFormat !== '32_float') {
              const divisor = Math.pow(10, v.decimals || 0);
              finalValue = val / divisor;
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

        this.state[v.name] = finalValue;
        if (v.display_name) this.state[v.display_name] = finalValue;
        stateChanged = true;

        // Logar no banco com o intervalo configurado em "Geral" (padrão 15s)
        const intervalMs = (this.historyIntervalSeconds || 15) * 1000;
        const nowMs = Date.now();
        if (!this.lastHistoryLogTime) this.lastHistoryLogTime = {};

        if (!this.lastHistoryLogTime[v.id] || (nowMs - this.lastHistoryLogTime[v.id]) >= intervalMs) {
          this.lastHistoryLogTime[v.id] = nowMs;
          const isoNow = new Date(nowMs).toISOString();
          db.run(`INSERT INTO variable_history (variable_id, value, timestamp) VALUES (?, ?, ?)`, [v.id, finalValue, isoNow]);
        }
      }

      // --- ALARM PROCESSING (High Performance In-Memory Check) ---
      if (dev.alarms && dev.alarms.length > 0) {
        for (const alarm of dev.alarms) {
          let rawAlarmVal;
          const aType = String(alarm.modbus_type || '').toLowerCase();
          const wireAlarmAddr = Math.max(0, parseInt(alarm.modbus_address) || 0);

          try {
            if (aType === 'holding' || aType === 'holdingregister') {
              const res = await dev.client.readHoldingRegisters(wireAlarmAddr, 1);
              rawAlarmVal = res && res.data ? res.data[0] : undefined;
            } else if (aType === 'input' || aType === 'inputregister') {
              const res = await dev.client.readInputRegisters(wireAlarmAddr, 1);
              rawAlarmVal = res && res.data ? res.data[0] : undefined;
            } else if (aType === 'coil') {
              const res = await dev.client.readCoils(wireAlarmAddr, 1);
              rawAlarmVal = res && res.data ? (res.data[0] ? 1 : 0) : undefined;
            } else if (aType === 'discrete' || aType === 'inputstatus') {
              const res = await dev.client.readDiscreteInputs(wireAlarmAddr, 1);
              rawAlarmVal = res && res.data ? (res.data[0] ? 1 : 0) : undefined;
            }
          } catch(errAlarm) {
            rawAlarmVal = undefined;
          }
          
          if (rawAlarmVal === undefined) continue;

          const conditionMet = this.evaluateCondition(rawAlarmVal, alarm.condition_type, alarm.condition_value);
          const isCurrentlyActive = this.activeAlarmsSet.has(alarm.id);
          
          if (conditionMet && !isCurrentlyActive) {
            this.activeAlarmsSet.add(alarm.id);
            db.run(`INSERT INTO alarm_history (alarm_config_id, trigger_value, status) VALUES (?, ?, 'ACTIVE')`, [alarm.id, rawAlarmVal], () => {
              this.emit('alarms_updated');
            });
          } else if (!conditionMet && isCurrentlyActive) {
            this.activeAlarmsSet.delete(alarm.id);
            db.run(`UPDATE alarm_history SET status = 'RESOLVED', resolve_time = CURRENT_TIMESTAMP WHERE alarm_config_id = ? AND status = 'ACTIVE'`, [alarm.id], () => {
              this.emit('alarms_updated');
            });
          }
        }
      }

      // Emitir atualização contínua para o frontend
      this.emit('update', this.state);
    } catch (e) {
      console.error(`Erro ao ler dispositivo ID ${deviceId}: ${e.message}`);
      dev.connected = false;
      if (dev.intervalId) clearInterval(dev.intervalId);
      if (dev.client) dev.client.close();
      if (dev.retryTimeout) clearTimeout(dev.retryTimeout);
      dev.retryTimeout = setTimeout(() => this.connectDevice(deviceId), 5000);
    }
  }

  async writeModbus(deviceId, modbus_type, address, value, decimals = 0, bit_index = -1, var_name = null) {
    const dev = this.devices[deviceId];
    const mType = String(modbus_type || '').toLowerCase();
    const wireAddr = Math.max(0, parseInt(address) || 0);

    // Se o dispositivo estiver offline ou em simulação, atualiza estado em memória
    if (!dev || !dev.connected) {
      if (var_name) {
        let optVal = value;
        if ((mType === 'holding' || mType === 'holdingregister') && bit_index >= 0) {
          const bitIdx = parseInt(bit_index);
          const curWord = this.state[var_name] ? 1 : 0;
          optVal = Boolean(value) ? (curWord | (1 << bitIdx)) : (curWord & ~(1 << bitIdx));
          this.state[var_name] = Boolean(optVal);
        } else {
          this.state[var_name] = value;
        }
        this.emit('update', this.state);
      }
      return true;
    }

    if (mType === 'coil') {
      const boolVal = Boolean(value);
      await dev.client.writeCoil(wireAddr, boolVal);
      if (var_name) this.state[var_name] = boolVal;
    } else if (mType === 'holding' || mType === 'holdingregister') {
      if (bit_index !== undefined && bit_index !== null && parseInt(bit_index) >= 0) {
        const bitIdx = parseInt(bit_index);
        let curWord = 0;
        try {
          const res = await dev.client.readHoldingRegisters(wireAddr, 1);
          if (res && res.data) curWord = res.data[0];
        } catch(e) {}
        let newWord = curWord;
        if (Boolean(value)) {
          newWord = curWord | (1 << bitIdx);
        } else {
          newWord = curWord & ~(1 << bitIdx);
        }
        await dev.client.writeRegister(wireAddr, newWord);
        if (var_name) this.state[var_name] = Boolean((newWord >> bitIdx) & 1);
      } else {
        const rawValue = Math.round(Number(value) * Math.pow(10, decimals || 0));
        await dev.client.writeRegister(wireAddr, rawValue);
        if (var_name) this.state[var_name] = Number(value);
      }
    } else {
      throw new Error('Tipo Modbus não suporta escrita');
    }

    this.emit('update', this.state);
    return true;
  }

  evaluateCondition(currentValue, operator, targetValue) {
    const v1 = parseFloat(currentValue);
    const v2 = parseFloat(targetValue);
    switch (operator) {
      case '==': return v1 === v2;
      case '!=': return v1 !== v2;
      case '>':  return v1 > v2;
      case '>=': return v1 >= v2;
      case '<':  return v1 < v2;
      case '<=': return v1 <= v2;
      default: return false;
    }
  }
}

const plc = new PLCService();
module.exports = plc;
