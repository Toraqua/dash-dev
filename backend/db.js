const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'kronox.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao SQLite:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite.');
    db.configure('busyTimeout', 5000);
    initDb();
  }
});

function initDb() {
  db.serialize(() => {
    // Otimizações de Alta Concorrência (Prevenção contra SQLITE_BUSY: database is locked)
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA busy_timeout = 5000;');
    db.run('PRAGMA synchronous = NORMAL;');

    // Tabela de Configurações do Sistema (Global)
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

    // Tabela de Logs de Auditoria
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

    // Tabela de Usuários (simplificado para o teste)
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

    // Tabela de Dispositivos (PLCs) — Sem dispositivo padrão: o usuário cria seus próprios
    db.run(`CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 502,
      polling_interval_ms INTEGER NOT NULL DEFAULT 1000,
      status TEXT DEFAULT 'Offline'
    )`);

    // Tabela de Variáveis Monitoradas (Modbus) — Sem variáveis padrão: o usuário cria as suas
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

    // Ensure options column exists on existing databases
    db.run(`ALTER TABLE variables ADD COLUMN options TEXT DEFAULT '{}'`, () => {});


    // Tabela de Histórico de Variáveis
    db.run(`CREATE TABLE IF NOT EXISTS variable_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variable_id INTEGER,
      value REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(variable_id) REFERENCES variables(id)
    )`);
    // Tabela de Histórico de Alarmes
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

    // Tabela de Câmeras (RTSP) — Sem câmera padrão: o usuário cadastra as suas
    db.run(`CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      grid_layout TEXT,
      resolution TEXT DEFAULT '360p'
    )`);
    db.run(`ALTER TABLE cameras ADD COLUMN grid_layout TEXT`, () => {});
    db.run(`ALTER TABLE cameras ADD COLUMN resolution TEXT DEFAULT '360p'`, () => {});


    // Tabela de Cadastro de Alarmes
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

    // TABELAS DO MENU GATEWAY (REDE, ROTAS, MQTT, AUDITORIA)
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

    // Migration: add route_metric column if it doesn't exist
    db.run(`ALTER TABLE gateway_network_config ADD COLUMN route_metric INTEGER DEFAULT 100`, () => {});

    const insertNet = db.prepare(`INSERT OR IGNORE INTO gateway_network_config (interface, enabled, mode, ip_address, netmask_cidr, gateway, dns, is_default_route, route_metric) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertNet.run('eth0', 1, 'dhcp', '', '', '', '', 1, 100);
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
