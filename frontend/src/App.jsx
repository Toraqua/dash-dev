import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Activity, Settings, Zap, Camera, AlertTriangle, Wrench, LogOut, User, Lock, BellRing, Lightbulb, Sun, Moon, Cpu } from 'lucide-react';
import Dashboard from './components/Dashboard';
import ConfigPanel from './components/ConfigPanel';
import GatewayPanel from './components/GatewayPanel';
import AlarmsPanel from './components/AlarmsPanel';
import CamerasPanel from './components/CamerasPanel';

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    if (window.location.port === '5173') return '';
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
  }
  return 'http://localhost:3001';
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('kronox_theme') || 'dark');
  const [currentUser, setCurrentUser] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showUserPopup, setShowUserPopup] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kronox_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const [plcState, setPlcState] = useState({
    level: 0,
    pump1: 'Offline',
    pump1_active: false,
    pump2: 'Offline',
    pump2_active: false,
    alarms: [],
    connected: false,
    camera: 'Offline',
    lighting: 'Off'
  });
  
  const [socket, setSocket] = useState(null);
  const [variables, setVariables] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [devices, setDevices] = useState([]);
  const [activeAlarmsCount, setActiveAlarmsCount] = useState(0);
  const [lastReadTimes, setLastReadTimes] = useState({});

  const [generalConfig, setGeneralConfig] = useState(() => {
    try {
      const cached = localStorage.getItem('kronox_general_config');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return {
      system_name: 'KRONOX OS',
      system_logo: '/kronox_logo.png',
      sidebar_display: 'image',
      dashboard_title: 'Visão Geral da Estação',
      timezone: 'America/Sao_Paulo',
      history_interval_seconds: 15
    };
  });

  const [lightingConfig, setLightingConfig] = useState({
    enabled: true,
    name: 'Iluminação Elevatória',
    device_id: 1,
    modbus_type: 'coil',
    modbus_address: 0
  });
  const [lightingState, setLightingState] = useState(false);

  const handleToggleLighting = async (newVal) => {
    setLightingState(newVal);
    try {
      await fetch(getBaseUrl() + '/api/modbus/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: lightingConfig.device_id || 1,
          modbus_type: lightingConfig.modbus_type || 'coil',
          address: lightingConfig.modbus_address !== undefined ? lightingConfig.modbus_address : 0,
          value: newVal ? 1 : 0
        })
      });
    } catch (e) {
      console.error('Erro ao acionar iluminação:', e);
    }
  };

  const fetchActiveAlarms = async (baseUrl) => {
    try {
      const res = await fetch(baseUrl + '/api/alarm_history');
      if (res.ok) {
        const data = await res.json();
        const active = data.filter(a => a.status === 'ACTIVE').length;
        setActiveAlarmsCount(active);
      }
    } catch(e) {}
  };

  const fetchData = async () => {
    try {
      const [varRes, camRes, devRes, lightRes, genRes] = await Promise.all([
        fetch(getBaseUrl() + '/api/variables'),
        fetch(getBaseUrl() + '/api/cameras'),
        fetch(getBaseUrl() + '/api/devices'),
        fetch(getBaseUrl() + '/api/settings/lighting'),
        fetch(getBaseUrl() + '/api/settings/general')
      ]);
      if (varRes.ok) setVariables(await varRes.json());
      if (camRes.ok) setCameras(await camRes.json());
      if (devRes.ok) setDevices(await devRes.json());
      if (lightRes.ok) setLightingConfig(await lightRes.json());
      if (genRes.ok) {
        const genData = await genRes.json();
        setGeneralConfig(genData);
        try { localStorage.setItem('kronox_general_config', JSON.stringify(genData)); } catch(e) {}
      }
      
      fetchActiveAlarms(getBaseUrl());
    } catch (e) {
      console.error('Erro ao buscar configurações:', e);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('kronox_user');
    const savedTime = localStorage.getItem('kronox_user_time');
    if (savedUser && savedTime) {
      const now = new Date().getTime();
      if (now - parseInt(savedTime) < 10 * 60 * 1000) {
        setCurrentUser(JSON.parse(savedUser));
        localStorage.setItem('kronox_user_time', now.toString()); // extend
      } else {
        handleLogout();
      }
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const savedTime = localStorage.getItem('kronox_user_time');
      if (savedTime && new Date().getTime() - parseInt(savedTime) > 10 * 60 * 1000) {
        handleLogout();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    setCurrentUser(null);
    setShowUserPopup(false);
    localStorage.removeItem('kronox_user');
    localStorage.removeItem('kronox_user_time');
    if (activeTab === 'engineering' || activeTab === 'config') {
      setActiveTab('dashboard');
    }
  };

  const handleTabChange = (tab) => {
    if (tab === 'engineering' && !currentUser) {
      setPendingTab(tab);
      setShowLoginModal(true);
      return;
    }
    if (tab === 'config') {
      if (!currentUser) {
        setPendingTab(tab);
        setShowLoginModal(true);
        return;
      } else if (currentUser.role !== 'admin') {
        alert('Acesso Restrito: Apenas Administradores podem acessar a Configuração.');
        return;
      }
    }
    setActiveTab(tab);
  };

  const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      if (window.location.port === '5173') return '';
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
    }
    return 'http://localhost:3001';
  };

  const submitLogin = async (e) => {
    if (e) e.preventDefault();
    try {
      const response = await fetch(getBaseUrl() + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await response.json();
      if (response.ok) {
        setCurrentUser(data.user);
        localStorage.setItem('kronox_user', JSON.stringify(data.user));
        localStorage.setItem('kronox_user_time', new Date().getTime().toString());
        setShowLoginModal(false);
        setLoginForm({ username: '', password: '' });
        setLoginError('');
        if (pendingTab) {
          if (pendingTab === 'config' && data.user.role !== 'admin') {
            alert('Acesso Restrito: Apenas Administradores podem acessar a Configuração.');
            setPendingTab(null);
          } else {
            setActiveTab(pendingTab);
            setPendingTab(null);
          }
        }
      } else {
        setLoginError(data.error);
      }
    } catch (err) {
      setLoginError('Erro de conexão ao servidor.');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    // Conectar ao backend (usa proxy / caminho relativo em produção, ou URL direta se configurada)
    const socketUrl = import.meta.env.VITE_API_URL || (window.location.port === '5173' ? 'http://localhost:3001' : undefined);
    const newSocket = io(socketUrl);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Conectado ao servidor via WS');
    });

    newSocket.on('update', (data) => {
      // payload data agora é { state, lastReadTimes }
      if (data.state) setPlcState(prev => ({ ...prev, ...data.state }));
      else setPlcState(prev => ({ ...prev, ...data })); // compatibilidade legada
      if (data.lastReadTimes) setLastReadTimes(data.lastReadTimes);
    });

    newSocket.on('alarms_updated', () => {
      fetchActiveAlarms(getBaseUrl());
    });

    newSocket.on('variables_updated', () => {
      fetchData(); // Recarregar variaveis e cameras quando houver mudança
    });

    newSocket.on('lighting_config_updated', (cfg) => {
      setLightingConfig(cfg);
    });

    newSocket.on('general_config_updated', (cfg) => {
      setGeneralConfig(cfg);
      try { localStorage.setItem('kronox_general_config', JSON.stringify(cfg)); } catch(e) {}
    });

    newSocket.on('disconnect', () => {
      console.log('Desconectado do servidor');
      setPlcState(prev => ({ ...prev, connected: false }));
    });

    return () => newSocket.close();
  }, []);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {generalConfig.sidebar_display === 'text' ? (
              <>
                <Zap size={28} color="var(--color-primary)" />
                <span>{generalConfig.system_name || 'KRONOX OS'}</span>
              </>
            ) : generalConfig.system_logo ? (
              <img
                src={generalConfig.system_logo?.includes('kronox_logo') ? (theme === 'dark' ? '/kronox_logo_dark.png' : '/kronox_logo_light.png') : generalConfig.system_logo}
                alt={generalConfig.system_name || 'Logo'}
                style={{ height: '42px', maxWidth: '180px', objectFit: 'contain' }}
              />
            ) : (
              <>
                <Zap size={28} color="var(--color-primary)" />
                <span>{generalConfig.system_name || 'KRONOX OS'}</span>
              </>
            )}
          </div>
          <button 
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Alternar para Tema Claro' : 'Alternar para Tema Escuro'}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid var(--border-color)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme === 'dark' ? '#f59e0b' : '#2563eb',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              flexShrink: 0
            }}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => handleTabChange('dashboard')}
          >
            <Activity size={20} />
            <span>Supervisão</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'engineering' ? 'active' : ''}`}
            onClick={() => handleTabChange('engineering')}
          >
            <Wrench size={20} />
            <span>Engenharia</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => handleTabChange('config')}
          >
            <Settings size={20} />
            <span>Configuração</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'gateway' ? 'active' : ''}`}
            onClick={() => handleTabChange('gateway')}
          >
            <Cpu size={20} />
            <span>Gateway</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'cameras' ? 'active' : ''}`}
            onClick={() => handleTabChange('cameras')}
          >
            <Camera size={20} />
            <span>Câmeras</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'alarms' ? 'active' : ''}`}
            onClick={() => handleTabChange('alarms')}
            style={{ position: 'relative' }}
          >
            {activeAlarmsCount > 0 ? (
              <BellRing size={20} color="var(--color-danger)" style={{ animation: 'pulse 2s infinite' }} />
            ) : (
              <AlertTriangle size={20} />
            )}
            <span>Alarmes</span>
            {activeAlarmsCount > 0 && (
              <span style={{ position: 'absolute', top: '8px', right: '12px', background: 'var(--color-danger)', color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>
                {activeAlarmsCount}
              </span>
            )}
          </button>
        </nav>

        {/* Status Indicator on Sidebar */}
        <div className={`sidebar-status status-indicator ${plcState.connected ? 'status-normal' : 'status-offline'}`}>
          <div className="status-dot"></div>
          {plcState.connected ? 'Sistema Online' : 'Sistema Offline'}
        </div>

        {/* Sidebar Lighting Toggle Quick Action */}
        {Boolean(lightingConfig && lightingConfig.enabled !== false && lightingConfig.enabled !== 'false' && lightingConfig.enabled !== 0 && lightingConfig.enabled !== '0') && (
          <div className="sidebar-lighting">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Lightbulb size={20} color={lightingState ? '#f59e0b' : 'var(--text-secondary)'} style={{ filter: lightingState ? 'drop-shadow(0 0 8px #f59e0b)' : 'none' }} />
              <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {lightingConfig.name || 'Refletor Principal 1'}
              </span>
            </div>
            
            <label className="ios-switch">
              <input 
                type="checkbox" 
                checked={lightingState} 
                onChange={(e) => handleToggleLighting(e.target.checked)} 
              />
              <span className="ios-slider"></span>
            </label>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="page-header">
          <h1 className="page-title">
            {activeTab === 'dashboard' && (generalConfig.dashboard_title || 'Visão Geral da Estação')}
            {activeTab === 'engineering' && 'Parâmetros de Engenharia'}
            {activeTab === 'config' && 'Configurações do Sistema'}
            {activeTab === 'gateway' && 'Gerenciamento do Gateway (Rede, VPN & MQTT)'}
            {activeTab === 'cameras' && 'Monitoramento por Câmeras'}
            {activeTab === 'alarms' && 'Histórico de Alarmes'}
          </h1>
          
          <div style={{ position: 'relative' }}>
            {currentUser ? (
              <>
                <button 
                  className="btn" 
                  style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}
                  onClick={() => setShowUserPopup(!showUserPopup)}
                >
                  <User size={16} color="var(--color-primary)" />
                  <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{currentUser.username}</span>
                </button>
                
                {showUserPopup && (
                  <div className="card" style={{ position: 'absolute', top: '120%', right: 0, width: '200px', zIndex: 1000, padding: '1rem', boxShadow: 'var(--glass-shadow)' }}>
                    <div style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                      <strong style={{ display: 'block', textTransform: 'capitalize', color: 'var(--text-primary)' }}>{currentUser.username}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{currentUser.role === 'admin' ? 'Administrador' : 'Operador'}</span>
                    </div>
                    <button className="btn" style={{ width: '100%', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.2)' }} onClick={handleLogout}>
                      <LogOut size={16} style={{ marginRight: '0.5rem' }} /> Sair
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button className="btn" style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} onClick={() => setShowLoginModal(true)}>
                <User size={16} style={{ marginRight: '0.5rem' }} /> Login
              </button>
            )}
          </div>
        </div>

        <div style={{ display: activeTab === 'dashboard' ? 'contents' : 'none' }}>
          <Dashboard key="dashboard" plcState={plcState} setPlcState={setPlcState} lastReadTimes={lastReadTimes} variables={variables.filter(v => v.category === 'supervision' || !v.category)} cameras={cameras} currentUser={currentUser} generalConfig={generalConfig} onRefresh={fetchData} onRequireLogin={() => setShowLoginModal(true)} />
        </div>

        <div style={{ display: activeTab === 'engineering' ? 'contents' : 'none' }}>
          <Dashboard key="engineering" plcState={plcState} setPlcState={setPlcState} lastReadTimes={lastReadTimes} variables={variables.filter(v => v.category === 'engineering')} cameras={[]} currentUser={currentUser} generalConfig={generalConfig} onRefresh={fetchData} onRequireLogin={() => setShowLoginModal(true)} />
        </div>

        {activeTab === 'config' && (
          <ConfigPanel
            socket={socket}
            variables={variables}
            cameras={cameras}
            devices={devices}
            generalConfig={generalConfig}
            onRefresh={fetchData}
            onTestStaleMode={() => {
              const stale8DaysMs = Date.now() - (8 * 24 * 60 * 60 * 1000);
              const testTimes = {};
              variables.forEach(v => {
                testTimes[v.id] = stale8DaysMs;
                testTimes[v.name] = stale8DaysMs;
                if (v.display_name) testTimes[v.display_name] = stale8DaysMs;
              });
              setLastReadTimes(testTimes);
            }}
          />
        )}

        {activeTab === 'gateway' && (
          <GatewayPanel currentUser={currentUser} variables={variables} generalConfig={generalConfig} onRefresh={fetchData} />
        )}

        {activeTab === 'cameras' && (
          <CamerasPanel plcState={plcState} cameras={cameras} />
        )}

        {activeTab === 'alarms' && (
          <AlarmsPanel plcState={plcState} currentUser={currentUser} devices={devices} generalConfig={generalConfig} />
        )}
      </main>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2.5rem', background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--color-primary), #60a5fa)', borderRadius: '50%', padding: '1rem', marginBottom: '1.5rem', boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)' }}>
              <Lock size={32} color="white" />
            </div>
            
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>Acesso Restrito</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', textAlign: 'center', fontSize: '0.9rem' }}>
              Por favor, identifique-se para acessar esta área do sistema.
            </p>

            <form onSubmit={submitLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {loginError && <div style={{ color: 'var(--color-danger)', fontSize: '0.85rem', background: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(239,68,68,0.2)' }}>{loginError}</div>}
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input autoFocus type="text" className="form-input" placeholder="Usuário" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} required style={{ padding: '0.8rem', background: 'rgba(0,0,0,0.3)' }} />
              </div>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input type="password" className="form-input" placeholder="Senha" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} required style={{ padding: '0.8rem', background: 'rgba(0,0,0,0.3)' }} />
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.05)' }} onClick={() => { setShowLoginModal(false); setPendingTab(null); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  Entrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
