import React, { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Settings, HelpCircle, Plus, Trash2, CheckCircle2, ShieldAlert, Edit2, Download } from 'lucide-react';

function AlarmsPanel({ plcState, currentUser, devices = [], generalConfig = {} }) {
  const [innerTab, setInnerTab] = useState('history');
  
  const [history, setHistory] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [devicesList, setDevicesList] = useState(devices);
  const [loading, setLoading] = useState(true);
  const [editingConfigId, setEditingConfigId] = useState(null);

  // Formulário de Cadastro
  const [form, setForm] = useState({
    device_id: devices[0]?.id || 1,
    name: '',
    description: '',
    modbus_address: 0,
    modbus_type: 'coil',
    condition_type: '==',
    condition_value: 1,
    severity: 'Alta',
    action_measures: ''
  });

  const [selectedHelp, setSelectedHelp] = useState(null);

  const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      if (window.location.port === '5173') return '';
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
    }
    return 'http://localhost:3001';
  };

  const fetchDevices = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/devices');
      if (res.ok) {
        const data = await res.json();
        setDevicesList(data);
        if (data.length > 0 && !form.device_id) {
          setForm(f => ({ ...f, device_id: data[0].id }));
        }
      }
    } catch (e) {}
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/alarm_history');
      if (res.ok) setHistory(await res.json());
    } catch (e) {}
  };

  const fetchConfigs = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/alarm_configs');
      if (res.ok) setConfigs(await res.json());
    } catch (e) {}
  };

  useEffect(() => {
    fetchHistory();
    fetchConfigs();
    fetchDevices();
    setLoading(false);
    
    // Polling frequente para manter a tela viva
    const interval = setInterval(fetchHistory, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (devices.length > 0) {
      setDevicesList(devices);
      setForm(f => ({ ...f, device_id: f.device_id || devices[0].id }));
    }
  }, [devices]);

  const handleEditConfig = (cfg) => {
    setEditingConfigId(cfg.id);
    setForm({
      device_id: cfg.device_id || (devicesList[0]?.id || 1),
      name: cfg.name || '',
      description: cfg.description || '',
      modbus_address: cfg.modbus_address || 0,
      modbus_type: cfg.modbus_type || 'coil',
      condition_type: cfg.condition_type || '==',
      condition_value: cfg.condition_value !== undefined ? cfg.condition_value : 1,
      severity: cfg.severity || 'Alta',
      action_measures: cfg.action_measures || ''
    });
  };

  const handleAddConfig = async (e) => {
    e.preventDefault();
    try {
      const url = editingConfigId 
        ? getBaseUrl() + `/api/alarm_configs/${editingConfigId}`
        : getBaseUrl() + '/api/alarm_configs';
      const method = editingConfigId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          device_id: form.device_id || (devicesList[0]?.id || 1)
        })
      });
      if (res.ok) {
        fetchConfigs();
        setEditingConfigId(null);
        setForm({
          device_id: devicesList[0]?.id || 1,
          name: '', description: '', modbus_address: 0, modbus_type: 'coil',
          condition_type: '==', condition_value: 1, severity: 'Alta', action_measures: ''
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfig = async (id) => {
    if (!window.confirm('Tem certeza que deseja remover esta regra de alarme?')) return;
    try {
      await fetch(getBaseUrl() + `/api/alarm_configs/${id}`, { method: 'DELETE' });
      fetchConfigs();
    } catch (err) {}
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
      let d;
      if (typeof dateString === 'string' && !dateString.includes('Z') && !dateString.includes('+')) {
        d = new Date(dateString.replace(' ', 'T') + 'Z');
      } else {
        d = new Date(dateString);
      }
      if (isNaN(d.getTime())) return String(dateString);
      const tz = generalConfig?.timezone || 'America/Sao_Paulo';
      return d.toLocaleString('pt-BR', { timeZone: tz });
    } catch(e) {
      return String(dateString);
    }
  };

  const handleExportCSV = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/alarm_history/export/csv');
      if (!res.ok) throw new Error('Erro ao buscar CSV');
      const csvText = await res.text();
      
      const fileName = `Historico_de_Falhas_KRONOX_${new Date().toISOString().slice(0,10)}.csv`;

      if ('showSaveFilePicker' in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'Arquivo CSV (*.csv)',
              accept: { 'text/csv': ['.csv'] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(csvText);
          await writable.close();
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch(e) {
      console.error('Erro ao exportar CSV:', e);
      alert('Erro ao gerar relatório CSV de falhas.');
    }
  };

  const getSeverityColor = (sev) => {
    const s = (sev || '').toLowerCase();
    if (s.includes('crític')) return 'var(--color-danger)';
    if (s.includes('alta')) return '#f97316';
    if (s.includes('média') || s.includes('media')) return 'var(--color-warning)';
    return 'var(--color-primary)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
      
      {/* Navegação Interna */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
        <button 
          className={`btn ${innerTab === 'history' ? 'btn-primary' : ''}`}
          style={innerTab !== 'history' ? { background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' } : {}}
          onClick={() => setInnerTab('history')}
        >
          <Clock size={16} /> Histórico de Alarmes
        </button>
        
        {currentUser?.role === 'admin' && (
          <button 
            className={`btn ${innerTab === 'config' ? 'btn-primary' : ''}`}
            style={innerTab !== 'config' ? { background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' } : {}}
            onClick={() => setInnerTab('config')}
          >
            <Settings size={16} /> Cadastro de Regras
          </button>
        )}
      </div>

      {innerTab === 'history' && (
        <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ paddingBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="card-title"><AlertTriangle size={20} color="var(--color-danger)" /> Log de Eventos e Falhas</h2>
            <button 
              className="btn btn-primary" 
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem', background: '#06b6d4', display: 'flex', alignItems: 'center', gap: '0.4rem', border: 'none', cursor: 'pointer' }}
              onClick={handleExportCSV}
            >
              <Download size={16} /> Exportar Histórico de Falhas (.CSV)
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.75rem', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '0.75rem', fontWeight: 600 }}>Origem (CLP)</th>
                  <th style={{ padding: '0.75rem', fontWeight: 600 }}>Alarme</th>
                  <th style={{ padding: '0.75rem', fontWeight: 600 }}>Criticidade</th>
                  <th style={{ padding: '0.75rem', fontWeight: 600 }}>Data Disparo</th>
                  <th style={{ padding: '0.75rem', fontWeight: 600 }}>Data Resolução</th>
                  <th style={{ padding: '0.75rem', fontWeight: 600, textAlign: 'center' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {history.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem' }}>
                      {item.status === 'ACTIVE' ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-danger)', fontWeight: 'bold', textShadow: '0 0 10px rgba(239,68,68,0.5)' }}>
                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-danger)', animation: 'pulse 1.5s infinite' }}></span>
                          🔴 ATIVO
                        </div>
                      ) : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-normal)' }}>
                          <CheckCircle2 size={16} />
                          🟢 RESOLVIDO
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: '500' }}>
                      {item.device_name || 'CLP Principal'}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.description}</div>
                    </td>
                    <td style={{ padding: '0.75rem', color: getSeverityColor(item.severity), fontWeight: 'bold' }}>
                      {item.severity}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{formatDate(item.trigger_time)}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{formatDate(item.resolve_time)}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <div className="tooltip-container" style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }} onClick={() => setSelectedHelp(item)}>
                        <HelpCircle size={20} color="var(--color-primary)" />
                        <div className="tooltip-content" style={{ position: 'absolute', right: '130%', top: '50%', transform: 'translateY(-50%)', width: '260px', background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(12px)', padding: '1rem', borderRadius: '8px', zIndex: 9999, display: 'none', border: '1px solid var(--border-highlight)', boxShadow: '0 10px 30px rgba(0,0,0,0.8)', textAlign: 'left' }}>
                          <strong style={{ display: 'block', marginBottom: '0.4rem', color: 'white', fontSize: '0.9rem' }}>Medidas a Tomar:</strong>
                          <span style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>{item.action_measures || 'Nenhuma medida cadastrada.'}</span>
                          <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>(Clique para expandir)</span>
                        </div>
                        <style>{`.tooltip-container:hover .tooltip-content { display: block !important; }`}</style>
                      </div>
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum histórico de alarme registrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {innerTab === 'config' && currentUser?.role === 'admin' && (
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          {/* Formulário Novo / Editar Alarme */}
          <div className="card" style={{ flex: 1, minWidth: '350px', background: 'rgba(15, 23, 42, 0.6)' }}>
            <div className="card-header">
              <h3 className="card-title">
                {editingConfigId ? <Edit2 size={18} color="var(--color-primary)" /> : <Plus size={18} />} 
                {editingConfigId ? ' Editar Regra de Alarme' : ' Nova Regra de Alarme'}
              </h3>
            </div>
            <form onSubmit={handleAddConfig} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
              
              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">CLP de Origem (Dispositivo)</label>
                <select className="form-input" value={form.device_id || (devicesList[0]?.id || 1)} onChange={e => setForm({...form, device_id: parseInt(e.target.value)})}>
                  {devicesList.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.ip_address}:{d.port})</option>
                  ))}
                  {devicesList.length === 0 && <option value={1}>CLP Principal (127.0.0.1)</option>}
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Nome do Alarme</label>
                <input type="text" className="form-input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Falha Inversor Bomba 1" />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Descrição</label>
                <input type="text" className="form-input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Causa provável..." />
              </div>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Endereço Modbus</label>
                <input type="number" className="form-input" required value={form.modbus_address} onChange={e => setForm({...form, modbus_address: parseInt(e.target.value)})} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tipo de Variável</label>
                <select className="form-input" value={form.modbus_type} onChange={e => setForm({...form, modbus_type: e.target.value})}>
                  <option value="coil">Coil (0x - Saída Digital)</option>
                  <option value="discrete">Discrete Input (1x - Entrada Digital)</option>
                  <option value="input">Input Register (3x - Entrada Analógica)</option>
                  <option value="holding">Holding Register (4x - Registrador Interno)</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Condição de Disparo</label>
                <select className="form-input" value={form.condition_type} onChange={e => setForm({...form, condition_type: e.target.value})}>
                  <option value="==">Igual a (==)</option>
                  <option value="!=">Diferente de (!=)</option>
                  <option value=">">Maior que (&gt;)</option>
                  <option value=">=">Maior ou Igual a (&gt;=)</option>
                  <option value="<">Menor que (&lt;)</option>
                  <option value="<=">Menor ou Igual a (&lt;=)</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Valor Gatilho</label>
                <input type="number" step="0.1" className="form-input" required value={form.condition_value} onChange={e => setForm({...form, condition_value: parseFloat(e.target.value)})} />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Criticidade</label>
                <select className="form-input" value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}>
                  <option value="Baixa">Baixa</option>
                  <option value="Média">Média</option>
                  <option value="Alta">Alta</option>
                  <option value="Crítica">Crítica</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Medidas a Tomar (Ajuda)</label>
                <textarea className="form-input" rows="3" required value={form.action_measures} onChange={e => setForm({...form, action_measures: e.target.value})} placeholder="Instruções para o operador quando este alarme disparar..."></textarea>
              </div>

              <div style={{ gridColumn: '1 / -1', marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
                {editingConfigId && (
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ flex: 1, justifyContent: 'center', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }} 
                    onClick={() => {
                      setEditingConfigId(null);
                      setForm({
                        device_id: devicesList[0]?.id || 1,
                        name: '', description: '', modbus_address: 0, modbus_type: 'coil',
                        condition_type: '==', condition_value: 1, severity: 'Alta', action_measures: ''
                      });
                    }}
                  >
                    Cancelar
                  </button>
                )}
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  {editingConfigId ? 'Atualizar Regra' : 'Salvar Regra de Alarme'}
                </button>
              </div>
            </form>
          </div>

          {/* Lista de Configurações */}
          <div className="card" style={{ flex: 1, minWidth: '350px' }}>
            <div className="card-header"><h3 className="card-title"><ShieldAlert size={18} /> Regras Cadastradas</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem', overflowY: 'auto', maxHeight: '600px' }}>
              {configs.map(cfg => (
                <div key={cfg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: editingConfigId === cfg.id ? '1px solid var(--color-primary)' : '1px solid var(--border-color)' }}>
                  <div>
                    <strong style={{ display: 'block' }}>{cfg.name}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>
                      CLP: <strong style={{ color: 'var(--color-primary)' }}>{cfg.device_name || 'CLP Principal'}</strong> | Endereço: {cfg.modbus_address} ({cfg.modbus_type})
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Condição: {cfg.condition_type} {cfg.condition_value} | Criticidade: {cfg.severity}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleEditConfig(cfg)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="btn" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleDeleteConfig(cfg.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {configs.length === 0 && <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>Nenhuma regra configurada.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Medidas a Tomar */}
      {selectedHelp && (
        <div className="overlay" onClick={() => setSelectedHelp(null)} style={{ zIndex: 10000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px', padding: '2rem', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid var(--border-highlight)', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'white', fontSize: '1.2rem' }}>
                <HelpCircle size={22} color="var(--color-primary)" /> Medidas a Tomar
              </h3>
              <button className="btn" style={{ padding: '0.25rem 0.5rem', background: 'transparent', color: 'var(--text-secondary)', fontSize: '1.2rem' }} onClick={() => setSelectedHelp(null)}>✕</button>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ fontSize: '1.1rem', color: 'white', display: 'block', marginBottom: '0.25rem' }}>{selectedHelp.name}</strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                CLP: <strong style={{ color: 'var(--color-primary)' }}>{selectedHelp.device_name || 'CLP Principal'}</strong> | Criticidade: <strong style={{ color: getSeverityColor(selectedHelp.severity) }}>{selectedHelp.severity}</strong>
              </span>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.4)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', fontSize: '0.95rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
              {selectedHelp.action_measures || 'Nenhuma instrução cadastrada para este alarme.'}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => setSelectedHelp(null)}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlarmsPanel;
