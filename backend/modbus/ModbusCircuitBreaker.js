// =============================================================================
// ModbusCircuitBreaker.js — Isolamento de Erros e Divisão Binária de Blocos
// Quarentena para registradores inválidos e fallback por divisão inteligente
// =============================================================================

const logger = require('./ModbusLogger');
const metrics = require('./ModbusMetrics');

class ModbusCircuitBreaker {
  constructor() {
    // Registradores em quarentena: Map(`${type}:${addr}` -> timestampFimQuarentena)
    this.quarantineMap = new Map();
    // Duração padrão de quarentena para erros de configuração (Illegal Address/Function): 5 minutos
    this.defaultQuarantineMs = 300000;
  }

  // Verifica se uma variável/endereço está em quarentena
  isQuarantined(type, address) {
    const key = `${type}:${address}`;
    const until = this.quarantineMap.get(key);
    if (!until) return false;
    if (Date.now() > until) {
      this.quarantineMap.delete(key);
      return false;
    }
    return true;
  }

  // Coloca um registrador específico em quarentena por erro de configuração (Illegal Data Address)
  quarantine(type, address, reason = 'Illegal Data Address', durationMs = null) {
    const key = `${type}:${address}`;
    const ttl = durationMs || this.defaultQuarantineMs;
    const until = Date.now() + ttl;
    this.quarantineMap.set(key, until);
    metrics.recordInvalidRegister();
    logger.warn(`[Circuit Breaker] Registrador [${type}#${address}] colocado em quarentena por ${Math.round(ttl / 1000)}s: ${reason}`, { type, address });
  }

  // Divisão binária de blocos com falha (32 -> 16 -> 8 -> 4 -> 2 -> 1)
  // Divide um bloco grande em 2 sub-blocos menores para encontrar a parte saudável
  splitBlock(block) {
    if (!block || !block.vars || block.vars.length <= 1) {
      return [block];
    }

    const sorted = [...block.vars].sort((a, b) => (parseInt(a.modbus_address) || 0) - (parseInt(b.modbus_address) || 0));
    const mid = Math.ceil(sorted.length / 2);
    const leftVars = sorted.slice(0, mid);
    const rightVars = sorted.slice(mid);

    const makeSubBlock = (vars) => {
      if (!vars.length) return null;
      const start = parseInt(vars[0].modbus_address) || 0;
      const lastVar = vars[vars.length - 1];
      const lastAddr = parseInt(lastVar.modbus_address) || 0;
      // nRegs simples (1 ou 2)
      const lastRegs = (lastVar.options?.data_format || '').startsWith('32') ? 2 : 1;
      const end = lastAddr + lastRegs;
      return { start, end, vars };
    };

    const b1 = makeSubBlock(leftVars);
    const b2 = makeSubBlock(rightVars);

    const result = [];
    if (b1) result.push(b1);
    if (b2) result.push(b2);

    logger.debug(`[Circuit Breaker] Bloco [${block.start}..${block.end - 1}] dividido em 2 sub-blocos (${leftVars.length} + ${rightVars.length} vars)`);
    return result;
  }

  // Verifica se o erro do Modbus é de configuração (Illegal Address ou Function Code)
  isConfigurationError(error) {
    if (!error) return false;
    const msg = String(error.message || error).toLowerCase();
    return msg.includes('illegal data address') ||
           msg.includes('illegal function') ||
           msg.includes('illegal data value') ||
           msg.includes('code 2') ||
           msg.includes('code 1');
  }
}

const circuitBreaker = new ModbusCircuitBreaker();
module.exports = circuitBreaker;
