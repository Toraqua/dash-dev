// =============================================================================
// ModbusPriorityQueue.js — Fila de Prioridades com Deadlines e Coalescimento
//
// Níveis de Prioridade:
//   P0 — Emergência (Parada, Segurança)
//   P1 — Comandos de Operador (Botões, Switches, Setpoints)
//   P2 — Telemetria Crítica / Alarmes
//   P3 — Telemetria Normal (Polling Periódico)
//
// Otimização P3: coalescimento via Map<key, index> — lookup O(1) ao invés
// de Array.findIndex + splice que era O(n) a cada enqueue de telemetria.
// =============================================================================

const logger  = require('./ModbusLogger');
const metrics = require('./ModbusMetrics');

class ModbusPriorityQueue {
  constructor() {
    // Filas P0-P2: arrays simples (baixo volume, alta prioridade)
    this.queues = [[], [], []];

    // Fila P3: Map<key, request> para coalescimento O(1)
    // Mantemos também um array de chaves de inserção para respeitar a ordem
    this._p3Map   = new Map(); // key → request
    this._p3Order = [];        // keys na ordem de enqueue (FIFO dentro de P3)
  }

  enqueue(request) {
    const p = Math.min(Math.max(parseInt(request.priority) || 3, 0), 3);

    const item = {
      id:           request.id || Math.random().toString(36).slice(2, 8),
      priority:     p,
      key:          request.key || null,
      createdAt:    Date.now(),
      deadline:     request.deadline || (Date.now() + 10000),
      generationId: request.generationId || 0,
      execute:      request.execute,
      resolve:      request.resolve,
      reject:       request.reject,
    };

    if (p === 3 && item.key) {
      // Coalescimento O(1): substitui requisição antiga pela mais recente
      const existing = this._p3Map.get(item.key);
      if (existing) {
        // Rejeita a antiga (será ignorada pelo caller com erro 'Coalesced')
        if (existing.reject) {
          existing.reject(new Error('Telemetry Coalesced (Superseded by newer read)'));
        }
        // Atualiza o valor no Map sem alterar a posição na fila de ordem
        this._p3Map.set(item.key, item);
      } else {
        this._p3Map.set(item.key, item);
        this._p3Order.push(item.key);
      }
    } else if (p <= 2) {
      this.queues[p].push(item);
    } else {
      // P3 sem key: fallback para array
      this.queues[2] = this.queues[2] || [];
      // Trata como P2 (sem chave de coalescimento)
      this.queues[2].push(item);
    }

    metrics.updateQueueStatus(this.size(), metrics.currentInFlight);
  }

  dequeue() {
    const now = Date.now();

    // Verifica P0 → P1 → P2 primeiro
    for (let p = 0; p <= 2; p++) {
      while (this.queues[p].length > 0) {
        const req = this.queues[p].shift();
        if (req.deadline && now > req.deadline) {
          if (req.reject) req.reject(new Error('Request Deadline Expired'));
          continue;
        }
        metrics.updateQueueStatus(this.size(), metrics.currentInFlight);
        return req;
      }
    }

    // Depois drena P3 (FIFO pela ordem de enqueue)
    while (this._p3Order.length > 0) {
      const key = this._p3Order.shift();
      const req = this._p3Map.get(key);
      this._p3Map.delete(key);

      if (!req) continue; // já foi coalescido e removido

      if (req.deadline && now > req.deadline) {
        if (req.reject) req.reject(new Error('Request Deadline Expired'));
        continue;
      }

      metrics.updateQueueStatus(this.size(), metrics.currentInFlight);
      return req;
    }

    metrics.updateQueueStatus(0, metrics.currentInFlight);
    return null;
  }

  size() {
    return this.queues[0].length + this.queues[1].length + this.queues[2].length + this._p3Map.size;
  }

  clear() {
    for (let p = 0; p <= 2; p++) {
      for (const req of this.queues[p]) {
        if (req.reject) req.reject(new Error('Queue Cleared'));
      }
      this.queues[p] = [];
    }
    for (const req of this._p3Map.values()) {
      if (req.reject) req.reject(new Error('Queue Cleared'));
    }
    this._p3Map.clear();
    this._p3Order = [];
    metrics.updateQueueStatus(0, 0);
  }
}

module.exports = ModbusPriorityQueue;
