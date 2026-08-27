// =============================================================================
// plc_worker.js — Worker Thread para o Motor Modbus
//
// Melhorias:
//   - Event-driven para devices_status (ao invés de polling a cada 2s)
//   - Usa plc.getDevicesSnapshot() em vez do getter pesado plc.devices
//   - loadAlarmConfigs agora mapeia para o método correto
// =============================================================================

const { parentPort, threadId } = require('worker_threads');
const plc = require('./plc');

// Envia snapshot de dispositivos assim que o estado de algum muda
plc.on('device_state_change', (devId, snap) => {
  parentPort.postMessage({
    type:    'device_state_change',
    devId,
    snap,
  });
});

// Envia telemetria completa a cada update do PLC
plc.on('update', (data) => {
  parentPort.postMessage({ type: 'update', data });
});

// Notifica o frontend quando alarmes mudam
plc.on('alarms_updated', () => {
  parentPort.postMessage({ type: 'alarms_updated' });
});

// Envia snapshot inicial de dispositivos após 2s (tempo de init do PLC)
setTimeout(() => {
  parentPort.postMessage({
    type:    'devices_status',
    devices: plc.getDevicesSnapshot(),
  });
}, 2000);

// =============================================================================
// Comandos recebidos da Thread Principal
// =============================================================================
parentPort.on('message', async (msg) => {
  try {
    switch (msg.type) {

      case 'writeModbus': {
        const { messageId, deviceId, modbus_type, address, value, decimals, bit_index, var_name } = msg.payload;
        const result = await plc.writeModbus(deviceId, modbus_type, address, value, decimals, bit_index, var_name);
        parentPort.postMessage({ type: 'writeModbus_response', messageId, success: true, result });
        break;
      }

      case 'getMetrics':
        parentPort.postMessage({
          type:      'getMetrics_response',
          messageId: msg.messageId,
          success:   true,
          result:    plc.getMetricsSnapshot(),
        });
        break;

      case 'reloadDevices':
        await plc.reloadDevices();
        // Envia snapshot atualizado após reload
        parentPort.postMessage({
          type:    'devices_status',
          devices: plc.getDevicesSnapshot(),
        });
        break;

      case 'reloadVariables':
        plc.reloadVariables();
        break;

      case 'loadGeneralConfig':
        plc.loadGeneralConfig();
        break;

      case 'loadAlarmConfigs':
        plc.loadAlarmConfigs(); // Método agora existe em plc.js
        break;

      default:
        console.warn(`[PLC Worker] Comando desconhecido: ${msg.type}`);
    }
  } catch (err) {
    console.error(`[PLC Worker] Erro ao processar '${msg.type}':`, err.message);
    if (msg.messageId) {
      parentPort.postMessage({
        type:      `${msg.type}_response`,
        messageId: msg.messageId,
        success:   false,
        error:     err.message,
      });
    }
  }
});

console.log(`[PLC Worker] Iniciado — Thread ID ${threadId}`);
