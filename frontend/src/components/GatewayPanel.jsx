import React, { useState, useEffect } from 'react';
import { Network, Wifi, Globe, Shield, Server, Cpu, Lock, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Save, Plus, Trash2, Download, Upload, Eye, EyeOff, Radio, Activity, ArrowUpRight, Clock, HelpCircle, HardDrive, Zap, Search } from 'lucide-react';

function GatewayPanel({ currentUser, variables = [], generalConfig = {}, onRefresh }) {
  const [activeSubTab, setActiveSubTab] = useState('eth0');
  const [networkConfigs, setNetworkConfigs] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vpnStatus, setVpnStatus] = useState({ installed: true, connected: false, ip: '-', peersCount: 0 });
  const [vpnSetupKey, setVpnSetupKey] = useState('');
  const [mqttConfig, setMqttConfig] = useState({
    host: 'broker.hivemq.com',
    port: 1883,
    client_id: 'kronox-gw-01',
    username: '',
    password: '',
    keep_alive: 60,
    use_ssl: false,
    clean_session: true,
    last_will_topic: '',
    last_will_qos: 0,
    last_will_retain: false,
    last_will_message: '',
    publish_topic: 'kronox/telemetry/state',
    publish_interval_seconds: 5,
    json_template: '{\n  "data": {\n    "corrente": {{corrente}},\n    "level": {{level}},\n    "pump1": {{pump1}}\n  }\n}'
  });
  const [mqttStatus, setMqttStatus] = useState('disconnected');
  const [auditLogs, setAuditLogs] = useState([]);

  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showMqttPassword, setShowMqttPassword] = useState(false);

  // Ping state
  const [pingHost, setPingHost] = useState('');
  const [pingInterface, setPingInterface] = useState('auto');
  const [pingLoading, setPingLoading] = useState(false);
  const [pingResult, setPingResult] = useState(null);
  const [pingHistory, setPingHistory] = useState([]);

  // Anti-Brick Safe Mode Modal
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [rollbackCountdown, setRollbackCountdown] = useState(60);

  // New Static Route Form
  const [newRoute, setNewRoute] = useState({
    destination: '',
    netmask_cidr: '24',
    gateway: '',
    interface: 'eth0',
    metric: 100
  });

  const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      if (window.location.port === '5173') return '';
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
    }
    return 'http://localhost:3001';
  };

  const showNotify = (msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handlePing = async () => {
    if (!pingHost.trim()) return showNotify('Digite um IP ou hostname para pingar.', 'error');
    setPingLoading(true);
    setPingResult(null);
    try {
      const res = await fetch(getBaseUrl() + '/api/gateway/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: pingHost.trim(),
          interface: pingInterface !== 'auto' ? pingInterface : undefined
        })
      });
      const data = await res.json();
      setPingResult(data);
      setPingHistory(prev => [{ ...data, id: Date.now() }, ...prev].slice(0, 20));
    } catch(e) {
      setPingResult({ success: false, output: 'Erro de conexão com o backend.', host: pingHost, timestamp: new Date().toISOString() });
    } finally {
      setPingLoading(false);
    }
  };

  const fetchGatewayData = async () => {
    setLoading(true);
    try {
      const [netRes, routeRes, vpnRes, mqttRes, auditRes] = await Promise.all([
        fetch(getBaseUrl() + '/api/gateway/network').then(r => r.json()),
        fetch(getBaseUrl() + '/api/gateway/routes').then(r => r.json()),
        fetch(getBaseUrl() + '/api/gateway/vpn').then(r => r.json()),
        fetch(getBaseUrl() + '/api/gateway/mqtt').then(r => r.json()),
        fetch(getBaseUrl() + '/api/gateway/audit').then(r => r.json())
      ]);

      if (Array.isArray(netRes)) setNetworkConfigs(netRes);
      if (Array.isArray(routeRes)) setRoutes(routeRes);
      if (vpnRes) setVpnStatus(vpnRes);
      if (mqttRes) {
        setMqttConfig({
          ...mqttRes,
          use_ssl: Boolean(mqttRes.use_ssl),
          clean_session: Boolean(mqttRes.clean_session),
          last_will_retain: Boolean(mqttRes.last_will_retain)
        });
      }
      if (Array.isArray(auditRes)) setAuditLogs(auditRes);
    } catch(e) {
      console.error('Erro ao carregar dados do Gateway:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGatewayData();
  }, []);

  // Anti-Brick Countdown Effect
  useEffect(() => {
    let interval;
    if (showRollbackModal && rollbackCountdown > 0) {
      interval = setInterval(() => {
        setRollbackCountdown(prev => prev - 1);
      }, 1000);
    } else if (rollbackCountdown === 0 && showRollbackModal) {
      setShowRollbackModal(false);
      showNotify('Tempo esgotado! A alteração de IP foi revertida por segurança.', 'error');
    }
    return () => clearInterval(interval);
  }, [showRollbackModal, rollbackCountdown]);

  // Admin Access Restriction Guard
  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="card" style={{ maxWidth: '500px', margin: '4rem auto', padding: '2.5rem', textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px' }}>
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
          <Lock size={32} color="var(--color-danger)" />
        </div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>Acesso Restrito ao Gateway</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.5' }}>
          O menu de gerenciamento de **Rede, VPN e MQTT** é exclusivo para usuários com perfil de **Administrador**.
        </p>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', background: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '6px' }}>
          Usuário atual: <strong>{currentUser ? currentUser.username : 'Convidado (Operador)'}</strong>
        </span>
      </div>
    );
  }

  const currentNetConfig = networkConfigs.find(c => c.interface === activeSubTab) || {
    interface: activeSubTab,
    enabled: 1,
    mode: 'dhcp',
    ip_address: '',
    netmask_cidr: '24',
    gateway: '',
    dns: '',
    is_default_route: activeSubTab === 'eth0' ? 1 : 0,
    route_metric: activeSubTab === 'eth0' ? 100 : 200,
    wifi_ssid: '',
    wifi_security: 'wpa2',
    wifi_password: '',
    present: true
  };

  const handleUpdateNetConfig = (field, val) => {
    setNetworkConfigs(prev => {
      const idx = prev.findIndex(c => c.interface === activeSubTab);
      const updated = { ...currentNetConfig, [field]: val };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy;
      }
      return [...prev, updated];
    });
  };

  const handleSaveNetwork = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/gateway/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentNetConfig, currentUser })
      });
      const data = await res.json();
      if (data.success) {
        showNotify(data.message, 'success');
        setRollbackCountdown(60);
        setShowRollbackModal(true);
      } else {
        showNotify('Erro ao aplicar rede: ' + data.message, 'error');
      }
    } catch(e) {
      showNotify('Erro de conexão ao salvar rede', 'error');
    }
  };

  const handleConfirmRollback = async () => {
    try {
      await fetch(getBaseUrl() + '/api/gateway/network/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentUser })
      });
      setShowRollbackModal(false);
      showNotify('Conexão de rede confirmada e salva permanentemente!', 'success');
    } catch(e) {
      showNotify('Erro ao confirmar rede', 'error');
    }
  };

  const handleAddRoute = async () => {
    if (!newRoute.destination || !newRoute.gateway) {
      return showNotify('Preencha os campos de Destino e Gateway.', 'error');
    }
    try {
      const res = await fetch(getBaseUrl() + '/api/gateway/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRoute, currentUser })
      });
      const data = await res.json();
      if (data.success) {
        showNotify('Rota estática persistente adicionada!', 'success');
        setNewRoute({ destination: '', netmask_cidr: '24', gateway: '', interface: 'eth0', metric: 100 });
        fetchGatewayData();
      }
    } catch(e) {
      showNotify('Erro ao adicionar rota estática', 'error');
    }
  };

  const handleDeleteRoute = async (id) => {
    try {
      const res = await fetch(getBaseUrl() + `/api/gateway/routes/${id}?username=${currentUser.username}`, { method: 'DELETE' });
      if (res.ok) {
        showNotify('Rota removida!', 'success');
        fetchGatewayData();
      }
    } catch(e) {
      showNotify('Erro ao remover rota', 'error');
    }
  };

  const handleConnectVpn = async () => {
    showNotify('Iniciando conexão VPN Netbird...', 'info');
    try {
      const res = await fetch(getBaseUrl() + '/api/gateway/vpn/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupKey: vpnSetupKey, currentUser })
      });
      const data = await res.json();
      if (data.success) {
        showNotify('Comando enviado ao Netbird!', 'success');
        setTimeout(fetchGatewayData, 3000);
      }
    } catch(e) {
      showNotify('Erro ao conectar VPN', 'error');
    }
  };

  const handleDisconnectVpn = async () => {
    try {
      await fetch(getBaseUrl() + '/api/gateway/vpn/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentUser })
      });
      showNotify('Desconectando VPN Netbird...', 'info');
      setTimeout(fetchGatewayData, 2000);
    } catch(e) {
      showNotify('Erro ao desconectar VPN', 'error');
    }
  };

  const handleTestMqtt = async () => {
    showNotify('Testando conexão com Broker MQTT...', 'info');
    try {
      const res = await fetch(getBaseUrl() + '/api/gateway/mqtt/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mqttConfig)
      });
      const data = await res.json();
      if (data.success) {
        setMqttStatus('connected');
        showNotify(data.message, 'success');
      } else {
        setMqttStatus('disconnected');
        showNotify(data.message, 'error');
      }
    } catch(e) {
      showNotify('Erro ao testar Broker MQTT', 'error');
    }
  };

  const handleSaveMqtt = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/gateway/mqtt/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mqttConfig, currentUser })
      });
      const data = await res.json();
      if (data.success) {
        showNotify('Configuração do Broker MQTT salva com sucesso!', 'success');
      }
    } catch(e) {
      showNotify('Erro ao salvar configuração MQTT', 'error');
    }
  };

  // Export & Import MQTT JSON Mapping Format
  const handleExportMqttJSON = () => {
    const exportData = {
      version: '1.0',
      system: generalConfig.system_name || 'KRONOX',
      export_date: new Date().toISOString(),
      mqtt_topic: mqttConfig.publish_topic,
      publish_interval_seconds: mqttConfig.publish_interval_seconds,
      json_template: mqttConfig.json_template
    };
    const str = JSON.stringify(exportData, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kronox_mqtt_mapping_v1.0.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportMqttJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.json_template) {
          setMqttConfig(prev => ({
            ...prev,
            publish_topic: imported.mqtt_topic || prev.publish_topic,
            publish_interval_seconds: imported.publish_interval_seconds || prev.publish_interval_seconds,
            json_template: imported.json_template
          }));
          showNotify('Mapeamento JSON importado com sucesso (Versão ' + (imported.version || '1.0') + ')!', 'success');
        }
      } catch(err) {
        showNotify('Arquivo JSON de mapeamento inválido.', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Live JSON Preview computation
  const computeJsonPreview = () => {
    try {
      let preview = mqttConfig.json_template || '';
      variables.forEach(v => {
        const mockVal = v.type === 'analog' ? (v.decimals > 0 ? 54.95 : 87) : 1;
        preview = preview.replace(new RegExp(`{{\\s*${v.name}\\s*}}`, 'g'), mockVal);
      });
      preview = preview.replace(/{{\s*[\w_]+\s*}}/g, '100');
      return JSON.stringify(JSON.parse(preview), null, 2);
    } catch(e) {
      return '// Exemplo com erro de sintaxe JSON';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* Top Banner Notification */}
      {notification && (
        <div style={{
          padding: '0.75rem 1.25rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600,
          background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : notification.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
          border: `1px solid ${notification.type === 'success' ? 'var(--color-success)' : notification.type === 'error' ? 'var(--color-danger)' : 'var(--color-primary)'}`,
          color: notification.type === 'success' ? '#4ade80' : notification.type === 'error' ? '#f87171' : '#60a5fa',
          display: 'flex', alignItems: 'center', gap: '0.5rem'
        }}>
          {notification.type === 'success' ? <CheckCircle2 size={18} /> : notification.type === 'error' ? <XCircle size={18} /> : <Activity size={18} />}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Sub-Header Navigation Icons Bar (Matching Screenshot 3) */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { id: 'eth0', label: 'Ethernet 0', icon: HardDrive },
          { id: 'wlan0', label: 'Wi-Fi (wlan0)', icon: Wifi },
          { id: 'routes', label: 'Rotas Estáticas', icon: Network },
          { id: 'vpn', label: 'VPN Netbird', icon: Shield },
          { id: 'mqtt', label: 'Broker MQTT', icon: Server },
          { id: 'ping', label: 'Ping', icon: Activity },
          { id: 'audit', label: 'Auditoria', icon: Clock }
        ].map(item => {
          const IconComponent = item.icon;
          const isActive = activeSubTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSubTab(item.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '1rem 1.25rem', borderRadius: '12px', minWidth: '110px', flex: 1,
                background: isActive ? 'var(--color-primary)' : 'var(--bg-card)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--border-color)'}`,
                cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: isActive ? '0 4px 12px rgba(59,130,246,0.3)' : 'none'
              }}
            >
              <IconComponent size={24} style={{ marginBottom: '0.4rem' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* --- SUB-PANEL: ETHERNET & WI-FI (eth0, wlan0) --- */}
      {(activeSubTab === 'eth0' || activeSubTab === 'wlan0') && (
        <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          {/* Header & Enabled Toggle (Matching Screenshot 1) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {activeSubTab.startsWith('wlan') ? <Wifi size={24} color="var(--color-primary)" /> : <HardDrive size={24} color="var(--color-primary)" />}
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
                  Configuração de Rede: {activeSubTab === 'eth0' ? 'Ethernet (eth0)' : 'Wi-Fi (wlan0)'}
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Raspberry Pi OS 64-bit (NetworkManager / nmcli)</span>
              </div>
            </div>

            {/* iOS Switch: Enabled */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: currentNetConfig.enabled ? 'var(--color-success)' : 'var(--text-muted)' }}>
                {currentNetConfig.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <label className="ios-switch">
                <input
                  type="checkbox"
                  checked={Boolean(currentNetConfig.enabled)}
                  onChange={e => handleUpdateNetConfig('enabled', e.target.checked ? 1 : 0)}
                />
                <span className="ios-slider"></span>
              </label>
            </div>
          </div>


          {/* Mode Selector Radio (Static Settings vs DHCP) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginBottom: '1.5rem', background: 'var(--bg-subcard)', padding: '0.75rem 1rem', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Modo de Configuração:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name={`mode-${activeSubTab}`}
                value="static"
                checked={currentNetConfig.mode === 'static'}
                onChange={() => handleUpdateNetConfig('mode', 'static')}
              />
              <span>Static Settings (IP Fixo)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name={`mode-${activeSubTab}`}
                value="dhcp"
                checked={currentNetConfig.mode === 'dhcp'}
                onChange={() => handleUpdateNetConfig('mode', 'dhcp')}
              />
              <span>DHCP (Automático)</span>
            </label>
          </div>

          {/* Wi-Fi Credentials Section (If wlan0 or wlan1) */}
          {activeSubTab.startsWith('wlan') && (
            <div style={{ background: 'var(--bg-subcard)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Wifi size={16} /> Credenciais da Rede Wi-Fi
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '1rem', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Nome da Rede (SSID)</label>
                  <input type="text" className="form-input" placeholder="ex: KRONOX_WIFI_ELEVATORIA" value={currentNetConfig.wifi_ssid || ''} onChange={e => handleUpdateNetConfig('wifi_ssid', e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Segurança</label>
                  <select className="form-input" value={currentNetConfig.wifi_security || 'wpa2'} onChange={e => handleUpdateNetConfig('wifi_security', e.target.value)}>
                    <option value="wpa2">WPA2 / WPA3 Personal</option>
                    <option value="open">Aberta (Open)</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
                  <label className="form-label">Senha</label>
                  <input type={showPassword ? 'text' : 'password'} className="form-input" placeholder="••••••••" value={currentNetConfig.wifi_password || ''} onChange={e => handleUpdateNetConfig('wifi_password', e.target.value)} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '10px', top: '32px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Static Settings Inputs (IP, CIDR, Gateway, DNS) */}
          <div style={{ opacity: currentNetConfig.mode === 'static' ? 1 : 0.4, pointerEvents: currentNetConfig.mode === 'static' ? 'auto' : 'none', transition: 'all 0.2s ease', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Globe size={14} /> Endereço IP (IP Address)
                </label>
                <input type="text" className="form-input" placeholder="192.168.1.100" value={currentNetConfig.ip_address || ''} onChange={e => handleUpdateNetConfig('ip_address', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Network size={14} /> Máscara de Rede - CIDR (Netmask)
                </label>
                <input type="text" className="form-input" placeholder="24 (ou 255.255.255.0)" value={currentNetConfig.netmask_cidr || '24'} onChange={e => handleUpdateNetConfig('netmask_cidr', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Server size={14} /> Gateway Padrão
                </label>
                <input type="text" className="form-input" placeholder="192.168.1.1" value={currentNetConfig.gateway || ''} onChange={e => handleUpdateNetConfig('gateway', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Cpu size={14} /> Servidores DNS
                </label>
                <input type="text" className="form-input" placeholder="8.8.8.8, 1.1.1.1" value={currentNetConfig.dns || ''} onChange={e => handleUpdateNetConfig('dns', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Default Route + Metric Section */}
          <div style={{ marginBottom: '1rem', background: 'var(--bg-subcard)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(currentNetConfig.is_default_route)}
                    onChange={e => handleUpdateNetConfig('is_default_route', e.target.checked ? 1 : 0)}
                  />
                  <span className="ios-slider"></span>
                </label>
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Rota Padrão para Internet</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    Ambas as interfaces podem ter rota padrão simultânea — a métrica define a prioridade
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', align: 'center', gap: '0.75rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Métrica (prioridade) — menor = maior prioridade
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="number"
                      min="1"
                      max="9999"
                      className="form-input"
                      style={{ width: '100px', textAlign: 'center', fontSize: '1rem', fontWeight: 600 }}
                      value={currentNetConfig.route_metric || (activeSubTab === 'eth0' ? 100 : 200)}
                      onChange={e => handleUpdateNetConfig('route_metric', parseInt(e.target.value) || 100)}
                      disabled={!currentNetConfig.is_default_route}
                    />
                    <span style={{
                      padding: '0.3rem 0.7rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600,
                      background: !currentNetConfig.is_default_route ? 'rgba(100,116,139,0.15)' : (currentNetConfig.route_metric || 999) <= 100 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                      color: !currentNetConfig.is_default_route ? 'var(--text-muted)' : (currentNetConfig.route_metric || 999) <= 100 ? '#10b981' : '#f59e0b',
                      border: `1px solid ${!currentNetConfig.is_default_route ? 'var(--border-color)' : (currentNetConfig.route_metric || 999) <= 100 ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}`,
                      whiteSpace: 'nowrap'
                    }}>
                      {!currentNetConfig.is_default_route ? 'Desativada' : (currentNetConfig.route_metric || 999) <= 100 ? '⬆ Alta Prioridade' : '⬇ Baixa Prioridade'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
            <button className="btn" onClick={fetchGatewayData} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
              <RefreshCw size={15} /> Recarregar do Sistema
            </button>
            <button className="btn btn-primary" onClick={handleSaveNetwork}>
              <Save size={16} /> Salvar & Aplicar
            </button>
          </div>
        </div>
      )}

      {/* --- SUB-PANEL: ROTAS ESTÁTICAS (PERSISTENTES) --- */}
      {activeSubTab === 'routes' && (
        <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Network size={20} color="var(--color-primary)" /> Gerenciamento de Rotas Estáticas Persistentes
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            As rotas estáticas adicionadas abaixo são salvas no banco de dados e gravadas no sistema Linux via `nmcli` / `ip route`, **garantindo persistência após a reinicialização do Raspberry Pi**.
          </p>

          {/* Form to Add Static Route */}
          <div style={{ background: 'var(--bg-subcard)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '2fr 1fr 2fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Destino (IP Subrede)</label>
              <input type="text" className="form-input" placeholder="10.0.0.0" value={newRoute.destination} onChange={e => setNewRoute({...newRoute, destination: e.target.value})} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">CIDR</label>
              <input type="text" className="form-input" placeholder="24" value={newRoute.netmask_cidr} onChange={e => setNewRoute({...newRoute, netmask_cidr: e.target.value})} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Gateway IP</label>
              <input type="text" className="form-input" placeholder="192.168.1.1" value={newRoute.gateway} onChange={e => setNewRoute({...newRoute, gateway: e.target.value})} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Interface</label>
              <select className="form-input" value={newRoute.interface} onChange={e => setNewRoute({...newRoute, interface: e.target.value})}>
                <option value="eth0">eth0</option>
                <option value="wlan0">wlan0</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Métrica</label>
              <input type="number" className="form-input" value={newRoute.metric} onChange={e => setNewRoute({...newRoute, metric: parseInt(e.target.value)})} />
            </div>
            <button className="btn btn-primary" onClick={handleAddRoute}>
              <Plus size={16} /> Adicionar
            </button>
          </div>

          {/* Static Routes Table */}
          <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.6rem 1rem' }}>Rede de Destino</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Gateway</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Interface</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Métrica</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Status Persistência</th>
                  <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {routes.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{r.destination}/{r.netmask_cidr}</td>
                    <td style={{ padding: '0.6rem 1rem', color: 'var(--text-secondary)' }}>{r.gateway}</td>
                    <td style={{ padding: '0.6rem 1rem' }}><code>{r.interface}</code></td>
                    <td style={{ padding: '0.6rem 1rem' }}>{r.metric}</td>
                    <td style={{ padding: '0.6rem 1rem', color: 'var(--color-success)' }}>🟢 Retentivo (Reboot Safe)</td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                      <button className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--color-danger)', padding: '0.35rem 0.6rem' }} onClick={() => handleDeleteRoute(r.id)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {routes.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Nenhuma rota estática personalizada configurada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- SUB-PANEL: NETBIRD VPN --- */}
      {activeSubTab === 'vpn' && (
        <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          {/* Header & Status Indicator */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Shield size={28} color="var(--color-primary)" />
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Cliente VPN Netbird (Acesso Remoto Seguro)</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Rede mesh criptografada ponto-a-ponto (WireGuard)</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: vpnStatus.connected ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '20px', border: `1px solid ${vpnStatus.connected ? 'var(--color-success)' : 'var(--border-color)'}` }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: vpnStatus.connected ? 'var(--color-success)' : 'var(--text-muted)' }}></div>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: vpnStatus.connected ? '#4ade80' : 'var(--text-muted)' }}>
                {vpnStatus.connected ? 'Conectado à VPN' : 'Desconectado'}
              </span>
            </div>
          </div>

          {!vpnStatus.installed ? (
            <div style={{ padding: '1.5rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', borderRadius: '10px', color: '#fbbf24' }}>
              <h4 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>⚠️ Cliente Netbird CLI não instalado no Raspberry Pi</h4>
              <p style={{ fontSize: '0.85rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                Para habilitar o acesso remoto VPN, instale o Netbird executando o comando abaixo no terminal do Raspberry Pi:
              </p>
              <code style={{ background: '#000', padding: '0.5rem 1rem', borderRadius: '6px', color: '#4ade80', fontSize: '0.9rem', display: 'block' }}>
                curl -fsSL https://netbird.io/install.sh | sh
              </code>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* VPN Status Dashboard Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div style={{ background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>IP Virtual Netbird</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--color-primary)', marginTop: '0.2rem' }}>{vpnStatus.ip}</div>
                </div>
                <div style={{ background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Peers Conectados</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)', marginTop: '0.2rem' }}>{vpnStatus.peersCount} Dispositivos</div>
                </div>
                <div style={{ background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status do Serviço</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: vpnStatus.connected ? '#4ade80' : 'var(--color-danger)', marginTop: '0.2rem' }}>{vpnStatus.statusText}</div>
                </div>
              </div>

              {/* Setup Key Connect Form */}
              <div style={{ background: 'var(--bg-subcard)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '1rem' }}>Conectar via Setup Key (Chave de Configuração)</h4>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Cole aqui a sua Setup Key do Netbird (ex: B6705D12-XXXX...)"
                    value={vpnSetupKey}
                    onChange={e => setVpnSetupKey(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary" onClick={handleConnectVpn}>
                    <Activity size={16} /> Iniciar / Conectar VPN
                  </button>
                  {vpnStatus.connected && (
                    <button className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--color-danger)' }} onClick={handleDisconnectVpn}>
                      Parar Serviço
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- SUB-PANEL: MQTT BROKER & JSON STRUCTURE (Matching Screenshots 4 & 5) --- */}
      {activeSubTab === 'mqtt' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Connection Card (Matching Screenshot 4) */}
          <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Connection (Broker MQTT Externo)</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Configurações do cliente MQTT para transmissão de telemetria</span>
              </div>

              {/* Status Green Dot (connected) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: mqttStatus === 'connected' ? '#22c55e' : 'var(--text-muted)' }}></div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: mqttStatus === 'connected' ? '#4ade80' : 'var(--text-muted)' }}>
                  {mqttStatus === 'connected' ? 'connected' : 'disconnected'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 2fr', gap: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Host</label>
                  <input type="text" className="form-input" placeholder="mqttws.meudominio.com.br" value={mqttConfig.host} onChange={e => setMqttConfig({...mqttConfig, host: e.target.value})} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Port</label>
                  <input type="number" className="form-input" placeholder="1883" value={mqttConfig.port} onChange={e => setMqttConfig({...mqttConfig, port: parseInt(e.target.value)})} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">ClientID</label>
                  <input type="text" className="form-input" placeholder="kronox-gw-01" value={mqttConfig.client_id} onChange={e => setMqttConfig({...mqttConfig, client_id: e.target.value})} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr', gap: '1rem', alignItems: 'center' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Username</label>
                  <input type="text" className="form-input" placeholder="mqtt" value={mqttConfig.username} onChange={e => setMqttConfig({...mqttConfig, username: e.target.value})} />
                </div>
                <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
                  <label className="form-label">Password</label>
                  <input type={showMqttPassword ? 'text' : 'password'} className="form-input" placeholder="••••••••" value={mqttConfig.password} onChange={e => setMqttConfig({...mqttConfig, password: e.target.value})} />
                  <button type="button" onClick={() => setShowMqttPassword(!showMqttPassword)} style={{ position: 'absolute', right: '10px', top: '32px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    {showMqttPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Keep Alive</label>
                  <input type="number" className="form-input" value={mqttConfig.keep_alive} onChange={e => setMqttConfig({...mqttConfig, keep_alive: parseInt(e.target.value)})} />
                </div>
                <div className="form-group" style={{ marginBottom: 0, textAlign: 'center' }}>
                  <label className="form-label">SSL / TLS</label>
                  <input type="checkbox" checked={mqttConfig.use_ssl} onChange={e => setMqttConfig({...mqttConfig, use_ssl: e.target.checked})} style={{ width: '18px', height: '18px', cursor: 'pointer', marginTop: '0.4rem' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0, textAlign: 'center' }}>
                  <label className="form-label">Clean Session</label>
                  <input type="checkbox" checked={mqttConfig.clean_session} onChange={e => setMqttConfig({...mqttConfig, clean_session: e.target.checked})} style={{ width: '18px', height: '18px', cursor: 'pointer', marginTop: '0.4rem' }} />
                </div>
              </div>

              {/* Last Will Section */}
              <div style={{ background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '0.5rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Mensagem de Testamento (Last-Will)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 3fr', gap: '1rem' }}>
                  <input type="text" className="form-input" placeholder="Last-Will Topic" value={mqttConfig.last_will_topic} onChange={e => setMqttConfig({...mqttConfig, last_will_topic: e.target.value})} />
                  <select className="form-input" value={mqttConfig.last_will_qos} onChange={e => setMqttConfig({...mqttConfig, last_will_qos: parseInt(e.target.value)})}>
                    <option value={0}>QoS 0</option>
                    <option value={1}>QoS 1</option>
                    <option value={2}>QoS 2</option>
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={mqttConfig.last_will_retain} onChange={e => setMqttConfig({...mqttConfig, last_will_retain: e.target.checked})} />
                    <span>Retain</span>
                  </label>
                  <input type="text" className="form-input" placeholder="Last-Will Message" value={mqttConfig.last_will_message} onChange={e => setMqttConfig({...mqttConfig, last_will_message: e.target.value})} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
                <button className="btn" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--color-primary)' }} onClick={handleTestMqtt}>
                  <RefreshCw size={16} /> Testar Conexão
                </button>
                <button className="btn btn-primary" onClick={handleSaveMqtt}>
                  <Save size={16} /> Salvar Conexão
                </button>
              </div>
            </div>
          </div>

          {/* JSON Structure Customization & Export/Import (Matching Screenshot 5) */}
          <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Estrutura do Payload JSON & Tópico de Publicação</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Mapeie os nomes das variáveis usando a sintaxe <code>&#123;&#123;nome_variavel&#125;&#125;</code></span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} onClick={handleExportMqttJSON}>
                  <Download size={16} /> Exportar JSON
                </button>
                <label className="btn" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Upload size={16} /> Importar JSON
                  <input type="file" accept=".json" onChange={handleImportMqttJSON} style={{ display: 'none' }} />
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tópico MQTT de Publicação</label>
                <input type="text" className="form-input" placeholder="wnology/69984de99729cbaaea3687e6/state" value={mqttConfig.publish_topic} onChange={e => setMqttConfig({...mqttConfig, publish_topic: e.target.value})} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Intervalo (Segundos)</label>
                <input type="number" className="form-input" value={mqttConfig.publish_interval_seconds} onChange={e => setMqttConfig({...mqttConfig, publish_interval_seconds: parseInt(e.target.value)})} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Template Editor */}
              <div>
                <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Editor do Template JSON</label>
                <textarea
                  rows={10}
                  className="form-input"
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.4', background: '#0b0f19', color: '#38bdf8' }}
                  value={mqttConfig.json_template}
                  onChange={e => setMqttConfig({...mqttConfig, json_template: e.target.value})}
                />
              </div>

              {/* Live Preview (Green matching screenshot 5) */}
              <div>
                <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Preview da Saída em Tempo Real (JSON Formatado)</label>
                <div style={{ background: '#10b981', color: '#ffffff', borderRadius: '8px', padding: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', height: '215px', overflowY: 'auto' }}>
                  <div style={{ fontSize: '0.75rem', opacity: 0.9, marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Topic: {mqttConfig.publish_topic}</span>
                    <span>QoS: 0</span>
                  </div>
                  <pre style={{ margin: 0, fontFamily: 'inherit', color: 'inherit' }}>
                    {computeJsonPreview()}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-PANEL: AUDITORIA (GATEWAY AUDIT LOGS) --- */}
      {activeSubTab === 'audit' && (
        <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={20} color="var(--color-primary)" /> Log de Auditoria Industrial (Alterações no Gateway)
          </h3>

          <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.6rem 1rem' }}>Data / Hora</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Usuário</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Categoria</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Ação</th>
                  <th style={{ padding: '0.6rem 1rem' }}>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.6rem 1rem', color: 'var(--text-muted)' }}>{new Date(l.timestamp).toLocaleString('pt-BR')}</td>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{l.username}</td>
                    <td style={{ padding: '0.6rem 1rem' }}><code>{l.category}</code></td>
                    <td style={{ padding: '0.6rem 1rem' }}>{l.action}</td>
                    <td style={{ padding: '0.6rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.details}</td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Nenhum registro de auditoria gravado até o momento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- SUB-PANEL: PING --- */}
      {activeSubTab === 'ping' && (
        <div className="card" style={{ background: 'var(--bg-card)', padding: '1.75rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <Activity size={24} color="var(--color-primary)" />
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Ferramenta de Ping (ICMP)</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Verifique a conectividade de rede com dispositivos da rede local ou internet</span>
            </div>
          </div>

          {/* Input + Interface Selector + Button */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Globe size={14} /> Endereço IP ou Hostname
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: 192.168.1.5 ou google.com"
                value={pingHost}
                onChange={e => setPingHost(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !pingLoading && handlePing()}
                style={{ fontSize: '1rem' }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Network size={14} /> Interface de Saída
              </label>
              <select
                className="form-input"
                value={pingInterface}
                onChange={e => setPingInterface(e.target.value)}
                style={{ fontSize: '0.9rem' }}
              >
                <option value="auto">Automático (Tabela de Rotas)</option>
                <option value="eth0">Forçar Ethernet 0 (eth0)</option>
                <option value="wlan0">Forçar Wi-Fi (wlan0)</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={handlePing}
              disabled={pingLoading}
              style={{ padding: '0.65rem 1.5rem', minWidth: '130px', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '42px' }}
            >
              {pingLoading
                ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Pingando...</>
                : <><Activity size={16} /> Pingar</>}
            </button>
          </div>

          {/* Result Box */}
          {pingResult && (
            <div style={{
              background: pingResult.success ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${pingResult.success ? 'var(--color-success)' : 'var(--color-danger)'}`,
              borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {pingResult.success
                    ? <CheckCircle2 size={20} color="var(--color-success)" />
                    : <XCircle size={20} color="var(--color-danger)" />}
                  <strong style={{ fontSize: '1rem', color: pingResult.success ? '#4ade80' : '#f87171' }}>
                    {pingResult.success ? 'Host alcançado com sucesso' : 'Host não alcançado / erro'}
                  </strong>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {pingResult.timestamp ? new Date(pingResult.timestamp).toLocaleTimeString('pt-BR') : ''}
                </span>
              </div>
              <pre style={{
                margin: 0, fontFamily: 'monospace', fontSize: '0.82rem',
                color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                background: 'rgba(0,0,0,0.25)', padding: '0.75rem', borderRadius: '6px',
                maxHeight: '220px', overflowY: 'auto', lineHeight: '1.5'
              }}>
                {pingResult.output}
              </pre>
            </div>
          )}

          {/* Ping History */}
          {pingHistory.length > 0 && (
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Clock size={14} /> Histórico da Sessão
              </h4>
              <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.5rem 1rem' }}>Host</th>
                      <th style={{ padding: '0.5rem 1rem' }}>Status</th>
                      <th style={{ padding: '0.5rem 1rem', textAlign: 'right' }}>Horário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pingHistory.map(h => (
                      <tr
                        key={h.id}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                        onClick={() => setPingResult(h)}
                      >
                        <td style={{ padding: '0.5rem 1rem', fontWeight: 600 }}>{h.host}</td>
                        <td style={{ padding: '0.5rem 1rem' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                            padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600,
                            background: h.success ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: h.success ? '#4ade80' : '#f87171',
                            border: `1px solid ${h.success ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`
                          }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: h.success ? '#4ade80' : '#f87171' }} />
                            {h.success ? 'OK' : 'FALHA'}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {h.timestamp ? new Date(h.timestamp).toLocaleTimeString('pt-BR') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Clique em uma linha para ver o resultado completo.</p>
            </div>
          )}
        </div>
      )}

      {/* --- ANTI-BRICK SAFE MODE CONFIRMATION MODAL (60s Countdown) --- */}
      {showRollbackModal && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: '480px', padding: '2rem', textAlign: 'center', background: '#0f172a', border: '1px solid var(--color-primary)', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.15)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <Shield size={32} color="var(--color-primary)" />
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Validação de Segurança (Anti-Brick)</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              As novas configurações de IP foram aplicadas no modo temporário. Se sua conexão remota continuar ativa, clique em **Confirmar Conexão**.
            </p>

            {/* Countdown Badge */}
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '1.5rem' }}>
              {rollbackCountdown}s
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn btn-primary" style={{ padding: '0.75rem 1.5rem' }} onClick={handleConfirmRollback}>
                <CheckCircle2 size={18} /> Confirmar Conexão (Manter)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GatewayPanel;
