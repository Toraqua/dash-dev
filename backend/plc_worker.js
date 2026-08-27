const { parentPort, threadId } = require('worker_threads');
const plc = require('./plc'); // Inicializa a engine Modbus na sua própria thread

// 1. Ouvir eventos do PLC e repassar para a Thread Principal
plc.on('update', (data) => {
  // Transfere o estado e tempos de leitura para a thread principal
  parentPort.postMessage({ type: 'update', data });
});

plc.on('alarms_updated', () => {
  parentPort.postMessage({ type: 'alarms_updated' });
});

// Enviar status atualizado de conexões dos dispositivos a cada 2s para o endpoint /api/devices
setInterval(() => {
  if (plc.devices) {
    const safeDevices = {};
    for (const id in plc.devices) {
      safeDevices[id] = {
        connected: plc.devices[id].connected,
        state: plc.devices[id].state
      };
    }
    parentPort.postMessage({ type: 'devices_status', devices: safeDevices });
  }
}, 2000);

// 2. Ouvir comandos da Thread Principal
parentPort.on('message', async (msg) => {
  try {
    switch (msg.type) {
      case 'writeModbus': {
        const { messageId, deviceId, modbus_type, address, value, decimals, bit_index, var_name } = msg.payload;
        const result = await plc.writeModbus(deviceId, modbus_type, address, value, decimals, bit_index, var_name);
        parentPort.postMessage({ type: 'writeModbus_response', messageId, success: true, result });
        break;
      }
      
      case 'reloadDevices':
        plc.reloadDevices();
        break;
        
      case 'getMetrics':
        parentPort.postMessage({ type: 'getMetrics_response', messageId: msg.messageId, success: true, result: plc.getMetricsSnapshot() });
        break;
      case 'loadGeneralConfig':
        plc.loadGeneralConfig();
        break;
      case 'loadAlarmConfigs':
        plc.loadAlarmConfigs();
        break;
      case 'reloadVariables':
        plc.reloadVariables();
        break;
        
      default:
        console.warn(`[PLC Worker] Comando desconhecido: ${msg.type}`);
    }
  } catch (err) {
    if (msg.messageId) {
      parentPort.postMessage({ type: `${msg.type}_response`, messageId: msg.messageId, success: false, error: err.message });
    } else {
      console.error(`[PLC Worker] Erro ao processar mensagem ${msg.type}:`, err);
    }
  }
});

console.log(`[PLC Worker] Iniciado com sucesso na Thread ID ${threadId}`);
