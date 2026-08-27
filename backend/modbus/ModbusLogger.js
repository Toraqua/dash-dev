// =============================================================================
// ModbusLogger.js — Logger Industrial Estruturado com Supressão e Rate-Limiting
// Evita saturação do Event Loop do Node.js e desgaste do cartão SD no RPi3
// =============================================================================

class ModbusLogger {
  constructor() {
    this.levels = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5 };
    // Nível padrão: INFO em produção, pode ser alterado via LOG_LEVEL env
    const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    this.currentLevel = this.levels[envLevel] !== undefined ? this.levels[envLevel] : this.levels.INFO;

    // Mapa de agregação de mensagens repetitivas: { key: { count, firstTs, lastTs, level, msg, meta } }
    this.suppressedMap = new Map();
    this.aggregationWindowMs = 30000; // 30 segundos de janela de sumarização

    // Timer periódico para emitir resumos acumulados
    this.flushInterval = setInterval(() => this.flushSuppressedLogs(), 15000);
  }

  setLevel(levelName) {
    const lvl = String(levelName).toUpperCase();
    if (this.levels[lvl] !== undefined) {
      this.currentLevel = this.levels[lvl];
    }
  }

  log(levelName, message, meta = {}) {
    const lvl = this.levels[levelName];
    if (lvl === undefined || lvl < this.currentLevel) return;

    const now = Date.now();

    // Se for WARN ou ERROR, aplica agregação por chave para evitar tempestade de logs
    if (lvl === this.levels.WARN || lvl === this.levels.ERROR) {
      const key = `${levelName}:${message}:${meta.deviceId || 'global'}:${meta.address || ''}`;
      if (!this.suppressedMap.has(key)) {
        this.suppressedMap.set(key, {
          count: 1,
          firstTs: now,
          lastTs: now,
          levelName,
          message,
          meta,
          loggedInitial: true
        });
        // Imprime a 1ª ocorrência imediatamente
        this._write(levelName, message, meta);
      } else {
        const item = this.suppressedMap.get(key);
        item.count++;
        item.lastTs = now;
      }
      return;
    }

    // Outros níveis (INFO, DEBUG, TRACE, FATAL) imprimem diretamente
    this._write(levelName, message, meta);
  }

  flushSuppressedLogs() {
    const now = Date.now();
    for (const [key, item] of this.suppressedMap.entries()) {
      if (item.count > 1) {
        const suppressedCount = item.count - 1;
        const durationSec = Math.round((item.lastTs - item.firstTs) / 1000) || 1;
        this._write(
          item.levelName,
          `[Resumo de Supressão] ${suppressedCount} ocorrências de '${item.message}' suprimidas nos últimos ${durationSec}s`,
          { ...item.meta, totalOccurrences: item.count }
        );
      }
      // Se não houver novas ocorrências nos últimos 15s, limpa a entrada
      if (now - item.lastTs >= this.aggregationWindowMs) {
        this.suppressedMap.delete(key);
      } else {
        // Reseta o contador para a próxima janela
        item.count = 0;
      }
    }
  }

  _write(levelName, message, meta) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [Modbus ${levelName}] ${message}${metaStr}\n`;

    if (levelName === 'ERROR' || levelName === 'FATAL') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  trace(msg, meta) { this.log('TRACE', msg, meta); }
  debug(msg, meta) { this.log('DEBUG', msg, meta); }
  info(msg, meta)  { this.log('INFO', msg, meta); }
  warn(msg, meta)  { this.log('WARN', msg, meta); }
  error(msg, meta) { this.log('ERROR', msg, meta); }
  fatal(msg, meta) { this.log('FATAL', msg, meta); }

  destroy() {
    if (this.flushInterval) clearInterval(this.flushInterval);
  }
}

const logger = new ModbusLogger();
module.exports = logger;
