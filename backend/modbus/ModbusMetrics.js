// =============================================================================
// ModbusMetrics.js — Coletor de Métricas Operacionais da Comunicação Modbus
// Otimizado: P95 RTT calculado lazily com dirty flag para evitar re-sort
// no hot path de cada requisição.
// =============================================================================

class ModbusMetrics {
  constructor() {
    this.requestsTotal         = 0;
    this.requestsSuccessTotal  = 0;
    this.timeoutsTotal         = 0;
    this.errorsTotal           = 0;
    this.reconnectsTotal       = 0;
    this.blockFailuresTotal    = 0;
    this.invalidRegistersTotal = 0;

    // Buffer circular de latência (RTT em ms) para cálculo de P95
    this._rttBuffer     = new Float64Array(200); // Buffer de tamanho fixo, sem GC
    this._rttHead       = 0;
    this._rttCount      = 0;
    this._p95Cached     = 50;   // Valor inicial padrão (50ms)
    this._p95Dirty      = false; // Flag: true = precisa recalcular

    this.currentQueueDepth = 0;
    this.currentInFlight   = 0;
  }

  recordRequest(success, durationMs, errorType = null) {
    this.requestsTotal++;

    if (success) {
      this.requestsSuccessTotal++;
      if (typeof durationMs === 'number' && durationMs >= 0) {
        // Insere no buffer circular (sem alocação heap)
        this._rttBuffer[this._rttHead] = durationMs;
        this._rttHead  = (this._rttHead + 1) % 200;
        if (this._rttCount < 200) this._rttCount++;
        this._p95Dirty = true;
      }
    } else {
      this.errorsTotal++;
      if (errorType === 'timeout' || (errorType && String(errorType).includes('Timeout'))) {
        this.timeoutsTotal++;
      }
    }
  }

  recordReconnect()       { this.reconnectsTotal++; }
  recordBlockFailure()    { this.blockFailuresTotal++; }
  recordInvalidRegister() { this.invalidRegistersTotal++; }

  updateQueueStatus(depth, inFlight) {
    this.currentQueueDepth = depth;
    this.currentInFlight   = inFlight;
  }

  /**
   * Retorna P95 RTT em ms.
   * Recalcula apenas quando novos dados foram inseridos (_p95Dirty).
   */
  getP95RTT() {
    if (this._rttCount === 0) return 50;
    if (!this._p95Dirty)     return this._p95Cached;

    // Copia apenas a parte válida do buffer para ordenação
    const slice = Array.from(this._rttBuffer.subarray(0, this._rttCount)).sort((a, b) => a - b);
    const idx   = Math.ceil(0.95 * slice.length) - 1;
    this._p95Cached = slice[Math.max(0, idx)];
    this._p95Dirty  = false;
    return this._p95Cached;
  }

  /** Snapshot completo das métricas para a API */
  getSnapshot() {
    return {
      requestsTotal:          this.requestsTotal,
      requestsSuccessTotal:   this.requestsSuccessTotal,
      successRatePct:         this.requestsTotal > 0
        ? ((this.requestsSuccessTotal / this.requestsTotal) * 100).toFixed(2)
        : '100.00',
      timeoutsTotal:          this.timeoutsTotal,
      errorsTotal:            this.errorsTotal,
      reconnectsTotal:        this.reconnectsTotal,
      blockFailuresTotal:     this.blockFailuresTotal,
      invalidRegistersTotal:  this.invalidRegistersTotal,
      p95RttMs:               Math.round(this.getP95RTT()),
      currentQueueDepth:      this.currentQueueDepth,
      currentInFlight:        this.currentInFlight,
    };
  }
}

const metrics = new ModbusMetrics();
module.exports = metrics;
