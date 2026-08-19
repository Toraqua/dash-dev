// =============================================================================
// plc.js — Serviço de Comunicação Modbus TCP/IP
// Gerencia conexão, polling, leitura e escrita de dispositivos industriais (CLPs)
// via protocolo Modbus TCP utilizando a biblioteca modbus-serial.
// =============================================================================

const EventEmitter = require('events');
const db           = require('./db');
const ModbusRTU    = require('modbus-serial');

// =============================================================================
// parseModbusValue — Interpreta os registros brutos do Modbus de acordo com
// o formato de dados (16_int, 16_uint, 32_int, 32_uint, 32_float) e ordem dos
// bytes (endianness: ABCD, BADC, DCBA, CDAB).
//
// Parâmetros:
//   registers   — Array de words (uint16) retornados pelo Modbus
//   dataFormat  — Formato de interpretação: '16_int' | '16_uint' | '32_int' | '32_uint' | '32_float'
//   endianness  — Ordem dos bytes: 'ABCD' (Big-Endian) | 'BADC' | 'DCBA' | 'CDAB'
//
// Retorna: número interpretado (inteiro ou ponto flutuante)
// =============================================================================
function parseModbusValue(registers, dataFormat = '16_int', endianness = 'ABCD') {
  if (!registers || !registers.length) return 0;

  const is32Bit = String(dataFormat).startsWith('32');

  if (is32Bit) {
    // Leitura de 32 bits requer 2 registros consecutivos
    const w1 = registers[0] || 0; // Word alta
    const w2 = registers[1] || 0; // Word baixa
    // Extrair os 4 bytes individuais
    const A = (w1 >> 8) & 0xFF; // Byte mais significativo da word alta
    const B =  w1       & 0xFF; // Byte menos significativo da word alta
    const C = (w2 >> 8) & 0xFF; // Byte mais significativo da word baixa
    const D =  w2       & 0xFF; // Byte menos significativo da word baixa

    // Reorganiza os bytes conforme a ordem configurada
    let bytes;
    switch (endianness) {
      case 'BADC': bytes = [B, A, D, C]; break; // Little-word, Big-byte
      case 'DCBA': bytes = [D, C, B, A]; break; // Little-Endian total
      case 'CDAB': bytes = [C, D, A, B]; break; // Middle-Endian invertido
      case 'ABCD':
      default:     bytes = [A, B, C, D]; break; // Big-Endian (padrão Modbus)
    }

    const buf = Buffer.from(bytes);
    if      (dataFormat === '32_int')   return buf.readInt32BE(0);
    else if (dataFormat === '32_uint')  return buf.readUInt32BE(0);
    else {
      // 32_float — Ponto flutuante IEEE 754
      const f = buf.readFloatBE(0);
      return (isNaN(f) || !isFinite(f)) ? 0 : f;
    }
  } else {
    // Leitura de 16 bits — 1 registro
    const w1 = registers[0] || 0;
    const A  = (w1 >> 8) & 0xFF;
    const B  =  w1       & 0xFF;

    let bytes;
    if (endianness === 'BADC' || endianness === 'DCBA') {
      bytes = [B, A]; // Little-Endian de 16 bits
    } else {
      bytes = [A, B]; // Big-Endian de 16 bits (padrão)
    }

    const buf = Buffer.from(bytes);
    if (dataFormat === '16_uint') return buf.readUInt16BE(0);
    else                          return buf.readInt16BE(0);
  }
}

// =============================================================================
// PLCService — Classe principal do serviço de comunicação com CLPs Modbus.
//
// Herda de EventEmitter para publicar eventos:
//   'update'         — Emitido a cada ciclo de polling com o estado atual
//   'alarms_updated' — Emitido quando um alarme é ativado ou resolvido
// =============================================================================
class PLCService extends EventEmitter {
  constructor() {
    super();

    // Estado global de todas as variáveis: { nome_variavel: valor }
    // Mantido em memória e nunca resetado completamente — apenas atualizado
    this.state = {
      connected: true, // Compatibilidade legada com frontend antigo
    };

    // Mapa de dispositivos ativos: { device_id: { info, client, variables, alarms, connected, ... } }
    this.devices = {};

    // Intervalo de gravação no histórico (segundos) — carregado das configurações gerais
    this.historyIntervalSeconds = 15;

    // Mapa de último timestamp de gravação no histórico por variável: { variable_id: ms }
    this.lastHistoryLogTime = {};

    // Conjunto de IDs de alarmes atualmente ativos (checagem em memória para alta performance)
    this.activeAlarmsSet = new Set();

    // Inicializa o serviço
    this.init();
  }

  // ---------------------------------------------------------------------------
  // init — Ponto de entrada após construção.
  // Carrega configurações, alarmes ativos e inicia dispositivos.
  // ---------------------------------------------------------------------------
  init() {
    this.loadGeneralConfig();
    this.loadActiveAlarms();
    this.reloadDevices();
  }

  // ---------------------------------------------------------------------------
  // loadActiveAlarms — Carrega do banco os alarmes que já estão ativos
  // (status = 'ACTIVE') para sincronizar o estado em memória após reinicialização.
  // ---------------------------------------------------------------------------
  loadActiveAlarms() {
    db.all(`SELECT alarm_config_id FROM alarm_history WHERE status = 'ACTIVE'`, [], (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => this.activeAlarmsSet.add(r.alarm_config_id));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // loadGeneralConfig — Lê a configuração geral do banco (ex: intervalo histórico)
  // e atualiza os parâmetros internos do serviço.
  // ---------------------------------------------------------------------------
  loadGeneralConfig() {
    db.get("SELECT value FROM system_settings WHERE key = 'general_config'", [], (err, row) => {
      if (row && row.value) {
        try {
          const cfg = JSON.parse(row.value);
          this.historyIntervalSeconds = parseInt(cfg.history_interval_seconds) || 15;
        } catch(e) {
          this.historyIntervalSeconds = 15;
        }
      } else {
        this.historyIntervalSeconds = 15;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // reloadDevices — Recarrega todos os dispositivos do banco.
  // Para os polls e fecha as conexões existentes, depois reconecta tudo.
  //
  // IMPORTANTE: NÃO reseta this.state — apenas inicializa variáveis novas
  // que ainda não possuem estado registrado, preservando valores atuais.
  // ---------------------------------------------------------------------------
  async reloadDevices() {
    // Parar todos os ciclos de polling e fechar conexões TCP existentes
    for (const id in this.devices) {
      const dev = this.devices[id];
      if (dev.intervalId) clearInterval(dev.intervalId);
      if (dev.retryTimeout) clearTimeout(dev.retryTimeout);
      try { if (dev.client) dev.client.close(); } catch(e) {}
    }
    this.devices = {};

    // Buscar dispositivos do banco e inicializar cada um
    db.all('SELECT * FROM devices', [], (err, devs) => {
      if (err || !devs) return;

      devs.forEach(device => {
        // Estrutura do dispositivo na memória
        this.devices[device.id] = {
          info:       device,  // Metadados: IP, porta, intervalo
          client:     null,    // Será criado em connectDevice()
          variables:  [],      // Lista de variáveis configuradas para este dispositivo
          alarms:     [],      // Lista de alarmes configurados para este dispositivo
          connected:  false,   // Flag de conexão TCP ativa
          isPolling:  false,   // Guard: evita ciclos de polling sobrepostos
          retryCount: 0,       // Contador de tentativas de reconexão (para backoff)
          intervalId: null,    // Handle do setInterval do polling
          retryTimeout: null   // Handle do setTimeout de reconexão
        };

        // Carregar variáveis do dispositivo e inicializar estado somente para variáveis novas
        db.all('SELECT * FROM variables WHERE device_id = ?', [device.id], (err, vars) => {
          if (!err && vars) {
            this.devices[device.id].variables = vars;
            vars.forEach(v => {
              // NÃO sobrescreve: preserva o valor atual em memória se já existir
              // Isso evita "piscar" o painel quando dispositivos são editados
              if (this.state[v.name] === undefined) {
                this.state[v.name] = v.type === 'analog' ? 0.0 : false;
              }
              if (v.display_name && this.state[v.display_name] === undefined) {
                this.state[v.display_name] = v.type === 'analog' ? 0.0 : false;
              }
            });
          }
        });

        // Carregar alarmes do dispositivo
        db.all('SELECT * FROM alarm_configs WHERE device_id = ?', [device.id], (err, alarms) => {
          if (!err && alarms) {
            this.devices[device.id].alarms = alarms;
          }
        });

        // Iniciar tentativa de conexão TCP
        this.connectDevice(device.id);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // connectDevice — Estabelece a conexão TCP Modbus com o dispositivo.
  // Em caso de falha, reagenda com backoff exponencial (máximo 30 segundos).
  //
  // Backoff exponencial: delay = min(5000 * 2^tentativas, 30000) ms
  //   Tentativa 1: 5s | Tentativa 2: 10s | Tentativa 3: 20s | Tentativa 4+: 30s
  // ---------------------------------------------------------------------------
  connectDevice(deviceId) {
    const dev = this.devices[deviceId];
    if (!dev) return;

    // Fechar client anterior antes de criar novo (evita leak de conexões TCP)
    try { if (dev.client) dev.client.close(); } catch(e) {}

    console.log(`[Modbus] Conectando ao dispositivo ID ${deviceId} (${dev.info.ip_address}:${dev.info.port})...`);

    // Criar novo client Modbus TCP com timeout de 1.5 segundos por transação
    const client = new ModbusRTU();
    client.setTimeout(1500);

    // Tratar erros no nível do socket TCP (desconexão inesperada, etc.)
    client.on('error', (err) => {
      console.error(`[Modbus] Erro de socket no dispositivo ID ${deviceId}: ${err.message}`);
    });

    dev.client = client;

    dev.client.connectTCP(dev.info.ip_address, { port: dev.info.port })
      .then(() => {
        console.log(`[Modbus] Dispositivo ID ${deviceId} conectado com sucesso.`);
        // ID da unidade Modbus (padrão: 1 — ajustar se o CLP usar ID diferente)
        dev.client.setID(1);
        dev.connected  = true;
        dev.retryCount = 0; // Resetar backoff após conexão bem-sucedida

        // Parar poll anterior (se existia) e iniciar novo ciclo
        if (dev.intervalId) clearInterval(dev.intervalId);
        dev.intervalId = setInterval(
          () => this.pollDevice(deviceId),
          dev.info.polling_interval_ms || 1000
        );
      })
      .catch(e => {
        console.error(`[Modbus] Falha ao conectar ID ${deviceId}: ${e.message}`);
        dev.connected = false;

        // Calcular delay com backoff exponencial, limitado a 30 segundos
        const delay = Math.min(5000 * Math.pow(2, dev.retryCount || 0), 30000);
        dev.retryCount = (dev.retryCount || 0) + 1;
        console.log(`[Modbus] Próxima tentativa para ID ${deviceId} em ${delay / 1000}s (tentativa #${dev.retryCount})`);

        if (dev.retryTimeout) clearTimeout(dev.retryTimeout);
        dev.retryTimeout = setTimeout(() => this.connectDevice(deviceId), delay);
      });
  }

  // ---------------------------------------------------------------------------
  // reloadVariables — Atualiza somente a lista de variáveis de cada dispositivo
  // sem reconectar ou resetar estado. Chamado quando variáveis são
  // adicionadas/editadas/removidas via API.
  // ---------------------------------------------------------------------------
  reloadVariables() {
    for (const devId in this.devices) {
      db.all('SELECT * FROM variables WHERE device_id = ?', [devId], (err, vars) => {
        if (!err && vars && this.devices[devId]) {
          this.devices[devId].variables = vars;
          // Inicializar estado somente para variáveis novas (não sobrescreve existentes)
          vars.forEach(v => {
            if (this.state[v.name] === undefined) {
              this.state[v.name] = v.type === 'analog' ? 0.0 : false;
            }
            if (v.display_name && this.state[v.display_name] === undefined) {
              this.state[v.display_name] = v.type === 'analog' ? 0.0 : false;
            }
          });
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // pollDevice — Ciclo de leitura (poll) de todas as variáveis de um dispositivo.
  //
  // Fluxo:
  //   1. Guard isPolling: cancela se o ciclo anterior ainda não terminou
  //   2. Para cada variável: lê o endereço Modbus conforme o tipo
  //   3. Interpreta o valor bruto (bit_index, escala, offset, decimais)
  //   4. Atualiza this.state e persiste no histórico (se atingiu o intervalo)
  //   5. Processa alarmes em memória
  //   6. Emite evento 'update' com o estado completo
  //   Em caso de erro grave: marca dispositivo como offline e agenda reconexão
  // ---------------------------------------------------------------------------
  async pollDevice(deviceId) {
    const dev = this.devices[deviceId];
    if (!dev || !dev.connected) return;

    // Guard: evita sobreposição de ciclos de poll se o anterior demorou mais
    // que o intervalo configurado (ex: timeout de 2s em device com poll de 1s)
    if (dev.isPolling) {
      console.warn(`[Modbus] Poll sobreposição evitada para dispositivo ID ${deviceId}`);
      return;
    }
    dev.isPolling = true;

    try {
      // -----------------------------------------------------------------------
      // Leitura de variáveis configuradas
      // -----------------------------------------------------------------------
      for (const v of dev.variables) {
        // Parsear as opções da variável (JSON armazenado no banco)
        let opts = {};
        try {
          opts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
        } catch(e) {
          opts = {};
        }

        // Determinar formato e quantidade de registros a ler
        const dataFormat    = opts.data_format || (opts.data_size == 32 ? '32_float' : '16_int');
        const endianness    = opts.endianness || 'ABCD';
        const numRegisters  = String(dataFormat).startsWith('32') ? 2 : 1; // 32-bit ocupa 2 words
        const mType         = String(v.modbus_type || '').toLowerCase();

        // Endereço de wire (0-based, direto para o frame Modbus)
        const wireAddr = Math.max(0, parseInt(v.modbus_address) || 0);

        let rawValue   = null;
        let readSuccess = false;

        try {
          // Selecionar função Modbus conforme o tipo de registrador
          if (mType === 'holding' || mType === 'holdingregister') {
            // Função Modbus 03 — Holding Register (leitura/escrita)
            const res  = await dev.client.readHoldingRegisters(wireAddr, numRegisters);
            rawValue   = (res && res.data) ? parseModbusValue(res.data, dataFormat, endianness) : 0;
            readSuccess = true;

          } else if (mType === 'input' || mType === 'inputregister') {
            // Função Modbus 04 — Input Register (somente leitura)
            const res  = await dev.client.readInputRegisters(wireAddr, numRegisters);
            rawValue   = (res && res.data) ? parseModbusValue(res.data, dataFormat, endianness) : 0;
            readSuccess = true;

          } else if (mType === 'coil') {
            // Função Modbus 01 — Coil (bit de saída, leitura/escrita)
            const res  = await dev.client.readCoils(wireAddr, 1);
            rawValue   = (res && res.data) ? res.data[0] : false;
            readSuccess = true;

            // Log condicional: mostrar apenas quando o valor muda (evita spam no console)
            const prevVal = this.state[v.name];
            if (prevVal !== Boolean(rawValue)) {
              console.log(`[Modbus Poll] Coil[${wireAddr}] '${v.name}': ${prevVal} → ${rawValue}`);
            }

          } else if (mType === 'discrete' || mType === 'inputstatus') {
            // Função Modbus 02 — Discrete Input (bit de entrada, somente leitura)
            const res  = await dev.client.readDiscreteInputs(wireAddr, 1);
            rawValue   = (res && res.data) ? res.data[0] : false;
            readSuccess = true;
          }
          // Se mType não reconhecido, readSuccess permanece false e usa valor anterior

        } catch (readErr) {
          // Erro isolado de leitura: registra aviso mas continua com as demais variáveis
          console.warn(`[Modbus Warning] Falha ao ler '${v.name}' [${mType}#${wireAddr}]: ${readErr.message}`);
        }

        // -------------------------------------------------------------------
        // Interpretação do valor bruto → valor final
        // -------------------------------------------------------------------
        let finalValue;
        if (readSuccess) {
          if (
            opts.bit_index !== undefined &&
            opts.bit_index !== null &&
            parseInt(opts.bit_index) >= 0 &&
            (mType === 'holding' || mType === 'holdingregister' || mType === 'input' || mType === 'inputregister')
          ) {
            // Modo bit_index: extrai um bit específico da word de 16 bits
            const bitIdx = parseInt(opts.bit_index);
            finalValue = ((rawValue >> bitIdx) & 1) === 1;

          } else if (v.type === 'analog') {
            // Variável analógica: aplica escala e offset configurados
            let val = typeof rawValue === 'number' ? rawValue : (typeof rawValue === 'boolean' ? (rawValue ? 1 : 0) : 0);

            // Fator de escala: multiplica o valor bruto (ex: 1000 raw → 10.0 com scale=0.01)
            if (opts.scale !== undefined && opts.scale !== null && opts.scale !== '' &&
                !isNaN(opts.scale) && parseFloat(opts.scale) !== 1) {
              val = val * parseFloat(opts.scale);
            }
            // Offset: soma um valor fixo após a escala (ex: conversão de temperatura)
            if (opts.offset !== undefined && opts.offset !== null && opts.offset !== '' &&
                !isNaN(opts.offset) && parseFloat(opts.offset) !== 0) {
              val = val + parseFloat(opts.offset);
            }
            // Decimais: divide por potência de 10 se o valor é armazenado como inteiro escalado
            if (v.decimals > 0 && dataFormat !== '32_float') {
              finalValue = val / Math.pow(10, v.decimals || 0);
            } else {
              finalValue = val;
            }

          } else if (v.type === 'boolean') {
            // Variável booleana simples (coil ou bit de word inteiro)
            finalValue = Boolean(rawValue);

          } else {
            // Tipo desconhecido: passa o valor bruto sem processamento
            finalValue = rawValue;
          }
        } else {
          // Falha na leitura: mantém o último valor conhecido (não vai para zero)
          finalValue = this.state[v.name] !== undefined ? this.state[v.name] : 0;
        }

        // Atualizar estado global com o valor processado
        this.state[v.name] = finalValue;
        if (v.display_name) this.state[v.display_name] = finalValue;

        // -------------------------------------------------------------------
        // Persistência no histórico (conforme intervalo configurado)
        // -------------------------------------------------------------------
        const intervalMs = (this.historyIntervalSeconds || 15) * 1000;
        const nowMs      = Date.now();

        if (!this.lastHistoryLogTime[v.id] || (nowMs - this.lastHistoryLogTime[v.id]) >= intervalMs) {
          this.lastHistoryLogTime[v.id] = nowMs;
          const isoNow = new Date(nowMs).toISOString();
          db.run(
            `INSERT INTO variable_history (variable_id, value, timestamp) VALUES (?, ?, ?)`,
            [v.id, finalValue, isoNow]
          );
        }
      } // fim do loop de variáveis

      // -----------------------------------------------------------------------
      // Processamento de Alarmes em Memória (alta performance — sem I/O por alarme)
      // Reutiliza o valor já lido das variáveis através de this.state para
      // evitar duplicar requisições Modbus (era a causa da sobreposição de poll).
      // -----------------------------------------------------------------------
      if (dev.alarms && dev.alarms.length > 0) {
        for (const alarm of dev.alarms) {
          // Buscar o valor já lido da variável correspondente no estado global
          // Procura primeiro pelo nome técnico da variável vinculada ao alarme
          let rawAlarmVal;

          // Tentar localizar a variável do alarme pelo device_id + endereço
          const alarmVar = (dev.variables || []).find(v => {
            const vType = String(v.modbus_type || '').toLowerCase();
            const aType = String(alarm.modbus_type || '').toLowerCase();
            return (
              vType === aType &&
              parseInt(v.modbus_address) === parseInt(alarm.modbus_address)
            );
          });

          if (alarmVar && this.state[alarmVar.name] !== undefined) {
            // Variável encontrada: usar valor já lido neste ciclo
            rawAlarmVal = this.state[alarmVar.name];
            // Para alarmes booleanos, converter para 0/1
            if (typeof rawAlarmVal === 'boolean') rawAlarmVal = rawAlarmVal ? 1 : 0;
          } else {
            // Variável não cadastrada no dashboard: fazer leitura pontual
            // (caso raro: alarme configurado em endereço não monitorado)
            const aType = String(alarm.modbus_type || '').toLowerCase();
            const wireAlarmAddr = Math.max(0, parseInt(alarm.modbus_address) || 0);
            try {
              if (aType === 'holding' || aType === 'holdingregister') {
                const res = await dev.client.readHoldingRegisters(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? res.data[0] : undefined;
              } else if (aType === 'input' || aType === 'inputregister') {
                const res = await dev.client.readInputRegisters(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? res.data[0] : undefined;
              } else if (aType === 'coil') {
                const res = await dev.client.readCoils(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? (res.data[0] ? 1 : 0) : undefined;
              } else if (aType === 'discrete' || aType === 'inputstatus') {
                const res = await dev.client.readDiscreteInputs(wireAlarmAddr, 1);
                rawAlarmVal = (res && res.data) ? (res.data[0] ? 1 : 0) : undefined;
              }
            } catch(errAlarm) {
              rawAlarmVal = undefined;
            }
          }

          if (rawAlarmVal === undefined) continue;

          // Avaliar condição do alarme em memória (sem acesso ao banco)
          const conditionMet      = this.evaluateCondition(rawAlarmVal, alarm.condition_type, alarm.condition_value);
          const isCurrentlyActive = this.activeAlarmsSet.has(alarm.id);

          if (conditionMet && !isCurrentlyActive) {
            // Alarme novo: ativar e registrar no banco
            this.activeAlarmsSet.add(alarm.id);
            db.run(
              `INSERT INTO alarm_history (alarm_config_id, trigger_value, status) VALUES (?, ?, 'ACTIVE')`,
              [alarm.id, rawAlarmVal],
              () => { this.emit('alarms_updated'); }
            );
          } else if (!conditionMet && isCurrentlyActive) {
            // Alarme resolvido: desativar e registrar no banco
            this.activeAlarmsSet.delete(alarm.id);
            db.run(
              `UPDATE alarm_history SET status = 'RESOLVED', resolve_time = CURRENT_TIMESTAMP
               WHERE alarm_config_id = ? AND status = 'ACTIVE'`,
              [alarm.id],
              () => { this.emit('alarms_updated'); }
            );
          }
        }
      }

      // Emitir o estado completo para o frontend via WebSocket
      this.emit('update', this.state);

    } catch (e) {
      // Erro grave no ciclo de poll (ex: conexão TCP caiu, timeout total)
      console.error(`[Modbus] Erro crítico ao fazer poll do dispositivo ID ${deviceId}: ${e.message}`);
      dev.connected = false;

      // Parar ciclo de polling e fechar conexão
      if (dev.intervalId) clearInterval(dev.intervalId);
      try { if (dev.client) dev.client.close(); } catch(_) {}

      // Agendar reconexão com backoff exponencial
      const delay = Math.min(5000 * Math.pow(2, dev.retryCount || 0), 30000);
      dev.retryCount = (dev.retryCount || 0) + 1;
      if (dev.retryTimeout) clearTimeout(dev.retryTimeout);
      dev.retryTimeout = setTimeout(() => this.connectDevice(deviceId), delay);

    } finally {
      // Sempre liberar o guard de polling ao final do ciclo, mesmo em caso de erro
      dev.isPolling = false;
    }
  }

  // ---------------------------------------------------------------------------
  // writeModbus — Escreve um valor em um registrador Modbus.
  //
  // Parâmetros:
  //   deviceId    — ID do dispositivo alvo
  //   modbus_type — Tipo: 'coil' | 'holding' | 'holdingregister'
  //   address     — Endereço do registrador (0-based)
  //   value       — Valor a escrever (boolean para coil, número para holding)
  //   decimals    — Número de casas decimais (para escalar inteiros)
  //   bit_index   — Índice de bit na word (>=0 para escrita de bit específico, -1 para word inteira)
  //   var_name    — Nome técnico da variável (para atualizar this.state imediatamente)
  //
  // Retorna: true em caso de sucesso, lança exceção em caso de falha
  // ---------------------------------------------------------------------------
  async writeModbus(deviceId, modbus_type, address, value, decimals = 0, bit_index = -1, var_name = null) {
    const dev      = this.devices[deviceId];
    const mType    = String(modbus_type || '').toLowerCase();
    const wireAddr = Math.max(0, parseInt(address) || 0);

    console.log(`[Modbus Write] Dispositivo=${deviceId} Tipo=${mType} Endereço=${wireAddr} Valor=${value} Bit=${bit_index} Var=${var_name}`);

    // -------------------------------------------------------------------------
    // Helper interno: atualiza o estado global (this.state) para refletir a
    // escrita imediatamente, sem esperar o próximo ciclo de polling.
    // Atualiza tanto pelo nome técnico quanto pelo display_name.
    // -------------------------------------------------------------------------
    const updateState = (val) => {
      if (!var_name) return;
      this.state[var_name] = val;
      // Buscar o display_name correspondente para manter sincronia
      for (const devId in this.devices) {
        const vars  = this.devices[devId].variables || [];
        const found = vars.find(v => v.name === var_name);
        if (found && found.display_name) {
          this.state[found.display_name] = val;
        }
      }
    };

    // -------------------------------------------------------------------------
    // Dispositivo offline: atualiza apenas o estado em memória (sem escrita real)
    // Útil para simular mudanças em modo de desenvolvimento sem CLP conectado.
    // -------------------------------------------------------------------------
    if (!dev || !dev.connected) {
      console.warn(`[Modbus Write] Dispositivo ${deviceId} offline — atualizando estado em memória apenas.`);
      if (mType === 'coil') {
        updateState(Boolean(value));
      } else if ((mType === 'holding' || mType === 'holdingregister') && parseInt(bit_index) >= 0) {
        // Modo bit: calcula a nova word preservando os demais bits
        const bitIdx  = parseInt(bit_index);
        const curWord = parseInt(this.state[var_name]) || 0;
        const newWord = Boolean(value) ? (curWord | (1 << bitIdx)) : (curWord & ~(1 << bitIdx));
        updateState(Boolean((newWord >> bitIdx) & 1));
      } else {
        updateState(value);
      }
      this.emit('update', this.state);
      return true;
    }

    // -------------------------------------------------------------------------
    // Escrita Modbus efetiva (dispositivo online)
    // -------------------------------------------------------------------------
    if (mType === 'coil') {
      // Função Modbus 05 — Write Single Coil
      const boolVal = Boolean(value);
      console.log(`[Modbus Write] writeCoil(addr=${wireAddr}, val=${boolVal})`);
      await dev.client.writeCoil(wireAddr, boolVal);
      updateState(boolVal);

    } else if (mType === 'holding' || mType === 'holdingregister') {
      if (bit_index !== undefined && bit_index !== null && parseInt(bit_index) >= 0) {
        // Modo escrita de bit em holding register:
        // 1. Ler a word atual (read-modify-write)
        // 2. Aplicar máscara para o bit desejado
        // 3. Escrever a nova word
        const bitIdx  = parseInt(bit_index);
        let curWord   = 0;
        try {
          const res = await dev.client.readHoldingRegisters(wireAddr, 1);
          if (res && res.data) curWord = res.data[0];
        } catch(e) {
          console.warn(`[Modbus Write] Não foi possível ler word atual em [${wireAddr}] — usando 0 como base`);
        }
        const newWord = Boolean(value)
          ? (curWord |  (1 << bitIdx))  // Set bit
          : (curWord & ~(1 << bitIdx)); // Clear bit
        console.log(`[Modbus Write] writeRegister(addr=${wireAddr}, word=${newWord}) bit#${bitIdx}=${Boolean(value)}`);
        // Função Modbus 06 — Write Single Register
        await dev.client.writeRegister(wireAddr, newWord);
        updateState(Boolean((newWord >> bitIdx) & 1));

      } else {
        // Modo escrita de word inteira ou float (analógico com escala de decimais)
        
        // 1. Descobrir o formato da variável parseando o campo 'options' (JSON) do banco
        let dataFormat = '16_int';
        let endianness = 'ABCD';
        let varScale   = null;
        let varOffset  = null;
        let varDecimals = decimals || 0;

        if (var_name) {
          const vars = dev.variables || [];
          const found = vars.find(v => v.name === var_name);
          if (found) {
            // options é uma string JSON — precisa fazer parse
            let opts = {};
            try {
              opts = typeof found.options === 'string' ? JSON.parse(found.options || '{}') : (found.options || {});
            } catch(e) { opts = {}; }

            if (opts.data_format) dataFormat = opts.data_format;
            if (opts.endianness)  endianness  = opts.endianness;
            if (opts.scale  !== undefined && opts.scale  !== null && opts.scale  !== '') varScale  = parseFloat(opts.scale);
            if (opts.offset !== undefined && opts.offset !== null && opts.offset !== '') varOffset = parseFloat(opts.offset);
            if (found.decimals !== undefined && found.decimals !== null) varDecimals = parseInt(found.decimals) || 0;
          }
        }

        const is32Bit = String(dataFormat).startsWith('32');
        const isFloat = dataFormat === '32_float';

        // 2. Reverter transformações aplicadas na leitura antes de enviar para o CLP:
        //    Na leitura: finalValue = (rawValue * scale + offset) / 10^decimals  (para não-float)
        //    Na escrita: rawValue  = (value * 10^decimals - offset) / scale
        //    Nota: float 32 bits não usa decimals nem scale — é enviado diretamente
        let valueToEncode = Number(value);
        if (!isFloat) {
          // Reverter offset
          if (varOffset !== null && !isNaN(varOffset) && varOffset !== 0) {
            valueToEncode = valueToEncode - varOffset;
          }
          // Reverter scale
          if (varScale !== null && !isNaN(varScale) && varScale !== 0 && varScale !== 1) {
            valueToEncode = valueToEncode / varScale;
          }
        }

        console.log(`[Modbus Write] Holding fmt=${dataFormat} end=${endianness} scale=${varScale} offset=${varOffset} dec=${varDecimals} userVal=${value} encoded=${valueToEncode}`);

        if (is32Bit) {
          const valToWrite = isFloat ? valueToEncode : Math.round(valueToEncode * Math.pow(10, varDecimals));
          const buf = Buffer.alloc(4);
          
          if (isFloat) buf.writeFloatBE(valToWrite, 0);
          else if (dataFormat === '32_int')  buf.writeInt32BE(valToWrite, 0);
          else                               buf.writeUInt32BE(valToWrite >>> 0, 0);

          const A = buf[0], B = buf[1], C = buf[2], D = buf[3];
          let finalBytes;
          switch (endianness) {
            case 'BADC': finalBytes = [B, A, D, C]; break;
            case 'DCBA': finalBytes = [D, C, B, A]; break;
            case 'CDAB': finalBytes = [C, D, A, B]; break;
            case 'ABCD':
            default:     finalBytes = [A, B, C, D]; break;
          }
          const w1 = ((finalBytes[0] << 8) | finalBytes[1]) & 0xFFFF;
          const w2 = ((finalBytes[2] << 8) | finalBytes[3]) & 0xFFFF;
          const words = [w1, w2];
          
          console.log(`[Modbus Write] FC16 writeRegisters(addr=${wireAddr}, words=[${w1}, ${w2}]) rawVal=${valToWrite}`);
          await dev.client.writeRegisters(wireAddr, words);

        } else {
          // 16 bits — FC06
          const rawValue = Math.round(valueToEncode * Math.pow(10, varDecimals));
          console.log(`[Modbus Write] FC06 writeRegister(addr=${wireAddr}, raw=${rawValue}) encoded=${valueToEncode}`);
          await dev.client.writeRegister(wireAddr, rawValue);
        }

        updateState(Number(value));
      }
    } else {
      throw new Error(`Tipo Modbus '${mType}' não suporta escrita direta. Use 'coil' ou 'holding'.`);
    }

    // Emitir update imediato para refletir a escrita no frontend antes do próximo poll
    this.emit('update', this.state);
    return true;
  }

  // ---------------------------------------------------------------------------
  // evaluateCondition — Avalia se um valor atual satisfaz a condição de um alarme.
  //
  // Operadores suportados: ==, !=, >, >=, <, <=
  // Todos os valores são comparados como números de ponto flutuante.
  // ---------------------------------------------------------------------------
  evaluateCondition(currentValue, operator, targetValue) {
    const v1 = parseFloat(currentValue);
    const v2 = parseFloat(targetValue);
    switch (operator) {
      case '==': return v1 === v2;
      case '!=': return v1 !== v2;
      case '>':  return v1 >  v2;
      case '>=': return v1 >= v2;
      case '<':  return v1 <  v2;
      case '<=': return v1 <= v2;
      default:   return false;
    }
  }
}

// Criar a instância singleton do serviço — compartilhada por todo o backend
const plc = new PLCService();
module.exports = plc;
