const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');

const db = require('./db');
const plc = require('./plc');
const gatewayService = require('./gateway');

const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Servir os arquivos estáticos do Frontend compilado (dist)
const distPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(distPath));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// WebSocket para Atualizações em Tempo Real
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  
  socket.emit('config', plc.config);
  socket.emit('update', plc.state);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

plc.on('update', (state) => {
  io.emit('update', state);
  gatewayService.publishTelemetry(state);
});

plc.on('alarms_updated', () => {
  io.emit('alarms_updated');
});

// --- API de Autenticação ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });

  db.get('SELECT id, username, role FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: 'Credenciais inválidas.' });
    res.json({ success: true, user: row });
  });
});

// --- APIs de Gestão de Usuários e Credenciais ---
app.get('/api/users', (req, res) => {
  db.all('SELECT id, username, role FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Nome de usuário e senha são obrigatórios.' });
  
  db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, password, role || 'operator'], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nome de usuário já existe.' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.put('/api/users/:id', (req, res) => {
  const { username, password, role } = req.body;
  const userId = req.params.id;

  if (password && password.trim() !== '') {
    db.run(
      'UPDATE users SET username = COALESCE(?, username), password = ?, role = COALESCE(?, role) WHERE id = ?',
      [username, password, role, userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  } else {
    db.run(
      'UPDATE users SET username = COALESCE(?, username), role = COALESCE(?, role) WHERE id = ?',
      [username, role, userId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  }
});

app.delete('/api/users/:id', (req, res) => {
  const userId = req.params.id;
  db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row.count <= 1) {
      return res.status(400).json({ error: 'Não é possível remover o único usuário do sistema.' });
    }
    db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

app.get('/api/audit', (req, res) => {
  db.all('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- APIs de Dispositivos (PLCs) ---
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // Join with live status
    const result = rows.map(r => ({
      ...r,
      live_status: plc.devices[r.id] ? (plc.devices[r.id].connected ? 'Online' : 'Offline') : 'Desconhecido'
    }));
    res.json(result);
  });
});

app.post('/api/devices', (req, res) => {
  const { name, ip_address, port, polling_interval_ms } = req.body;
  db.run(`INSERT INTO devices (name, ip_address, port, polling_interval_ms) VALUES (?, ?, ?, ?)`, 
    [name, ip_address, port || 502, polling_interval_ms || 1000], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      plc.reloadDevices();
      res.json({ id: this.lastID, success: true });
  });
});

app.delete('/api/devices/:id', (req, res) => {
  db.run('DELETE FROM devices WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    plc.reloadDevices();
    res.json({ success: true });
  });
});

app.put('/api/devices/:id', (req, res) => {
  const { name, ip_address, port, polling_interval_ms } = req.body;
  db.run(
    `UPDATE devices SET name = COALESCE(?, name), ip_address = COALESCE(?, ip_address), port = COALESCE(?, port), polling_interval_ms = COALESCE(?, polling_interval_ms) WHERE id = ?`,
    [name, ip_address, port, polling_interval_ms, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      plc.reloadDevices();
      res.json({ success: true });
    }
  );
});

// --- APIs de Variáveis ---
app.get('/api/variables', (req, res) => {
  db.all('SELECT * FROM variables', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/variables', (req, res) => {
  const { device_id, name, display_name, type, unit, modbus_address, modbus_type, decimals, widget_type, grid_layout, color, category, options } = req.body;
  
  db.run(`INSERT INTO variables (device_id, name, display_name, type, unit, modbus_address, modbus_type, decimals, widget_type, grid_layout, color, category, options) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
    [device_id, name, display_name, type, unit || '', modbus_address, modbus_type, decimals || 0, widget_type || 'value', JSON.stringify(grid_layout || {}), color || '#3b82f6', category || 'supervision', JSON.stringify(options || {})], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      plc.reloadDevices();
      io.emit('variables_updated');
      res.json({ id: this.lastID, success: true });
  });
});

app.put('/api/variables/:id', (req, res) => {
  const { device_id, name, display_name, type, unit, modbus_address, modbus_type, decimals, widget_type, grid_layout, color, category, options } = req.body;
  
  if (grid_layout && Object.keys(req.body).length === 1) {
    db.run(`UPDATE variables SET grid_layout = ? WHERE id = ?`, [JSON.stringify(grid_layout), req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('variables_updated');
      res.json({ success: true });
    });
  } else {
    db.run(`UPDATE variables SET device_id = ?, name = ?, display_name = ?, type = ?, unit = ?, modbus_address = ?, modbus_type = ?, decimals = ?, widget_type = ?, color = ?, category = ?, options = ?, grid_layout = COALESCE(?, grid_layout) WHERE id = ?`, 
      [device_id, name, display_name, type, unit || '', modbus_address, modbus_type, decimals || 0, widget_type || 'value', color || '#3b82f6', category || 'supervision', JSON.stringify(options || {}), grid_layout ? (typeof grid_layout === 'string' ? grid_layout : JSON.stringify(grid_layout)) : null, req.params.id], 
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        plc.reloadDevices();
        io.emit('variables_updated');
        res.json({ success: true });
    });
  }
});

app.delete('/api/variables/:id', (req, res) => {
  db.run('DELETE FROM variables WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    plc.reloadDevices();
    io.emit('variables_updated');
    res.json({ success: true });
  });
});

// --- API Histórico ---
app.get('/api/history/:variableId', (req, res) => {
  const limit = parseInt(req.query.limit) || 50000;
  db.all(`SELECT timestamp, value FROM variable_history WHERE variable_id = ? ORDER BY timestamp DESC LIMIT ?`, [req.params.variableId, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.reverse()); // Chronological order
  });
});

// --- API Gravação Modbus ---
app.post('/api/modbus/write', async (req, res) => {
  const { device_id, modbus_type, address, value, decimals } = req.body;
  try {
    await plc.writeModbus(device_id, modbus_type, address, value, decimals);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// --- APIs de Configurações do Sistema ---
app.get('/api/settings/lighting', (req, res) => {
  db.get(`SELECT value FROM system_settings WHERE key = 'lighting_config'`, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json({ enabled: true, name: 'Iluminação Elevatória', device_id: 1, modbus_type: 'coil', modbus_address: 0 });
    try {
      res.json(JSON.parse(row.value));
    } catch(e) {
      res.json({ enabled: true, name: 'Iluminação Elevatória', device_id: 1, modbus_type: 'coil', modbus_address: 0 });
    }
  });
});

app.post('/api/settings/lighting', (req, res) => {
  const config = req.body;
  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('lighting_config', ?)`, [JSON.stringify(config)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('lighting_config_updated', config);
    res.json({ success: true });
  });
});

app.get('/api/settings/general', (req, res) => {
  db.get(`SELECT value FROM system_settings WHERE key = 'general_config'`, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json({ system_name: 'KRONOX OS', system_logo: '/logo.png', dashboard_title: 'Visão Geral da Estação', timezone: 'America/Sao_Paulo', history_interval_seconds: 15 });
    try {
      res.json(JSON.parse(row.value));
    } catch(e) {
      res.json({ system_name: 'KRONOX OS', system_logo: '/logo.png', dashboard_title: 'Visão Geral da Estação', timezone: 'America/Sao_Paulo', history_interval_seconds: 15 });
    }
  });
});

app.post('/api/settings/general', (req, res) => {
  const config = req.body;
  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('general_config', ?)`, [JSON.stringify(config)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (plc && plc.loadGeneralConfig) plc.loadGeneralConfig();
    io.emit('general_config_updated', config);
    res.json({ success: true });
  });
});

// --- APIs de Câmeras ---
app.get('/api/cameras', (req, res) => {
  db.all('SELECT * FROM cameras', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/cameras', (req, res) => {
  const { name, url } = req.body;
  db.run(`INSERT INTO cameras (name, url) VALUES (?, ?)`, [name, url], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, success: true });
  });
});

app.delete('/api/cameras/:id', (req, res) => {
  db.run('DELETE FROM cameras WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put('/api/cameras/:id', (req, res) => {
  const { name, url, grid_layout } = req.body;
  if (grid_layout) {
    db.run(`UPDATE cameras SET grid_layout = ? WHERE id = ?`, [JSON.stringify(grid_layout), req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } else {
    db.run(
      `UPDATE cameras SET name = COALESCE(?, name), url = COALESCE(?, url) WHERE id = ?`,
      [name, url, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  }
});

// --- APIs de Alarmes ---
app.get('/api/alarm_configs', (req, res) => {
  const sql = `
    SELECT c.*, d.name as device_name 
    FROM alarm_configs c 
    LEFT JOIN devices d ON c.device_id = d.id
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/alarm_configs', (req, res) => {
  const { device_id, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures } = req.body;
  const sql = `INSERT INTO alarm_configs (device_id, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [parseInt(device_id) || 1, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, success: true });
    // Notify PLC service to reload configs
    if (plc && plc.loadAlarmConfigs) plc.loadAlarmConfigs();
  });
});

app.put('/api/alarm_configs/:id', (req, res) => {
  const { device_id, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures, enabled } = req.body;
  const sql = `UPDATE alarm_configs SET device_id=?, name=?, description=?, modbus_address=?, modbus_type=?, condition_type=?, condition_value=?, severity=?, action_measures=?, enabled=? WHERE id=?`;
  db.run(sql, [parseInt(device_id) || 1, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures, enabled, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
    if (plc && plc.loadAlarmConfigs) plc.loadAlarmConfigs();
  });
});

app.delete('/api/alarm_configs/:id', (req, res) => {
  db.run('DELETE FROM alarm_configs WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
    if (plc && plc.loadAlarmConfigs) plc.loadAlarmConfigs();
  });
});

app.get('/api/alarm_history', (req, res) => {
  const sql = `
    SELECT h.*, c.name, c.description, c.severity, c.action_measures, c.device_id, d.name as device_name 
    FROM alarm_history h 
    JOIN alarm_configs c ON h.alarm_config_id = c.id 
    LEFT JOIN devices d ON c.device_id = d.id
    ORDER BY h.id DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- API: Exportar Configuração do Sistema (.JSON) ---
app.get('/api/config/export', async (req, res) => {
  try {
    const devices = await new Promise((resolve, reject) => db.all('SELECT * FROM devices', [], (e, r) => e ? reject(e) : resolve(r)));
    const variables = await new Promise((resolve, reject) => db.all('SELECT * FROM variables', [], (e, r) => e ? reject(e) : resolve(r)));
    const alarm_configs = await new Promise((resolve, reject) => db.all('SELECT * FROM alarm_configs', [], (e, r) => e ? reject(e) : resolve(r)));
    const cameras = await new Promise((resolve, reject) => db.all('SELECT * FROM cameras', [], (e, r) => e ? reject(e) : resolve(r)));
    const system_settings = await new Promise((resolve, reject) => db.all('SELECT * FROM system_settings', [], (e, r) => e ? reject(e) : resolve(r)));

    res.json({
      version: '1.0',
      exported_at: new Date().toISOString(),
      devices,
      variables,
      alarm_configs,
      cameras,
      system_settings
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// --- API: Importar Configuração do Sistema (.JSON) ---
app.post('/api/config/import', async (req, res) => {
  const { devices, variables, alarm_configs, cameras, system_settings } = req.body;
  if (!variables || !Array.isArray(variables)) {
    return res.status(400).json({ error: 'Formato de arquivo de configuração inválido.' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    if (Array.isArray(devices) && devices.length > 0) {
      db.run('DELETE FROM devices');
      const stmt = db.prepare('INSERT INTO devices (id, name, ip_address, port, polling_interval_ms, status) VALUES (?, ?, ?, ?, ?, ?)');
      devices.forEach(d => stmt.run(d.id, d.name, d.ip_address, d.port, d.polling_interval_ms, d.status || 'Offline'));
      stmt.finalize();
    }

    if (Array.isArray(variables) && variables.length > 0) {
      db.run('DELETE FROM variables');
      const stmt = db.prepare('INSERT INTO variables (id, device_id, name, display_name, type, unit, modbus_address, modbus_type, decimals, widget_type, grid_layout, color, category, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      variables.forEach(v => stmt.run(v.id, v.device_id, v.name, v.display_name, v.type, v.unit || '', v.modbus_address, v.modbus_type, v.decimals || 0, v.widget_type || 'value', typeof v.grid_layout === 'object' ? JSON.stringify(v.grid_layout) : (v.grid_layout || '{}'), v.color || '#3b82f6', v.category || 'supervision', typeof v.options === 'object' ? JSON.stringify(v.options) : (v.options || '{}')));
      stmt.finalize();
    }

    if (Array.isArray(alarm_configs)) {
      db.run('DELETE FROM alarm_configs');
      const stmt = db.prepare('INSERT INTO alarm_configs (id, device_id, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      alarm_configs.forEach(a => stmt.run(a.id, a.device_id || 1, a.name, a.description || '', a.modbus_address, a.modbus_type, a.condition_type, a.condition_value, a.severity || 'Alta', a.action_measures || '', a.enabled !== undefined ? a.enabled : 1));
      stmt.finalize();
    }

    if (Array.isArray(cameras)) {
      db.run('DELETE FROM cameras');
      const stmt = db.prepare('INSERT INTO cameras (id, name, url) VALUES (?, ?, ?)');
      cameras.forEach(c => stmt.run(c.id, c.name, c.url));
      stmt.finalize();
    }

    if (Array.isArray(system_settings)) {
      db.run('DELETE FROM system_settings');
      const stmt = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)');
      system_settings.forEach(s => stmt.run(s.key, typeof s.value === 'object' ? JSON.stringify(s.value) : s.value));
      stmt.finalize();
    }

    db.run('COMMIT', (err) => {
      if (err) return res.status(500).json({ error: err.message });
      plc.reloadDevices();
      if (plc.loadAlarmConfigs) plc.loadAlarmConfigs();
      io.emit('variables_updated');
      io.emit('alarms_updated');
      io.emit('lighting_config_updated');
      res.json({ success: true });
    });
  });
});

// --- API: Exportar Telemetria de Variáveis (.CSV) ---
app.get('/api/history/export/csv', (req, res) => {
  const { start, end, step_seconds, var_ids } = req.query;
  
  let sql = `
    SELECT v.display_name, v.name, v.unit, h.value, h.timestamp 
    FROM variable_history h
    JOIN variables v ON h.variable_id = v.id
    WHERE 1=1
  `;
  const params = [];

  if (start) {
    sql += ` AND h.timestamp >= ?`;
    params.push(start);
  }
  if (end) {
    sql += ` AND h.timestamp <= ?`;
    params.push(end);
  }
  if (var_ids) {
    const ids = var_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    if (ids.length > 0) {
      sql += ` AND h.variable_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }

  sql += ` ORDER BY h.timestamp ASC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let filteredRows = rows;
    const stepSec = parseInt(step_seconds) || 0;

    if (stepSec > 0 && rows.length > 0) {
      filteredRows = [];
      const lastTsMap = {};
      for (const row of rows) {
        const tsMs = new Date(row.timestamp).getTime();
        const varKey = row.name;
        if (!lastTsMap[varKey] || (tsMs - lastTsMap[varKey]) >= stepSec * 1000) {
          filteredRows.push(row);
          lastTsMap[varKey] = tsMs;
        }
      }
    }

    let csv = '\uFEFFData/Hora;Variável;Tag Interna;Valor;Unidade\n';
    filteredRows.forEach(r => {
      const formattedTime = new Date(r.timestamp).toLocaleString('pt-BR');
      const valStr = typeof r.value === 'number' ? r.value.toString().replace('.', ',') : r.value;
      csv += `"${formattedTime}";"${r.display_name}";"${r.name}";"${valStr}";"${r.unit || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=telemetria_kronox.csv');
    res.send(csv);
  });
});

// --- API: Exportar Histórico de Falhas/Alarmes (.CSV) ---
app.get('/api/alarm_history/export/csv', (req, res) => {
  const sql = `
    SELECT h.*, c.name, c.severity, c.action_measures, d.name as device_name 
    FROM alarm_history h
    JOIN alarm_configs c ON h.alarm_config_id = c.id
    LEFT JOIN devices d ON c.device_id = d.id
    ORDER BY h.trigger_time DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let csv = '\uFEFFData/Hora Disparo;Data/Hora Resolução;Nome da Falha/Alarme;CLP de Origem;Criticidade;Status;Medidas Recomendadas\n';
    rows.forEach(r => {
      const trigTime = r.trigger_time ? new Date(r.trigger_time).toLocaleString('pt-BR') : '';
      const resTime = r.resolve_time ? new Date(r.resolve_time).toLocaleString('pt-BR') : 'Em Aberto (Ativo)';
      const statusText = r.status === 'ACTIVE' ? '🔴 ATIVO' : '🟢 RESOLVIDO';
      const cleanMeasures = (r.action_measures || '').replace(/"/g, '""').replace(/\n/g, ' ');
      csv += `"${trigTime}";"${resTime}";"${r.name}";"${r.device_name || 'CLP Principal'}";"${r.severity}";"${statusText}";"${cleanMeasures}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=historico_falhas_kronox.csv');
    res.send(csv);
  });
});

// ==========================================
// --- APIs DO MENU GATEWAY ---
// ==========================================

// 1. REDE & INTERFACES (eth0, wlan0, wlan1)
app.get('/api/gateway/network', async (req, res) => {
  try {
    const status = await gatewayService.getNetworkStatus();
    res.json(status);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/network', async (req, res) => {
  try {
    const user = req.body.currentUser || { username: 'Admin', id: 1 };
    const result = await gatewayService.applyNetworkConfig(req.body, user);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/network/confirm', (req, res) => {
  const user = req.body.currentUser || { username: 'Admin', id: 1 };
  const result = gatewayService.confirmNetworkConfig(user);
  res.json(result);
});

// 2. ROTAS ESTÁTICAS PERSISTENTES
app.get('/api/gateway/routes', async (req, res) => {
  try {
    const routes = await gatewayService.getRoutes();
    res.json(routes);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/routes', async (req, res) => {
  try {
    const user = req.body.currentUser || { username: 'Admin', id: 1 };
    const result = await gatewayService.addRoute(req.body, user);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/gateway/routes/:id', async (req, res) => {
  try {
    const user = req.query.username ? { username: req.query.username, id: req.query.userId || 1 } : { username: 'Admin', id: 1 };
    const result = await gatewayService.deleteRoute(req.params.id, user);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. VPN NETBIRD
app.get('/api/gateway/vpn', async (req, res) => {
  try {
    const status = await gatewayService.getVpnStatus();
    res.json(status);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/vpn/connect', async (req, res) => {
  try {
    const user = req.body.currentUser || { username: 'Admin', id: 1 };
    const result = await gatewayService.connectVpn(req.body.setupKey, user);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/vpn/disconnect', async (req, res) => {
  try {
    const user = req.body.currentUser || { username: 'Admin', id: 1 };
    const result = await gatewayService.disconnectVpn(user);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. MQTT BROKER & ESTRUTURA JSON
app.get('/api/gateway/mqtt', async (req, res) => {
  try {
    const cfg = await gatewayService.getMqttConfig();
    res.json(cfg);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/mqtt/config', async (req, res) => {
  try {
    const user = req.body.currentUser || { username: 'Admin', id: 1 };
    const result = await gatewayService.saveMqttConfig(req.body, user);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gateway/mqtt/test', async (req, res) => {
  try {
    const result = await gatewayService.testMqttConnection(req.body);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. AUDITORIA GATEWAY
app.get('/api/gateway/audit', async (req, res) => {
  try {
    const logs = await gatewayService.getAuditLogs();
    res.json(logs);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Fallback para SPA React (redireciona rotas não-API para o index.html)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend Servidor rodando na porta ${PORT} (0.0.0.0 - Acesso externo liberado)`);
});
