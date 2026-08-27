// =============================================================================
// db.js — Conexão e Inicialização do Banco de Dados SQLite
// Inclui helpers Promisificados (allAsync, getAsync, runAsync, runBatchAsync)
// e otimizações de índice para queries frequentes de telemetria.
// =============================================================================

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const dbPath = path.resolve(__dirname, 'kronox.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao SQLite:', err.message);
    process.exit(1);
  } else {
    console.log('Conectado ao banco de dados SQLite.');
    db.configure('busyTimeout', 5000);
    initDb();
  }
});

// =============================================================================
// Helpers Promisificados — eliminam callback hell no plc.js e nas rotas
// =============================================================================

/** SELECT que retorna múltiplas linhas */
db.allAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );

/** SELECT que retorna uma única linha */
db.getAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))
  );

/** INSERT / UPDATE / DELETE — resolve com { lastID, changes } */
db.runAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    })
  );

/**
 * Executa múltiplos INSERTs em uma única transação atômica.
 * rows: Array de { sql, params }
 */
db.runBatchAsync = (rows) =>
  new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      let error = null;
      for (const { sql, params } of rows) {
        if (error) break;
        db.run(sql, params, (err) => { if (err) error = err; });
      }
      db.run('COMMIT', (err) => {
        if (err || error) {
          db.run('ROLLBACK');
          reject(err || error);
        } else {
          resolve();
        }
      });
    });
  });

// =============================================================================
// Inicialização do Esquema de Banco de Dados
// =============================================================================
function initDb() {
  db.serialize(() => {
    // Otimizações de Alta Concorrência (WAL mode + busy timeout)
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA busy_timeout = 5000;');
    db.run('PRAGMA synchronous = NORMAL;');
    db.run('PRAGMA cache_size = -4096;'); // 4MB de cache em memória

    // --- Configurações do Sistema ---
    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    const initialLighting = JSON.stringify({
      enabled: true,
      name: 'Iluminação Elevatória',
      device_id: 1,
      modbus_type: 'coil',
      modbus_address: 0
    });
    db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('lighting_config', ?)`, [initialLighting]);

    // --- Logs de Auditoria ---
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      action TEXT,
      param_name TEXT,
      old_value REAL,
      new_value REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT
    )`);

    // --- Usuários ---
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    )`);
    const insertUser = db.prepare(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`);
    insertUser.run('admin', '9876', 'admin');
    insertUser.run('operador', '1234', 'operator');
    insertUser.finalize();

    // --- Dispositivos (PLCs) ---
    db.run(`CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 502,
      polling_interval_ms INTEGER NOT NULL DEFAULT 1000,
      status TEXT DEFAULT 'Offline'
    )`);

    // --- Variáveis Monitoradas ---
    db.run(`CREATE TABLE IF NOT EXISTS variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      unit TEXT,
      modbus_address INTEGER,
      modbus_type TEXT,
      decimals INTEGER DEFAULT 0,
      widget_type TEXT DEFAULT 'value',
      grid_layout TEXT DEFAULT '{}',
      color TEXT DEFAULT '#3b82f6',
      category TEXT DEFAULT 'supervision',
      options TEXT DEFAULT '{}',
      FOREIGN KEY(device_id) REFERENCES devices(id)
    )`);
    db.run(`ALTER TABLE variables ADD COLUMN options TEXT DEFAULT '{}'`, () => {});

    // --- Histórico de Variáveis + Índices de Performance ---
    db.run(`CREATE TABLE IF NOT EXISTS variable_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variable_id INTEGER,
      value REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(variable_id) REFERENCES variables(id)
    )`);
    // Índice crítico: acelera MAX(timestamp) GROUP BY variable_id e queries de período
    db.run(`CREATE INDEX IF NOT EXISTS idx_vh_var_ts ON variable_history(variable_id, timestamp DESC)`);
    // Índice para limpeza de dados antigos (TTL/purge)
    db.run(`CREATE INDEX IF NOT EXISTS idx_vh_ts ON variable_history(timestamp)`);

    // --- Histórico de Alarmes + Índice ---
    db.run(`CREATE TABLE IF NOT EXISTS alarm_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alarm_config_id INTEGER,
      trigger_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolve_time DATETIME,
      status TEXT DEFAULT 'ACTIVE',
      trigger_value REAL,
      FOREIGN KEY(alarm_config_id) REFERENCES alarm_configs(id)
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_alarm_history_trig ON alarm_history(trigger_time)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_alarm_history_status ON alarm_history(status)`);

    // --- Câmeras (RTSP) ---
    db.run(`CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      grid_layout TEXT,
      resolution TEXT DEFAULT '360p'
    )`);
    db.run(`ALTER TABLE cameras ADD COLUMN grid_layout TEXT`, () => {});
    db.run(`ALTER TABLE cameras ADD COLUMN resolution TEXT DEFAULT '360p'`, () => {});

    // --- Configuração de Alarmes ---
    db.run(`CREATE TABLE IF NOT EXISTS alarm_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      modbus_address INTEGER NOT NULL,
      modbus_type TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      condition_value REAL NOT NULL,
      severity TEXT NOT NULL,
      action_measures TEXT,
      enabled INTEGER DEFAULT 1,
      FOREIGN KEY(device_id) REFERENCES devices(id)
    )`);

    // --- Tabelas do Gateway (Rede, Rotas, MQTT, Auditoria) ---
    db.run(`CREATE TABLE IF NOT EXISTS gateway_network_config (
      interface TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      mode TEXT DEFAULT 'dhcp',
      ip_address TEXT DEFAULT '',
      netmask_cidr TEXT DEFAULT '',
      gateway TEXT DEFAULT '',
      dns TEXT DEFAULT '',
      is_default_route INTEGER DEFAULT 0,
      route_metric INTEGER DEFAULT 100,
      wifi_ssid TEXT DEFAULT '',
      wifi_security TEXT DEFAULT 'wpa2',
      wifi_password TEXT DEFAULT ''
    )`);
    db.run(`ALTER TABLE gateway_network_config ADD COLUMN route_metric INTEGER DEFAULT 100`, () => {});

    const insertNet = db.prepare(`INSERT OR IGNORE INTO gateway_network_config
      (interface, enabled, mode, ip_address, netmask_cidr, gateway, dns, is_default_route, route_metric)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertNet.run('eth0',  1, 'dhcp', '', '', '', '', 1, 100);
    insertNet.run('wlan0', 1, 'dhcp', '', '', '', '', 1, 200);
    insertNet.finalize();

    db.run(`CREATE TABLE IF NOT EXISTS gateway_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      netmask_cidr TEXT NOT NULL,
      gateway TEXT NOT NULL,
      interface TEXT NOT NULL,
      metric INTEGER DEFAULT 100,
      persistent INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS gateway_mqtt_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT DEFAULT '',
      port INTEGER DEFAULT 1883,
      client_id TEXT DEFAULT 'kronox-gw-01',
      username TEXT DEFAULT '',
      password TEXT DEFAULT '',
      keep_alive INTEGER DEFAULT 60,
      use_ssl INTEGER DEFAULT 0,
      clean_session INTEGER DEFAULT 1,
      last_will_topic TEXT DEFAULT '',
      last_will_qos INTEGER DEFAULT 0,
      last_will_retain INTEGER DEFAULT 0,
      last_will_message TEXT DEFAULT '',
      publish_topic TEXT DEFAULT 'kronox/telemetry/state',
      publish_interval_seconds INTEGER DEFAULT 5,
      json_template TEXT DEFAULT '{\n  "data": {\n    "corrente": {{corrente}},\n    "level": {{level}},\n    "pump1": {{pump1}}\n  }\n}'
    )`);
    db.run(`INSERT OR IGNORE INTO gateway_mqtt_config (id, host, port, client_id) VALUES (1, 'broker.hivemq.com', 1883, 'kronox-gw-01')`);

    db.run(`CREATE TABLE IF NOT EXISTS gateway_mqtt_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS gateway_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      category TEXT,
      action TEXT,
      details TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

module.exports = db;
