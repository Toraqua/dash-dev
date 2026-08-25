const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');

// Prevenir queda do processo Node por erros de conexão TCP/Promise Rejection (ex: CLP offline)
process.on('unhandledRejection', (reason) => {
  console.warn('[System] Unhandled Rejection capturada (processo mantido rodando):', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('[System] Uncaught Exception capturada (processo mantido rodando):', err?.message || err);
});

const db = require('./db');
const plc = require('./plc');
const gatewayService = require('./gateway');

const path = require('path');
const fs = require('fs');

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
  socket.emit('update', { state: plc.state, lastReadTimes: plc.lastReadTimes });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

plc.on('update', (data) => {
  io.volatile.emit('update', data);
  // Compatibilidade com o gateway que espera apenas o estado
  gatewayService.publishTelemetry(data.state || data);
});

plc.on('alarms_updated', () => {
  io.emit('alarms_updated');
});

const logAudit = (user, action, paramName, oldValue, newValue, status = 'SUCESSO') => {
  db.run(
    `INSERT INTO audit_logs (user, action, param_name, old_value, new_value, status) VALUES (?, ?, ?, ?, ?, ?)`,
    [String(user || 'Sistema'), String(action || 'OPERACAO'), String(paramName || ''), String(oldValue ?? ''), String(newValue ?? ''), String(status || 'SUCESSO')]
  );
};

// --- API de Autenticação ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });

  db.get('SELECT id, username, role FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
      logAudit(username, 'LOGIN_FALHA', 'Autenticação', '', 'Credenciais inválidas', 'FALHA');
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }
    logAudit(row.username, 'LOGIN_SUCESSO', 'Autenticação', '', `Nível: ${row.role}`, 'SUCESSO');
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
  const sql = `
    SELECT id, user, action, param_name, old_value, new_value, timestamp, status FROM audit_logs
    UNION ALL
    SELECT id, COALESCE(username, 'Sistema') as user, action, category as param_name, '' as old_value, details as new_value, timestamp, 'SUCESSO' as status FROM gateway_audit_logs
    ORDER BY timestamp DESC LIMIT 200
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      return db.all('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100', [], (e, r) => res.json(r || []));
    }
    res.json(rows);
  });
});

app.post('/api/audit', (req, res) => {
  const { user, action, param_name, old_value, new_value, status } = req.body;
  logAudit(user, action, param_name, old_value, new_value, status);
  res.json({ success: true });
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
      plc.reloadVariables();
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
        plc.reloadVariables();
        io.emit('variables_updated');
        res.json({ success: true });
    });
  }
});

app.delete('/api/variables/:id', (req, res) => {
  db.run('DELETE FROM variables WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    plc.reloadVariables();
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
  const { device_id, modbus_type, address, value, decimals, bit_index, var_name, username } = req.body;
  try {
    await plc.writeModbus(device_id, modbus_type, address, value, decimals, bit_index, var_name);
    logAudit(username || 'Operador', 'ESCRITA_MODBUS', `Dispositivo ${device_id} [${modbus_type} #${address}]`, '', value, 'SUCESSO');
    res.json({ success: true });
  } catch(e) {
    logAudit(username || 'Operador', 'ESCRITA_MODBUS', `Dispositivo ${device_id} [${modbus_type} #${address}]`, '', value, 'FALHA');
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
    const def = { system_name: 'KRONOX OS', system_logo: '/kronox_logo.png', sidebar_display: 'image', dashboard_title: 'Visão Geral da Estação', timezone: 'America/Sao_Paulo', history_interval_seconds: 15, auto_cleanup_enabled: false, auto_cleanup_value: 90, auto_cleanup_unit: 'days' };
    if (!row) return res.json(def);
    try {
      res.json({ ...def, ...JSON.parse(row.value) });
    } catch(e) {
      res.json(def);
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

// --- Proxy de Stream RTSP → MJPEG via FFmpeg ---
// Mapa de processos FFmpeg ativos: { cameraId -> { proc, clients, buffer, lastFrameAt, watchdog } }
const activeStreams = {};

function startFfmpeg(camId, camUrl) {
  const ffmpegArgs = [
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-avioflags', 'direct',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-rtsp_transport', 'udp',
    '-i', camUrl,
    '-f', 'mjpeg',
    '-q:v', '5',
    '-r', '8',
    '-'
  ];

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
  const stream = activeStreams[camId];
  if (!stream) return;
  stream.proc = proc;
  stream.buffer = Buffer.alloc(0);
  stream.lastFrameAt = Date.now();

  proc.stdout.on('data', (chunk) => {
    const s = activeStreams[camId];
    if (!s) return;
    s.lastFrameAt = Date.now();
    s.buffer = Buffer.concat([s.buffer, chunk]);

    // Anti-drift: se buffer > 300KB, descartar frames antigos até o último SOI
    if (s.buffer.length > 300 * 1024) {
      const SOI_marker = Buffer.from([0xFF, 0xD8]);
      const lastSoi = s.buffer.lastIndexOf(SOI_marker);
      if (lastSoi > 0) {
        console.log(`[Camera ${camId}] Buffer drift (${(s.buffer.length/1024).toFixed(0)}KB). Descartando frames antigos.`);
        s.buffer = s.buffer.slice(lastSoi);
      }
    }

    const SOI = Buffer.from([0xFF, 0xD8]);
    const EOI = Buffer.from([0xFF, 0xD9]);
    let searchFrom = 0;
    while (true) {
      const start = s.buffer.indexOf(SOI, searchFrom);
      if (start === -1) break;
      const end = s.buffer.indexOf(EOI, start + 2);
      if (end === -1) break;
      const frame = s.buffer.slice(start, end + 2);
      s.buffer = s.buffer.slice(end + 2);
      searchFrom = 0;
      const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      const packet = Buffer.concat([header, frame, Buffer.from('\r\n')]);

      // Transmissão com proteção de backpressure: descarta frames para clientes lentos/abas em segundo plano
      s.clients.forEach(client => {
        if (client.destroyed || client.writableEnded) return;
        // Se a resposta HTTP do cliente estiver com o buffer cheio (>64KB), descarta o frame para evitar estouro de RAM
        if (client.writableLength > 64 * 1024 || client.writableNeedDrain) {
          return;
        }
        try { client.write(packet); } catch (_) {}
      });
    }
  });

  proc.on('exit', (code) => {
    console.log(`[Camera ${camId}] FFmpeg encerrado (código ${code})`);
    if (activeStreams[camId] && activeStreams[camId].clients.size > 0) {
      console.log(`[Camera ${camId}] Reiniciando FFmpeg automaticamente...`);
      setTimeout(() => {
        if (activeStreams[camId] && activeStreams[camId].clients.size > 0) startFfmpeg(camId, camUrl);
      }, 1000);
    } else if (activeStreams[camId]) {
      clearInterval(activeStreams[camId].watchdog);
      delete activeStreams[camId];
    }
  });

  proc.on('error', (e) => {
    if (e.code === 'ENOENT') console.error('[Camera] FFmpeg não encontrado. Instale: sudo apt install -y ffmpeg');
    if (activeStreams[camId]) { clearInterval(activeStreams[camId].watchdog); delete activeStreams[camId]; }
  });
}

// Stream MJPEG ao vivo: GET /api/cameras/:id/stream
app.get('/api/cameras/:id/stream', (req, res) => {
  const camId = parseInt(req.params.id);
  db.get('SELECT * FROM cameras WHERE id = ?', [camId], (err, cam) => {
    if (err || !cam) return res.status(404).json({ error: 'Câmera não encontrada' });
    if (!cam.url || !cam.url.startsWith('rtsp')) {
      return res.status(400).json({ error: 'URL RTSP inválida.' });
    }

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace;boundary=--frame',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    if (!activeStreams[camId]) {
      console.log(`[Camera ${camId}] Iniciando FFmpeg para: ${cam.url.replace(/:([^@]+)@/, ':***@')}`);
      activeStreams[camId] = { proc: null, clients: new Set(), buffer: Buffer.alloc(0), lastFrameAt: Date.now(), watchdog: null };

      // Watchdog: reinicia FFmpeg se ficou 15s sem frames
      activeStreams[camId].watchdog = setInterval(() => {
        const s = activeStreams[camId];
        if (!s) return;
        const age = Date.now() - s.lastFrameAt;
        if (age > 15000 && s.clients.size > 0) {
          console.log(`[Camera ${camId}] Sem frames há ${(age/1000).toFixed(0)}s. Reiniciando FFmpeg (watchdog).`);
          try { s.proc.kill('SIGTERM'); } catch (_) {}
        }
      }, 5000);

      startFfmpeg(camId, cam.url);
    }

    activeStreams[camId].clients.add(res);
    console.log(`[Camera ${camId}] Cliente conectado (total: ${activeStreams[camId].clients.size})`);

    req.on('close', () => {
      if (activeStreams[camId]) {
        activeStreams[camId].clients.delete(res);
        console.log(`[Camera ${camId}] Cliente desconectado (restantes: ${activeStreams[camId].clients.size})`);
        if (activeStreams[camId].clients.size === 0) {
          console.log(`[Camera ${camId}] Nenhum cliente. Encerrando FFmpeg.`);
          try { activeStreams[camId].proc.kill('SIGTERM'); } catch (_) {}
          clearInterval(activeStreams[camId].watchdog);
          delete activeStreams[camId];
        }
      }
    });
  });
});

// Snapshot único (frame JPEG estático): GET /api/cameras/:id/snapshot
app.get('/api/cameras/:id/snapshot', (req, res) => {
  const camId = parseInt(req.params.id);
  db.get('SELECT * FROM cameras WHERE id = ?', [camId], (err, cam) => {
    if (err || !cam) return res.status(404).json({ error: 'Câmera não encontrada' });
    if (!cam.url || !cam.url.startsWith('rtsp')) {
      return res.status(400).json({ error: 'URL RTSP inválida' });
    }

    const ffmpegArgs = [
      '-rtsp_transport', 'udp',
      '-i', cam.url,
      '-frames:v', '1',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-vf', 'scale=640:360',
      '-'
    ];

    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];

    proc.stdout.on('data', chunk => chunks.push(chunk));
    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        const img = Buffer.concat(chunks);
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'no-cache');
        res.send(img);
      } else {
        res.status(503).json({ error: 'Falha ao capturar snapshot da câmera' });
      }
    });
    proc.on('error', () => res.status(503).json({ error: 'FFmpeg não instalado' }));
    setTimeout(() => { try { proc.kill(); } catch (_) {} }, 15000); // timeout 15s
  });
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
    const rawVariables = await new Promise((resolve, reject) => db.all('SELECT * FROM variables', [], (e, r) => e ? reject(e) : resolve(r)));
    const alarm_configs = await new Promise((resolve, reject) => db.all('SELECT * FROM alarm_configs', [], (e, r) => e ? reject(e) : resolve(r)));
    const cameras = await new Promise((resolve, reject) => db.all('SELECT * FROM cameras', [], (e, r) => e ? reject(e) : resolve(r)));
    const system_settings = await new Promise((resolve, reject) => db.all('SELECT * FROM system_settings', [], (e, r) => e ? reject(e) : resolve(r)));
    const gateway_network = await new Promise((resolve, reject) => db.all('SELECT * FROM gateway_network_config', [], (e, r) => e ? reject(e) : resolve(r)));
    const gateway_routes = await new Promise((resolve, reject) => db.all('SELECT * FROM gateway_routes', [], (e, r) => e ? reject(e) : resolve(r)));
    const gateway_mqtt = await new Promise((resolve, reject) => db.all('SELECT * FROM gateway_mqtt_config', [], (e, r) => e ? reject(e) : resolve(r)));
    const users = await new Promise((resolve, reject) => db.all('SELECT id, username, role FROM users', [], (e, r) => e ? reject(e) : resolve(r)));

    const variables = rawVariables.map(v => {
      let opts = {};
      try {
        opts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
      } catch (e) {}

      let layout = {};
      try {
        layout = typeof v.grid_layout === 'string' ? JSON.parse(v.grid_layout || '{}') : (v.grid_layout || {});
      } catch (e) {}

      return {
        id: v.id,
        device_id: v.device_id,
        name: v.name,
        display_name: v.display_name,
        type: v.type,
        unit: v.unit || '',
        modbus_address: v.modbus_address,
        modbus_type: v.modbus_type,
        decimals: v.decimals || 0,
        widget_type: v.widget_type,
        color: v.color || '#3b82f6',
        category: v.category || 'supervision',
        grid_layout: layout,
        options: {
          data_format: opts.data_format || '16_int',
          endianness: opts.endianness || 'ABCD',
          scale: opts.scale !== undefined ? opts.scale : 1,
          offset: opts.offset !== undefined ? opts.offset : 0,
          bit_index: opts.bit_index !== undefined ? opts.bit_index : -1,
          min_val: opts.min_val !== undefined ? opts.min_val : 0,
          max_val: opts.max_val !== undefined ? opts.max_val : 100,
          label_off: opts.label_off || 'DESLIGADO',
          label_on: opts.label_on || 'LIGADO',
          color_off: opts.color_off || '#ef4444',
          color_on: opts.color_on || '#22c55e',
          ...opts
        }
      };
    });

    const formattedCameras = cameras.map(c => {
      let layout = {};
      try {
        layout = typeof c.grid_layout === 'string' ? JSON.parse(c.grid_layout || '{}') : (c.grid_layout || {});
      } catch (e) {}
      return {
        ...c,
        grid_layout: layout
      };
    });

    res.json({
      version: '1.1',
      exported_at: new Date().toISOString(),
      devices,
      variables,
      alarm_configs,
      cameras: formattedCameras,
      system_settings,
      gateway_network,
      gateway_routes,
      gateway_mqtt,
      users
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// --- API: Importar Configuração do Sistema (.JSON) ---
app.post('/api/config/import', async (req, res) => {
  const { devices, variables, alarm_configs, cameras, system_settings, gateway_network, gateway_routes, gateway_mqtt } = req.body;
  if (!variables || !Array.isArray(variables)) {
    return res.status(400).json({ error: 'Formato de arquivo de configuração inválido.' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    if (Array.isArray(devices)) {
      db.run('DELETE FROM devices');
      if (devices.length > 0) {
        const stmt = db.prepare('INSERT INTO devices (id, name, ip_address, port, polling_interval_ms, status) VALUES (?, ?, ?, ?, ?, ?)');
        devices.forEach(d => stmt.run(d.id, d.name, d.ip_address, d.port, d.polling_interval_ms, d.status || 'Offline'));
        stmt.finalize();
      }
    }

    if (Array.isArray(variables)) {
      db.run('DELETE FROM variables');
      if (variables.length > 0) {
        const stmt = db.prepare('INSERT INTO variables (id, device_id, name, display_name, type, unit, modbus_address, modbus_type, decimals, widget_type, grid_layout, color, category, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        variables.forEach(v => {
          let opts = {};
          if (typeof v.options === 'object' && v.options !== null) {
            opts = { ...v.options };
          } else if (typeof v.options === 'string') {
            try { opts = JSON.parse(v.options || '{}'); } catch (e) {}
          }
          const finalOpts = {
            data_format: opts.data_format || '16_int',
            endianness: opts.endianness || 'ABCD',
            scale: opts.scale !== undefined ? opts.scale : 1,
            offset: opts.offset !== undefined ? opts.offset : 0,
            bit_index: opts.bit_index !== undefined ? opts.bit_index : -1,
            min_val: opts.min_val !== undefined ? opts.min_val : 0,
            max_val: opts.max_val !== undefined ? opts.max_val : 100,
            label_off: opts.label_off || 'DESLIGADO',
            label_on: opts.label_on || 'LIGADO',
            color_off: opts.color_off || '#ef4444',
            color_on: opts.color_on || '#22c55e',
            ...opts
          };
          const layout = typeof v.grid_layout === 'object' ? JSON.stringify(v.grid_layout) : (v.grid_layout || '{}');
          stmt.run(v.id, v.device_id, v.name, v.display_name, v.type, v.unit || '', v.modbus_address, v.modbus_type, v.decimals || 0, v.widget_type || 'value', layout, v.color || '#3b82f6', v.category || 'supervision', JSON.stringify(finalOpts));
        });
        stmt.finalize();
      }
    }

    if (Array.isArray(alarm_configs)) {
      db.run('DELETE FROM alarm_configs');
      if (alarm_configs.length > 0) {
        const stmt = db.prepare('INSERT INTO alarm_configs (id, device_id, name, description, modbus_address, modbus_type, condition_type, condition_value, severity, action_measures, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        alarm_configs.forEach(a => stmt.run(a.id, a.device_id || 1, a.name, a.description || '', a.modbus_address, a.modbus_type, a.condition_type, a.condition_value, a.severity || 'Alta', a.action_measures || '', a.enabled !== undefined ? a.enabled : 1));
        stmt.finalize();
      }
    }

    if (Array.isArray(cameras)) {
      db.run('DELETE FROM cameras');
      if (cameras.length > 0) {
        const stmt = db.prepare('INSERT INTO cameras (id, name, url, grid_layout) VALUES (?, ?, ?, ?)');
        cameras.forEach(c => stmt.run(c.id, c.name, c.url, typeof c.grid_layout === 'object' ? JSON.stringify(c.grid_layout) : (c.grid_layout || '{}')));
        stmt.finalize();
      }
    }

    if (Array.isArray(system_settings)) {
      db.run('DELETE FROM system_settings');
      if (system_settings.length > 0) {
        const stmt = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)');
        system_settings.forEach(s => stmt.run(s.key, typeof s.value === 'object' ? JSON.stringify(s.value) : s.value));
        stmt.finalize();
      }
    }

    if (Array.isArray(gateway_network) && gateway_network.length > 0) {
      db.run('DELETE FROM gateway_network_config');
      const stmt = db.prepare('INSERT INTO gateway_network_config (interface, enabled, mode, ip_address, netmask_cidr, gateway, dns, is_default_route, route_metric, wifi_ssid, wifi_security, wifi_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      gateway_network.forEach(n => stmt.run(n.interface, n.enabled !== undefined ? n.enabled : 1, n.mode || 'dhcp', n.ip_address || '', n.netmask_cidr || '', n.gateway || '', n.dns || '', n.is_default_route || 0, n.route_metric || 100, n.wifi_ssid || '', n.wifi_security || 'wpa2', n.wifi_password || ''));
      stmt.finalize();
    }

    if (Array.isArray(gateway_routes)) {
      db.run('DELETE FROM gateway_routes');
      if (gateway_routes.length > 0) {
        const stmt = db.prepare('INSERT INTO gateway_routes (id, destination, netmask_cidr, gateway, interface, metric, persistent) VALUES (?, ?, ?, ?, ?, ?, ?)');
        gateway_routes.forEach(r => stmt.run(r.id, r.destination || r.target_ip_cidr || '', r.netmask_cidr || '', r.gateway || r.gateway_ip || '', r.interface || '', r.metric || 100, r.persistent !== undefined ? r.persistent : 1));
        stmt.finalize();
      }
    }

    if (Array.isArray(gateway_mqtt) && gateway_mqtt.length > 0) {
      db.run('DELETE FROM gateway_mqtt_config');
      const stmt = db.prepare('INSERT INTO gateway_mqtt_config (id, host, port, client_id, username, password, keep_alive, use_ssl, clean_session, last_will_topic, last_will_qos, last_will_retain, last_will_message, publish_topic, publish_interval_seconds, json_template) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      gateway_mqtt.forEach(m => stmt.run(m.id || 1, m.host || '', m.port || 1883, m.client_id || 'kronox-gw-01', m.username || '', m.password || '', m.keep_alive || 60, m.use_ssl || 0, m.clean_session || 1, m.last_will_topic || '', m.last_will_qos || 0, m.last_will_retain || 0, m.last_will_message || '', m.publish_topic || 'kronox/telemetry/state', m.publish_interval_seconds || 5, m.json_template || ''));
      stmt.finalize();
    }

    db.run('COMMIT', (err) => {
      if (err) return res.status(500).json({ error: err.message });
      if (plc && plc.reloadDevices) plc.reloadDevices();
      if (plc && plc.loadAlarmConfigs) plc.loadAlarmConfigs();
      if (plc && plc.loadGeneralConfig) plc.loadGeneralConfig();

      logAudit('Admin', 'CONFIG_IMPORT', 'Restauração de Backup', '', 'Configuração restaurada', 'SUCESSO');

      db.get(`SELECT value FROM system_settings WHERE key = 'general_config'`, [], (e, r) => {
        if (r) {
          try { io.emit('general_config_updated', JSON.parse(r.value)); } catch (err) {}
        }
      });
      db.get(`SELECT value FROM system_settings WHERE key = 'lighting_config'`, [], (e, r) => {
        if (r) {
          try { io.emit('lighting_config_updated', JSON.parse(r.value)); } catch (err) {}
        }
      });

      io.emit('variables_updated');
      io.emit('alarms_updated');
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

    // Build Pivot Table: Group variables into columns with units in headers
    const varOrder = [];
    const varInfoMap = {};
    const timeGroupMap = {};

    filteredRows.forEach(r => {
      const varKey = r.name || r.display_name;
      if (!varInfoMap[varKey]) {
        const unitSuffix = r.unit ? ` (${r.unit})` : '';
        const headerText = `${r.display_name || varKey}${unitSuffix}`;
        varInfoMap[varKey] = headerText;
        varOrder.push(varKey);
      }

      const timeKey = new Date(r.timestamp).toLocaleString('pt-BR');
      if (!timeGroupMap[timeKey]) {
        timeGroupMap[timeKey] = {};
      }
      const valStr = typeof r.value === 'number' ? r.value.toString().replace('.', ',') : (r.value ?? '');
      timeGroupMap[timeKey][varKey] = valStr;
    });

    const headers = ['Data/Hora', ...varOrder.map(k => `"${varInfoMap[k].replace(/"/g, '""')}"`)].join(';');

    const csvLines = [headers];
    Object.keys(timeGroupMap).forEach(timeKey => {
      const values = timeGroupMap[timeKey];
      const row = [ `"${timeKey}"` ];
      varOrder.forEach(k => {
        const val = values[k];
        if (val !== undefined && val !== null) {
          row.push(`"${val.toString().replace(/"/g, '""')}"`);
        } else {
          row.push('""');
        }
      });
      csvLines.push(row.join(';'));
    });

    const csvString = csvLines.join('\r\n');
    const buffer = Buffer.from(csvString, 'latin1');

    res.setHeader('Content-Type', 'text/csv; charset=iso-8859-1');
    res.setHeader('Content-Disposition', 'attachment; filename=telemetria_kronox.csv');
    res.send(buffer);
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

    let csv = 'Data/Hora Disparo;Data/Hora Resolução;Nome da Falha/Alarme;CLP de Origem;Criticidade;Status;Medidas Recomendadas\r\n';
    rows.forEach(r => {
      const trigTime = r.trigger_time ? new Date(r.trigger_time).toLocaleString('pt-BR') : '';
      const resTime = r.resolve_time ? new Date(r.resolve_time).toLocaleString('pt-BR') : 'Em Aberto (Ativo)';
      const statusText = r.status === 'ACTIVE' ? 'ATIVO' : 'RESOLVIDO';
      const cleanMeasures = (r.action_measures || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
      csv += `"${trigTime}";"${resTime}";"${(r.name || '').replace(/"/g, '""')}";"${(r.device_name || 'CLP Principal').replace(/"/g, '""')}";"${r.severity || ''}";"${statusText}";"${cleanMeasures}"\r\n`;
    });

    const buffer = Buffer.from(csv, 'latin1');
    res.setHeader('Content-Type', 'text/csv; charset=iso-8859-1');
    res.setHeader('Content-Disposition', 'attachment; filename=historico_falhas_kronox.csv');
    res.send(buffer);
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

// 6. PING UTILITY
app.post('/api/gateway/ping', async (req, res) => {
  try {
    const { host, interface: iface } = req.body;
    const result = await gatewayService.pingHost(host, iface);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// --- APIs e Rotinas de Limpeza de Banco de Dados ---
async function runAutoCleanup() {
  try {
    const dbPath = path.resolve(__dirname, 'kronox.sqlite');
    let freeBytes = Infinity;
    
    // Tentativa de obter espaço livre (somente Node 18+ em Linux/Windows)
    try {
      if (fs.promises && fs.promises.statfs) {
        const stat = await fs.promises.statfs(dbPath);
        freeBytes = stat.bavail * stat.bsize;
      }
    } catch (e) {
      console.warn("[Limpeza] Aviso: não foi possível checar o espaço em disco nativamente.");
    }
    
    const freeMB = freeBytes / (1024 * 1024);
    
    let isEmergency = false;
    let cutoffStr = null;

    if (freeMB < 300) {
      console.log(`[EMERGÊNCIA] Espaço livre crítico (${freeMB.toFixed(2)} MB). Iniciando expurgo emergencial dos 6 meses mais velhos.`);
      isEmergency = true;
      
      const oldestVar = await new Promise(res => db.get('SELECT MIN(timestamp) as min_ts FROM variable_history', [], (err, row) => res(row?.min_ts)));
      if (oldestVar) {
        cutoffStr = `datetime('${oldestVar}', '+6 months')`;
      } else {
        console.log("[Limpeza] Banco vazio, abortando emergência.");
        return { deleted: 0, emergency: true };
      }
    } else {
      const configStr = await new Promise(res => db.get("SELECT value FROM system_settings WHERE key = 'general_config'", [], (err, row) => res(row?.value)));
      if (!configStr) return { deleted: 0, emergency: false };
      
      let config = {};
      try { config = JSON.parse(configStr); } catch(e) {}
      
      if (!config.auto_cleanup_enabled) return { deleted: 0, emergency: false };
      
      const val = parseInt(config.auto_cleanup_value) || 90;
      const unit = config.auto_cleanup_unit || 'days';
      cutoffStr = `datetime('now', 'localtime', '-${val} ${unit}')`;
      console.log(`[Limpeza] Iniciando expurgo automático programado. Corte: ${val} ${unit}.`);
    }

    const tables = ['variable_history', 'alarm_history', 'audit_logs', 'gateway_audit_logs'];
    let totalDeleted = 0;
    
    const deleteBatch = (table) => {
      return new Promise((resolve) => {
        let deletedThisTable = 0;
        
        const loopDelete = () => {
          let timeCol = 'timestamp';
          if (table === 'alarm_history') timeCol = 'trigger_time';
          
          db.run(`DELETE FROM ${table} WHERE id IN (
            SELECT id FROM ${table} WHERE ${timeCol} < ${cutoffStr} ORDER BY ${timeCol} ASC LIMIT 5000
          )`, function(err) {
            if (err) {
              console.error(`Erro ao limpar ${table}: ${err.message}`);
              return resolve(deletedThisTable);
            }
            if (this.changes > 0) {
              deletedThisTable += this.changes;
              setTimeout(loopDelete, 100); // yield event loop to prevent blocking
            } else {
              resolve(deletedThisTable);
            }
          });
        };
        loopDelete();
      });
    };

    for (const tbl of tables) {
      const c = await deleteBatch(tbl);
      totalDeleted += c;
    }

    if (totalDeleted > 0) {
      console.log(`[Limpeza] Concluída. Total de ${totalDeleted} registros removidos. Vácuo em andamento...`);
      db.run('VACUUM');
      logAudit('Sistema', 'LIMPEZA_BANCO', 'Auto Cleanup', '', `Registros apagados: ${totalDeleted} (Emergência: ${isEmergency})`, 'SUCESSO');
    }
    
    return { deleted: totalDeleted, emergency: isEmergency };
  } catch (error) {
    console.error(`[Limpeza] Falha crítica durante rotina de limpeza: ${error.message}`);
    return { error: error.message };
  }
}

// Iniciar cron a cada 24 horas
setInterval(runAutoCleanup, 24 * 60 * 60 * 1000);
// Tentar uma vez ao ligar o server, após 15 segundos para não atrasar o boot
setTimeout(runAutoCleanup, 15000);

app.post('/api/settings/cleanup-now', async (req, res) => {
  const user = req.body.currentUser || { username: 'Admin' };
  try {
    const result = await runAutoCleanup();
    if (result.error) throw new Error(result.error);
    logAudit(user.username, 'LIMPEZA_MANUAL', 'Banco de Dados', '', `Registros apagados: ${result.deleted}`, 'SUCESSO');
    res.json({ success: true, deleted: result.deleted, emergency: result.emergency });
  } catch (err) {
    logAudit(user.username, 'LIMPEZA_MANUAL', 'Banco de Dados', '', `Erro: ${err.message}`, 'FALHA');
    res.status(500).json({ error: err.message });
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
