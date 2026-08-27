// =============================================================================
// ModbusPriorityQueue.js — Fila de Prioridades com Deadlines e Coalescimento
// Níveis de Prioridade:
//   P0 — Emergência (Parada, Segurança)
//   P1 — Comandos de Operador (Botões, Switches, Escrita de Setpoints)
//   P2 — Telemetria Crítica / Alarmes
//   P3 — Telemetria Normal (Polling Periódico)
// =============================================================================

const logger = require('./ModbusLogger');
const metrics = require('./ModbusMetrics');

class ModbusPriorityQueue {
  constructor() {
    // 4 filas separadas por prioridade: index 0 (P0) -> index 3 (P3)
    this.queues = [[], [], [], []];
  }

  // Insere uma nova requisição na fila com prioridade e deadline
  enqueue(request) {
    // request: { id, priority (0-3), deadline, key, execute, resolve, reject, generationId }
    const p = Math.min(Math.max(parseInt(request.priority) || 3, 0), 3);

    // Coalescimento de Telemetria (P3): se já houver uma requisição equivalente na fila P3 ainda não executada, descarta a duplicada antiga
    if (p === 3 && request.key) {
      const p3Queue = this.queues[3];
      const existingIdx = p3Queue.findIndex(r => r.key === request.key);
      if (existingIdx !== -1) {
        // Substitui a requisição antiga pela mais recente
        const oldReq = p3Queue[existingIdx];
        if (oldReq.reject) {
          oldReq.reject(new Error('Telemetry Coalesced (Superseded by newer read)'));
        }
        p3Queue.splice(existingIdx, 1);
      }
    }

    this.queues[p].push({
      id: request.id || Math.random().toString(36).substring(7),
      priority: p,
      key: request.key || null,
      createdAt: Date.now(),
      deadline: request.deadline || (Date.now() + 10000), // Deadline padrão de 10s
      generationId: request.generationId || 0,
      execute: request.execute,
      resolve: request.resolve,
      reject: request.reject
    });

    metrics.updateQueueStatus(this.size(), metrics.currentInFlight);
  }

  // Extrai a requisição mais prioritária que não tenha expirado o deadline
  dequeue() {
    const now = Date.now();

    for (let p = 0; p <= 3; p++) {
      while (this.queues[p].length > 0) {
        const req = this.queues[p].shift();

        // Verificar se a requisição expirou o deadline enquanto aguardava na fila
        if (req.deadline && now > req.deadline) {
          logger.debug(`[Modbus Queue] Requisição ${req.id} (P${req.priority}) descartada: Deadline expirado (${now - req.deadline}ms atrás)`);
          if (req.reject) {
            req.reject(new Error('Request Deadline Expired'));
          }
          continue;
        }

        metrics.updateQueueStatus(this.size(), metrics.currentInFlight);
        return req;
      }
    }

    metrics.updateQueueStatus(0, metrics.currentInFlight);
    return null;
  }

  size() {
    return this.queues[0].length + this.queues[1].length + this.queues[2].length + this.queues[3].length;
  }

  clear() {
    for (let p = 0; p <= 3; p++) {
      while (this.queues[p].length > 0) {
        const req = this.queues[p].shift();
        if (req.reject) req.reject(new Error('Queue Cleared'));
      }
    }
    metrics.updateQueueStatus(0, 0);
  }
}

module.exports = ModbusPriorityQueue;
