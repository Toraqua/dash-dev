const { parentPort, threadId } = require('worker_threads');
const gatewayService = require('./gateway'); // Inicializa a engine MQTT na sua própria thread

// 1. Ouvir mensagens de telemetria da Thread Principal e repassar para o gateway
parentPort.on('message', (msg) => {
  if (msg.type === 'publishTelemetry') {
    // A Thread Principal envia o objeto state do PLC
    gatewayService.publishTelemetry(msg.data);
  }
});

console.log(`[Gateway Worker] Iniciado com sucesso na Thread ID ${threadId}`);
