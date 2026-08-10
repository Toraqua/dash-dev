const { exec } = require('child_process');
const db = require('./db');
const mqtt = require('mqtt');

class GatewayService {
  constructor() {
    this.mqttClient = null;
    this.mqttConnected = false;
    this.mqttBufferProcessing = false;
    this.rollbackTimer = null;
    this.backupConfig = null;
    this.initMqtt();
  }

  // --- AUDIT LOGGER ---
  logAudit(user, category, action, details) {
    const username = user && user.username ? user.username : (typeof user === 'string' ? user : 'Sistema');
    const userId = user && user.id ? user.id : 0;
    db.run(
      `INSERT INTO gateway_audit_logs (user_id, username, category, action, details) VALUES (?, ?, ?, ?, ?)`,
      [userId, username, category, action, typeof details === 'object' ? JSON.stringify(details) : String(details)]
    );
  }

  // --- SYSTEM COMMAND EXECUTION UTILITY ---
  execPromise(cmd) {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, output: stderr || error.message });
        } else {
          resolve({ success: true, output: stdout.trim() });
        }
      });
    });
  }

  // --- NETWORK MANAGEMENT (eth0, wlan0, wlan1) ---
  async getNetworkStatus() {
    return new Promise((resolve) => {
      db.all('SELECT * FROM gateway_network_config', [], async (err, rows) => {
        if (err || !rows) rows = [];
        
        // System interfaces check via nmcli / ip link
        const ipLinkResult = await this.execPromise('ip -j link show || ip link show');
        const nmcliResult = await this.execPromise('nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device || echo ""');

        const systemInterfaces = {};
        if (nmcliResult.success && nmcliResult.output) {
          nmcliResult.output.split('\n').forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 3) {
              systemInterfaces[parts[0]] = { type: parts[1], state: parts[2], conn: parts[3] };
            }
          });
        }

        const interfaces = ['eth0', 'wlan0'].map(iface => {
          const stored = rows.find(r => r.interface === iface) || {
            interface: iface,
            enabled: 1,
            mode: 'dhcp',
            ip_address: '',
            netmask_cidr: '24',
            gateway: '',
            dns: '',
            is_default_route: iface === 'eth0' ? 1 : 0,
            wifi_ssid: '',
            wifi_security: 'wpa2',
            wifi_password: ''
          };

          const sysInfo = systemInterfaces[iface];
          const isPresent = Boolean(sysInfo || true);

          return {
            ...stored,
            present: isPresent,
            connected: isPresent && sysInfo ? sysInfo.state === 'connected' : Boolean(stored.enabled)
          };
        });

        resolve(interfaces);
      });
    });
  }

  async applyNetworkConfig(config, user) {
    return new Promise(async (resolve) => {
      const { interface: iface, enabled, mode, ip_address, netmask_cidr, gateway, dns, is_default_route, wifi_ssid, wifi_security, wifi_password } = config;

      // 1. Store backup config for Anti-Brick rollback
      db.get('SELECT * FROM gateway_network_config WHERE interface = ?', [iface], async (err, oldRow) => {
        this.backupConfig = oldRow || { interface: iface };

        // 2. Save new config to SQLite DB
        db.run(
          `INSERT OR REPLACE INTO gateway_network_config 
           (interface, enabled, mode, ip_address, netmask_cidr, gateway, dns, is_default_route, wifi_ssid, wifi_security, wifi_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [iface, enabled ? 1 : 0, mode, ip_address, netmask_cidr, gateway, dns, is_default_route ? 1 : 0, wifi_ssid, wifi_security, wifi_password],
          async (saveErr) => {
            if (saveErr) {
              return resolve({ success: false, message: 'Erro ao gravar no banco: ' + saveErr.message });
            }

            // If other interface is set as default route, update others
            if (is_default_route) {
              db.run('UPDATE gateway_network_config SET is_default_route = 0 WHERE interface != ?', [iface]);
            }

            this.logAudit(user, 'NETWORK', `UPDATE_INTERFACE_${iface.toUpperCase()}`, config);

            // 3. Execute NetworkManager (nmcli) commands on Linux
            const metric = is_default_route ? 10 : (iface === 'eth0' ? 100 : 200);
            let sysRes = { success: false, output: 'nmcli não executado' };

            // Check if a nmcli connection profile already exists for this interface
            const connListRes = await this.execPromise(`nmcli -t -f NAME,DEVICE connection show`);
            let connName = null;
            if (connListRes.success && connListRes.output) {
              connListRes.output.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length >= 2 && parts[1].trim() === iface) {
                  connName = parts[0].trim();
                }
              });
            }

            if (iface.startsWith('wlan') && wifi_ssid) {
              // Wi-Fi: connect to SSID
              const wifiCmd = `nmcli dev wifi connect "${wifi_ssid}" password "${wifi_password || ''}" ifname ${iface}`;
              sysRes = await this.execPromise(wifiCmd);
              // After connecting, set IP if static
              if (sysRes.success && mode === 'static' && ip_address) {
                await this.execPromise(`nmcli connection modify "${wifi_ssid}" ipv4.method manual ipv4.addresses ${ip_address}/${netmask_cidr || 24} ipv4.gateway "${gateway || ''}" ipv4.dns "${dns || '8.8.8.8'}" ipv4.route-metric ${metric}`);
                await this.execPromise(`nmcli connection up "${wifi_ssid}"`);
              } else if (sysRes.success && mode === 'dhcp') {
                await this.execPromise(`nmcli connection modify "${wifi_ssid}" ipv4.method auto ipv4.route-metric ${metric}`);
                await this.execPromise(`nmcli connection up "${wifi_ssid}"`);
              }
            } else if (connName) {
              // Connection profile exists — modify it
              if (mode === 'static' && ip_address) {
                sysRes = await this.execPromise(
                  `nmcli connection modify "${connName}" ipv4.method manual ipv4.addresses ${ip_address}/${netmask_cidr || 24} ipv4.gateway "${gateway || ''}" ipv4.dns "${dns || '8.8.8.8'}" ipv4.route-metric ${metric} && nmcli connection up "${connName}"`
                );
              } else {
                sysRes = await this.execPromise(
                  `nmcli connection modify "${connName}" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" ipv4.route-metric ${metric} && nmcli connection up "${connName}"`
                );
              }
            } else {
              // No connection profile exists — create one
              const connType = iface.startsWith('wlan') ? 'wifi' : 'ethernet';
              if (mode === 'static' && ip_address) {
                sysRes = await this.execPromise(
                  `nmcli connection add type ${connType} ifname ${iface} con-name ${iface} ipv4.method manual ipv4.addresses ${ip_address}/${netmask_cidr || 24} ipv4.gateway "${gateway || ''}" ipv4.dns "${dns || '8.8.8.8'}" ipv4.route-metric ${metric} && nmcli connection up ${iface}`
                );
              } else {
                sysRes = await this.execPromise(
                  `nmcli connection add type ${connType} ifname ${iface} con-name ${iface} ipv4.method auto ipv4.route-metric ${metric} && nmcli connection up ${iface}`
                );
              }
            }

            // Start 60s Anti-Brick rollback timer
            if (this.rollbackTimer) clearTimeout(this.rollbackTimer);
            this.rollbackTimer = setTimeout(() => {
              console.warn(`[Anti-Brick] Temporizador de 60s expirado sem confirmação! Revertendo interface ${iface}...`);
              this.rollbackNetworkConfig();
            }, 60000);

            resolve({
              success: true,
              message: 'Configuração aplicada com sucesso. Temporizador de segurança (60s) ativado.',
              sysOutput: sysRes.output,
              requiresConfirmation: true
            });
          }
        );
      });
    });
  }

  confirmNetworkConfig(user) {
    if (this.rollbackTimer) {
      clearTimeout(this.rollbackTimer);
      this.rollbackTimer = null;
      this.backupConfig = null;
      this.logAudit(user, 'NETWORK', 'CONFIRM_SAFE_MODE', 'Conexão confirmada pelo usuário.');
      return { success: true, message: 'Configuração de rede confirmada e mantida!' };
    }
    return { success: true, message: 'Nenhuma alteração pendente de confirmação.' };
  }

  async rollbackNetworkConfig() {
    if (this.backupConfig) {
      const cfg = this.backupConfig;
      db.run(
        `INSERT OR REPLACE INTO gateway_network_config 
         (interface, enabled, mode, ip_address, netmask_cidr, gateway, dns, is_default_route, wifi_ssid, wifi_security, wifi_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cfg.interface, cfg.enabled, cfg.mode, cfg.ip_address, cfg.netmask_cidr, cfg.gateway, cfg.dns, cfg.is_default_route, cfg.wifi_ssid, cfg.wifi_security, cfg.wifi_password]
      );
      this.backupConfig = null;
      if (this.rollbackTimer) {
        clearTimeout(this.rollbackTimer);
        this.rollbackTimer = null;
      }
      this.logAudit('Sistema', 'NETWORK', 'ROLLBACK_AUTO', 'Configuração revertida por falta de confirmação.');
    }
  }

  // --- STATIC ROUTES (PERSISTENT ACROSS REBOOTS) ---
  getRoutes() {
    return new Promise((resolve) => {
      db.all('SELECT * FROM gateway_routes ORDER BY id ASC', [], (err, rows) => {
        resolve(rows || []);
      });
    });
  }

  async addRoute(route, user) {
    return new Promise((resolve) => {
      const { destination, netmask_cidr, gateway, interface: iface, metric } = route;
      db.run(
        `INSERT INTO gateway_routes (destination, netmask_cidr, gateway, interface, metric, persistent) VALUES (?, ?, ?, ?, ?, 1)`,
        [destination, netmask_cidr || '24', gateway, iface || 'eth0', metric || 100],
        async function (err) {
          if (err) return resolve({ success: false, message: err.message });
          
          // Apply to system via ip route & nmcli for persistence
          const cmd = `ip route add ${destination}/${netmask_cidr || 24} via ${gateway} dev ${iface || 'eth0'} metric ${metric || 100} || true`;
          const nmCmd = `nmcli connection modify ${iface || 'eth0'} +ipv4.routes "${destination}/${netmask_cidr || 24} ${gateway} ${metric || 100}" || true`;
          
          const gw = new GatewayService();
          await gw.execPromise(cmd);
          await gw.execPromise(nmCmd);

          gw.logAudit(user, 'NETWORK', 'ADD_STATIC_ROUTE', route);
          resolve({ success: true, id: this.lastID });
        }
      );
    });
  }

  async deleteRoute(id, user) {
    return new Promise((resolve) => {
      db.get('SELECT * FROM gateway_routes WHERE id = ?', [id], async (err, route) => {
        if (!route) return resolve({ success: false, message: 'Rota não encontrada' });
        
        db.run('DELETE FROM gateway_routes WHERE id = ?', [id], async () => {
          const cmd = `ip route del ${route.destination}/${route.netmask_cidr} via ${route.gateway} dev ${route.interface} || true`;
          const nmCmd = `nmcli connection modify ${route.interface} -ipv4.routes "${route.destination}/${route.netmask_cidr} ${route.gateway}" || true`;
          
          await this.execPromise(cmd);
          await this.execPromise(nmCmd);

          this.logAudit(user, 'NETWORK', 'DELETE_STATIC_ROUTE', route);
          resolve({ success: true });
        });
      });
    });
  }

  // --- NETBIRD VPN SERVICE ---
  async getVpnStatus() {
    const checkCli = await this.execPromise('netbird version || /usr/bin/netbird version || /usr/local/bin/netbird version || netbird --version');
    const installed = checkCli.success;

    // Check system interface wt0 or netbird0 directly via ip addr for 100.64.X.X
    const ipRes = await this.execPromise('ip -4 addr show dev wt0 || ip -4 addr show dev netbird0 || ip addr show');
    let interfaceIp = '-';
    if (ipRes.success && ipRes.output) {
      const match = ipRes.output.match(/inet\s+(100\.[0-9]+\.[0-9]+\.[0-9]+)/i);
      if (match) interfaceIp = match[1];
    }

    if (!installed && interfaceIp === '-') {
      return {
        installed: false,
        connected: false,
        statusText: 'Netbird CLI não detectado',
        ip: '-',
        peersCount: 0
      };
    }

    const statusRes = await this.execPromise('netbird status --json || /usr/bin/netbird status --json || netbird status || /usr/bin/netbird status');
    let connected = false;
    let virtualIp = interfaceIp !== '-' ? interfaceIp : '-';
    let peers = 0;

    if (statusRes.success) {
      try {
        const json = JSON.parse(statusRes.output);
        connected = json.managementProtocolStatus === 'Connected' || json.status === 'Connected' || Boolean(json.ip) || interfaceIp !== '-';
        if (json.ip) virtualIp = json.ip.split('/')[0];
        else if (json.netbirdIp) virtualIp = json.netbirdIp.split('/')[0];
        peers = json.peers ? json.peers.length : (json.peersDetails ? json.peersDetails.length : 0);
      } catch (e) {
        connected = statusRes.output.toLowerCase().includes('connected') || interfaceIp !== '-';
        const ipMatch = statusRes.output.match(/(?:NetBird IP|IP):\s*([0-9\.]+)/i) || statusRes.output.match(/(100\.[0-9]+\.[0-9]+\.[0-9]+)/);
        if (ipMatch && virtualIp === '-') virtualIp = ipMatch[1];
        const peersMatch = statusRes.output.match(/Peers count:\s*([0-9]+)/i) || statusRes.output.match(/([0-9]+)\s*\/\s*[0-9]+\s*connected/i);
        if (peersMatch) peers = parseInt(peersMatch[1]);
      }
    } else if (interfaceIp !== '-') {
      connected = true;
      virtualIp = interfaceIp;
    }

    return {
      installed: true,
      connected,
      statusText: connected ? 'Conectado' : 'Desconectado',
      ip: virtualIp,
      peersCount: peers,
      rawOutput: statusRes.output
    };
  }

  async connectVpn(setupKey, user) {
    const cmd = setupKey ? `netbird up --setup-key "${setupKey}"` : 'netbird up';
    const res = await this.execPromise(cmd);
    this.logAudit(user, 'VPN', 'CONNECT_NETBIRD', { success: res.success, output: res.output });
    return res;
  }

  async disconnectVpn(user) {
    const res = await this.execPromise('netbird down');
    this.logAudit(user, 'VPN', 'DISCONNECT_NETBIRD', { success: res.success, output: res.output });
    return res;
  }

  // --- MQTT PUBLISHER & LOCAL BUFFER ---
  async getMqttConfig() {
    return new Promise((resolve) => {
      db.get('SELECT * FROM gateway_mqtt_config WHERE id = 1', [], (err, row) => {
        resolve(row || {
          host: 'broker.hivemq.com',
          port: 1883,
          client_id: 'kronox-gw-01',
          username: '',
          password: '',
          keep_alive: 60,
          use_ssl: 0,
          clean_session: 1,
          last_will_topic: '',
          last_will_qos: 0,
          last_will_retain: 0,
          last_will_message: '',
          publish_topic: 'kronox/telemetry/state',
          publish_interval_seconds: 5,
          json_template: '{\n  "data": {\n    "corrente": {{corrente}},\n    "level": {{level}},\n    "pump1": {{pump1}}\n  }\n}'
        });
      });
    });
  }

  async saveMqttConfig(config, user) {
    return new Promise((resolve) => {
      db.run(
        `INSERT OR REPLACE INTO gateway_mqtt_config 
         (id, host, port, client_id, username, password, keep_alive, use_ssl, clean_session, last_will_topic, last_will_qos, last_will_retain, last_will_message, publish_topic, publish_interval_seconds, json_template)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          config.host, config.port || 1883, config.client_id || 'kronox-gw-01', config.username || '', config.password || '',
          config.keep_alive || 60, config.use_ssl ? 1 : 0, config.clean_session ? 1 : 0,
          config.last_will_topic || '', config.last_will_qos || 0, config.last_will_retain ? 1 : 0, config.last_will_message || '',
          config.publish_topic || 'kronox/telemetry/state', config.publish_interval_seconds || 5, config.json_template || ''
        ],
        (err) => {
          if (err) return resolve({ success: false, message: err.message });
          this.logAudit(user, 'MQTT', 'SAVE_CONFIG', { host: config.host, port: config.port, topic: config.publish_topic });
          this.initMqtt();
          resolve({ success: true });
        }
      );
    });
  }

  testMqttConnection(config) {
    return new Promise((resolve) => {
      const protocol = config.use_ssl ? 'mqtts' : 'mqtt';
      const url = `${protocol}://${config.host}:${config.port || 1883}`;
      
      const client = mqtt.connect(url, {
        clientId: 'kronox-test-' + Math.random().toString(16).substring(2, 8),
        username: config.username || undefined,
        password: config.password || undefined,
        connectTimeout: 5000,
        rejectUnauthorized: false
      });

      let done = false;
      client.on('connect', () => {
        if (!done) {
          done = true;
          client.end();
          resolve({ success: true, message: 'Conexão com Broker MQTT testada com sucesso!' });
        }
      });

      client.on('error', (err) => {
        if (!done) {
          done = true;
          client.end();
          resolve({ success: false, message: 'Falha na conexão MQTT: ' + err.message });
        }
      });

      setTimeout(() => {
        if (!done) {
          done = true;
          client.end();
          resolve({ success: false, message: 'Tempo limite esgotado ao conectar ao Broker MQTT (5s).' });
        }
      }, 6000);
    });
  }

  async initMqtt() {
    if (this.mqttClient) {
      try { this.mqttClient.end(); } catch(e) {}
      this.mqttClient = null;
    }

    const cfg = await this.getMqttConfig();
    if (!cfg.host) return;

    const protocol = cfg.use_ssl ? 'mqtts' : 'mqtt';
    const url = `${protocol}://${cfg.host}:${cfg.port}`;

    const opts = {
      clientId: cfg.client_id || 'kronox-gw-01',
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      keepalive: cfg.keep_alive || 60,
      clean: Boolean(cfg.clean_session),
      reconnectPeriod: 5000,
      rejectUnauthorized: false
    };

    if (cfg.last_will_topic) {
      opts.will = {
        topic: cfg.last_will_topic,
        payload: cfg.last_will_message || 'offline',
        qos: cfg.last_will_qos || 0,
        retain: Boolean(cfg.last_will_retain)
      };
    }

    try {
      this.mqttClient = mqtt.connect(url, opts);

      this.mqttClient.on('connect', () => {
        this.mqttConnected = true;
        console.log(`[MQTT Gateway] Conectado com sucesso ao broker ${url}`);
        this.processMqttBuffer();
      });

      this.mqttClient.on('offline', () => {
        this.mqttConnected = false;
      });

      this.mqttClient.on('error', (err) => {
        this.mqttConnected = false;
        console.warn(`[MQTT Gateway Warning] ${err.message}`);
      });
    } catch(e) {
      console.error('[MQTT Gateway Error]', e);
    }
  }

  async publishTelemetry(plcState) {
    const cfg = await this.getMqttConfig();
    if (!cfg.publish_topic || !cfg.json_template) return;

    // Substitute {{variable_name}} placeholders with live plcState values
    let payloadStr = cfg.json_template;
    Object.keys(plcState).forEach(key => {
      const val = plcState[key];
      const jsonVal = typeof val === 'number' || typeof val === 'boolean' ? val : `"${val}"`;
      payloadStr = payloadStr.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), jsonVal);
    });

    // Replace any remaining unmapped {{...}} placeholders with null
    payloadStr = payloadStr.replace(/{{\s*[\w_]+\s*}}/g, 'null');

    if (this.mqttConnected && this.mqttClient) {
      this.mqttClient.publish(cfg.publish_topic, payloadStr, { qos: 0 });
    } else {
      // Buffer locally in SQLite to prevent data loss
      db.run(`INSERT INTO gateway_mqtt_buffer (topic, payload) VALUES (?, ?)`, [cfg.publish_topic, payloadStr]);
    }
  }

  async processMqttBuffer() {
    if (this.mqttBufferProcessing || !this.mqttConnected || !this.mqttClient) return;
    this.mqttBufferProcessing = true;

    db.all('SELECT * FROM gateway_mqtt_buffer ORDER BY id ASC LIMIT 100', [], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        this.mqttBufferProcessing = false;
        return;
      }

      rows.forEach(row => {
        this.mqttClient.publish(row.topic, row.payload, { qos: 0 });
      });

      const ids = rows.map(r => r.id);
      db.run(`DELETE FROM gateway_mqtt_buffer WHERE id IN (${ids.join(',')})`, () => {
        this.mqttBufferProcessing = false;
        if (rows.length >= 100) {
          setTimeout(() => this.processMqttBuffer(), 1000);
        }
      });
    });
  }

  getAuditLogs() {
    return new Promise((resolve) => {
      db.all('SELECT * FROM gateway_audit_logs ORDER BY id DESC LIMIT 100', [], (err, rows) => {
        resolve(rows || []);
      });
    });
  }

  // --- PING UTILITY ---
  async pingHost(host) {
    if (!host || !/^[a-zA-Z0-9._\-]+$/.test(host)) {
      return { success: false, output: 'Host inválido ou não especificado.' };
    }
    // Use ping -c 4 on Linux, ping -n 4 on Windows (fallback)
    const isWindows = process.platform === 'win32';
    const cmd = isWindows
      ? `ping -n 4 ${host}`
      : `ping -c 4 -W 2 ${host}`;
    const res = await this.execPromise(cmd);
    return {
      success: res.success,
      host,
      output: res.output || 'Sem saída do comando ping.',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new GatewayService();
