// =============================================================================
// ModbusMetrics.js — Coletor de Métricas Operacionais da Comunicação Modbus
// Monitora RTT P95, profundidade da fila, timeouts e saúde dos sockets
// =============================================================================

class ModbusMetrics {
  constructor() {
    this.requestsTotal = 0;
    this.requestsSuccessTotal = 0;
    this.timeoutsTotal = 0;
    this.errorsTotal = 0;
    this.reconnectsTotal = 0;
    this.blockFailuresTotal = 0;
    this.invalidRegistersTotal = 0;

    // Histórico circular de latência (RTT em ms) para cálculo de P95
    this.rttBuffer = [];
    this.maxRttBufferLength = 200;

    // Atributos de fila em tempo real
    this.currentQueueDepth = 0;
    this.currentInFlight = 0;
  }

  recordRequest(success, durationMs, errorType = null) {
    this.requestsTotal++;
    if (success) {
      this.requestsSuccessTotal++;
      if (typeof durationMs === 'number' && durationMs >= 0) {
        this.rttBuffer.push(durationMs);
        if (this.rttBuffer.length > this.maxRttBufferLength) {
          this.rttBuffer.shift();
        }
      }
    } else {
      this.errorsTotal++;
      if (errorType === 'timeout' || (errorType && errorType.includes('Timeout'))) {
        this.timeoutsTotal++;
      }
    }
  }

  recordReconnect() {
    this.reconnectsTotal++;
  }

  recordBlockFailure() {
    this.blockFailuresTotal++;
  }

  recordInvalidRegister() {
    this.invalidRegistersTotal++;
  }

  updateQueueStatus(depth, inFlight) {
    this.currentQueueDepth = depth;
    this.currentInFlight = inFlight;
  }

  // Calcula a latência no percentil 95 (P95 RTT)
  getP95RTT() {
    if (this.rttBuffer.length === 0) return 50; // valor padrão inicial (50ms)
    const sorted = [...this.rttBuffer].sort((a, b) => a - b);
    const index = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // Retorna um snapshot completo das métricas operacionais
  getSnapshot() {
    return {
      requestsTotal: this.requestsTotal,
      requestsSuccessTotal: this.requestsSuccessTotal,
      successRatePct: this.requestsTotal > 0 ? ((this.requestsSuccessTotal / this.requestsTotal) * 100).toFixed(2) : '100.00',
      timeoutsTotal: this.timeoutsTotal,
      errorsTotal: this.errorsTotal,
      reconnectsTotal: this.reconnectsTotal,
      blockFailuresTotal: this.blockFailuresTotal,
      invalidRegistersTotal: this.invalidRegistersTotal,
      p95RttMs: Math.round(this.getP95RTT()),
      currentQueueDepth: this.currentQueueDepth,
      currentInFlight: this.currentInFlight
    };
  }
}

const metrics = new ModbusMetrics();
module.exports = metrics;
