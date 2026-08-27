// =============================================================================
// ModbusScheduler.js — Agrupamento Inteligente de Registradores (Smart Chunking)
// Ordena e agrupa variáveis com tolerância controlada a lacunas (MAX_GAP)
// =============================================================================

const circuitBreaker = require('./ModbusCircuitBreaker');

class ModbusScheduler {
  constructor() {
    this.maxGap = 3;      // Tolerância máxima a lacunas não mapeadas (palavras)
    this.maxBlock = 60;   // Tamanho máximo de registradores por bloco TCP FC03/FC04
  }

  setMaxGap(gap) {
    if (typeof gap === 'number' && gap >= 0 && gap <= 10) {
      this.maxGap = gap;
    }
  }

  // Agrupa variáveis por faixas contínuas ou com pequenas lacunas (Smart Chunking)
  buildBlocks(vars, modbusTypeKey, getNumRegsFn) {
    if (!vars || !vars.length) return [];

    // 1. Filtrar registradores que estão em quarentena no Circuit Breaker
    const validVars = vars.filter(v => {
      const addr = parseInt(v.modbus_address) || 0;
      return !circuitBreaker.isQuarantined(modbusTypeKey, addr);
    });

    if (!validVars.length) return [];

    // 2. Ordenar variáveis estritamente pelo endereço Modbus crescente
    const sorted = [...validVars].sort((a, b) => (parseInt(a.modbus_address) || 0) - (parseInt(b.modbus_address) || 0));

    const blocks = [];
    let block = null;

    for (const v of sorted) {
      const addr = parseInt(v.modbus_address) || 0;
      const nRegs = getNumRegsFn(v);
      const newEnd = addr + nRegs;

      if (!block) {
        block = { start: addr, end: newEnd, vars: [v] };
      } else {
        const gap = addr - block.end;
        if (gap <= this.maxGap && (newEnd - block.start) <= this.maxBlock) {
          block.end = Math.max(block.end, newEnd);
          block.vars.push(v);
        } else {
          blocks.push(block);
          block = { start: addr, end: newEnd, vars: [v] };
        }
      }
    }

    if (block) {
      blocks.push(block);
    }

    return blocks;
  }
}

const scheduler = new ModbusScheduler();
module.exports = scheduler;
