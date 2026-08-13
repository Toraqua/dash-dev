import React, { useState, useEffect, useMemo } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, ScatterChart, Scatter } from 'recharts';
import { Activity, Power, Edit2, Check, RefreshCw, Move, TrendingUp, Gauge, Table as TableIcon, List as ListIcon, Link as LinkIcon, MapPin, Image as ImageIcon, BarChart2, Layout, Grid, Binary, Clock, Type, Edit3, Download, ChevronLeft, ChevronRight } from 'lucide-react';

function TableWidget({ v, val, history = [] }) {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortDir, setSortDir] = useState('desc');

  const sortedData = useMemo(() => {
    const arr = [...history];
    arr.sort((a, b) => {
      const tsA = a.raw_ts || 0;
      const tsB = b.raw_ts || 0;
      return sortDir === 'desc' ? tsB - tsA : tsA - tsB;
    });
    return arr;
  }, [history, sortDir]);

  const totalItems = sortedData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const handleDownload = () => {
    if (!sortedData.length) return;
    const headerLabel = v.unit ? `${v.display_name} (${v.unit})` : v.display_name;
    const csvRows = sortedData.map(d => {
      const valStr = typeof d.val === 'number' ? d.val.toString().replace('.', ',') : (d.val ?? '');
      const timeStr = d.time ? new Date(d.time).toLocaleString('pt-BR') : '';
      return [
        `"${timeStr}"`,
        `"${valStr}"`
      ].join(';');
    });
    const headers = `Data / Hora;"${headerLabel.replace(/"/g, '""')}"`;
    const csvContent = [headers, ...csvRows].join('\r\n');
    const bytes = new Uint8Array(csvContent.length);
    for (let i = 0; i < csvContent.length; i++) {
      const code = csvContent.charCodeAt(i);
      bytes[i] = code < 256 ? code : 63;
    }
    const blob = new Blob([bytes], { type: 'text/csv;charset=iso-8859-1;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Histórico_${v.name || 'variavel'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = () => {
    setSortDir(prev => (prev === 'desc' ? 'asc' : 'desc'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '0.35rem', padding: '0.2rem' }}>
      {/* Header Toolbar (Download icon at top right) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0.2rem' }}>
        <button
          onClick={handleDownload}
          title="Exportar CSV"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '4px 8px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.75rem',
            transition: 'all 0.2s'
          }}
        >
          <Download size={13} />
        </button>
      </div>

      {/* Table Data */}
      <div style={{ flex: 1, overflowY: 'auto', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)', userSelect: 'none' }}>
              <th onClick={toggleSort} style={{ padding: '0.45rem 0.6rem', cursor: 'pointer', fontWeight: 600 }}>
                Valor <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
              </th>
              <th style={{ padding: '0.45rem 0.6rem', fontWeight: 600 }}>
                Unidade
              </th>
              <th onClick={toggleSort} style={{ padding: '0.45rem 0.6rem', cursor: 'pointer', fontWeight: 600, textAlign: 'right' }}>
                Data / Hora <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>↓↑</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 'bold', color: v.color || 'white' }}>
                  {typeof row.val === 'number' ? row.val.toFixed(v.decimals || 0) : row.val}
                </td>
                <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-secondary)' }}>
                  {v.unit || '-'}
                </td>
                <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {row.time}
                </td>
              </tr>
            ))}
            {paginatedData.length === 0 && (
              <tr>
                <td colSpan="3" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Nenhum dado registrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', paddingTop: '0.2rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <button
            disabled={page <= 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
              borderRadius: '4px', padding: '2px 6px', color: page <= 1 ? 'var(--text-muted)' : 'white',
              cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.3 : 1
            }}
          >
            ‹
          </button>
          <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
          <button
            disabled={page >= totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
              borderRadius: '4px', padding: '2px 6px', color: page >= totalPages ? 'var(--text-muted)' : 'white',
              cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.3 : 1
            }}
          >
            ›
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            style={{
              background: '#0b0f19', border: '1px solid var(--border-color)',
              borderRadius: '4px', color: 'white', fontSize: '0.75rem', padding: '2px 4px', outline: 'none'
            }}
          >
            <option value={5}>Mostrar 5</option>
            <option value={10}>Mostrar 10</option>
            <option value={20}>Mostrar 20</option>
            <option value={50}>Mostrar 50</option>
          </select>
          <span>Total: {totalItems} Itens</span>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ plcState, variables = [], cameras = [], currentUser, generalConfig = {}, onRefresh, onRequireLogin }) {
  const { width, containerRef } = useContainerWidth();
  const [isEditing, setIsEditing] = useState(false);
  const [currentLayout, setCurrentLayout] = useState([]);
  const [historyData, setHistoryData] = useState({});
  const [inputValues, setInputValues] = useState({});
  const [snapKey, setSnapKey] = useState(0);

  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [lastReadTimes, setLastReadTimes] = useState({});
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobileView = windowWidth <= 768;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const fullLayout = useMemo(() => {
    const varItems = variables.map((v, index) => {
      let l = {};
      try { l = JSON.parse(v.grid_layout || '{}'); } catch (e) {}
      return {
        i: 'var-' + v.id.toString(),
        x: l.x !== undefined ? l.x : (index * 3) % 12,
        y: l.y !== undefined ? l.y : Math.floor((index * 3) / 12) * 2,
        w: l.w || 3,
        h: l.h || 2,
        minW: 1, minH: 2
      };
    });

    const camItems = cameras.map((c, index) => {
      let l = {};
      try { l = JSON.parse(c.grid_layout || '{}'); } catch (e) {}
      return {
        i: 'cam-' + c.id.toString(),
        x: l.x !== undefined ? l.x : (index * 4) % 12,
        y: l.y !== undefined ? l.y : Math.floor((index * 4) / 12) * 3 + 10,
        w: l.w || 4,
        h: l.h || 3,
        minW: 1, minH: 2
      };
    });

    return [...varItems, ...camItems];
  }, [variables, cameras]);

  const [timeRanges, setTimeRanges] = useState(() => {
    try {
      const saved = localStorage.getItem('kronox_graph_timeranges');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const handleTimeRangeChange = (varId, minutes) => {
    setTimeRanges(prev => {
      const next = { ...prev, [varId]: minutes };
      try {
        localStorage.setItem('kronox_graph_timeranges', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      if (window.location.port === '5173') return '';
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
    }
    return 'http://localhost:3001';
  };

  const formatTimeAgo = (lastMs) => {
    if (!lastMs) return 'Sem leitura';
    const seconds = Math.max(0, Math.floor((nowMs - lastMs) / 1000));
    if (seconds < 60) return `Há ${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Há ${minutes} m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Há ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Há ${days} d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `Há ${months} ${months === 1 ? 'mês' : 'meses'}`;
    const years = Math.floor(days / 365);
    return `Há ${years} ${years === 1 ? 'ano' : 'anos'}`;
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      let d;
      if (typeof ts === 'string' && !ts.includes('Z') && !ts.includes('+')) {
        d = new Date(ts.replace(' ', 'T') + 'Z');
      } else {
        d = new Date(ts);
      }
      if (isNaN(d.getTime())) return String(ts);
      const tz = generalConfig?.timezone || 'America/Sao_Paulo';
      return d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return String(ts);
    }
  };

  const getFilteredGraphData = (varId) => {
    const rawData = historyData[varId] || [];
    const minutes = timeRanges[varId] !== undefined ? timeRanges[varId] : 10;
    const cutoffMs = Date.now() - minutes * 60 * 1000;
    const filtered = rawData.filter(d => !d.raw_ts || d.raw_ts >= cutoffMs);
    
    // Otimização para gráficos de alta performance: decimação/downsampling de pontos SVG (máx. 150 pontos)
    if (filtered.length <= 150) return filtered;
    const step = Math.ceil(filtered.length / 150);
    const sampled = [];
    for (let i = 0; i < filtered.length; i += step) {
      sampled.push(filtered[i]);
    }
    if (sampled[sampled.length - 1] !== filtered[filtered.length - 1]) {
      sampled.push(filtered[filtered.length - 1]);
    }
    return sampled;
  };

  // Carregar histórico das variáveis do tipo gráfico e tabela (limite otimizado para 2000 registros)
  useEffect(() => {
    const graphVars = variables.filter(v => v.widget_type === 'graph' || v.widget_type === 'timeseries' || v.widget_type === 'table');
    graphVars.forEach(v => {
      fetch(getBaseUrl() + `/api/history/${v.id}?limit=2000`)
        .then(res => res.json())
        .then(data => {
          setHistoryData(prev => ({
            ...prev,
            [v.id]: data.map(d => {
              const dObj = new Date(d.timestamp && !d.timestamp.includes('Z') && !d.timestamp.includes('+') ? d.timestamp.replace(' ', 'T') + 'Z' : d.timestamp);
              return {
                time: formatTime(d.timestamp),
                val: d.value,
                raw_ts: isNaN(dObj.getTime()) ? Date.now() : dObj.getTime()
              };
            })
          }));
        })
        .catch(console.error);
    });
  }, [variables, generalConfig?.timezone]);

  // Atualizar o gráfico e tempos de leitura em tempo real a cada leitura
  useEffect(() => {
    if (!plcState) return;
    const tz = generalConfig?.timezone || 'America/Sao_Paulo';
    const nowTime = new Date().toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const nowMs = Date.now();

    setLastReadTimes(prev => {
      const next = { ...prev };
      variables.forEach(v => {
        if (plcState[v.name] !== undefined) {
          next[v.name] = nowMs;
        }
      });
      return next;
    });

    setHistoryData(prev => {
      const next = { ...prev };
      let updated = false;
      variables.forEach(v => {
        if (v.widget_type === 'graph' || v.widget_type === 'timeseries' || v.widget_type === 'table') {
          const rawVal = plcState[v.name];
          if (rawVal !== undefined) {
            const val = rawVal;
            const currentArr = next[v.id] || [];
            const newArr = [...currentArr, { time: nowTime, val, raw_ts: nowMs }];
            if (newArr.length > 2000) newArr.shift();
            next[v.id] = newArr;
            updated = true;
          }
        }
      });
      return updated ? next : prev;
    });
  }, [plcState, variables, generalConfig?.timezone]);

  // Armazena o layout atual conforme o usuário arrasta
  const handleLayoutChange = (layout) => {
    setCurrentLayout(layout);
  };

  const saveLayout = async () => {
    try {
      const promises = currentLayout.map(item => {
        const newLayout = { x: item.x, y: item.y, w: item.w, h: item.h };
        if (item.i.startsWith('var-')) {
          const id = item.i.replace('var-', '');
          const v = variables.find(varItem => varItem.id.toString() === id);
          if (v) {
            return fetch(getBaseUrl() + `/api/variables/${v.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ grid_layout: newLayout })
            });
          }
        } else if (item.i.startsWith('cam-')) {
          const id = item.i.replace('cam-', '');
          const c = cameras.find(cam => cam.id.toString() === id);
          if (c) {
            return fetch(getBaseUrl() + `/api/cameras/${c.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ grid_layout: newLayout })
            });
          }
        }
        return Promise.resolve();
      });

      await Promise.all(promises);
      if (onRefresh) await onRefresh();
      setSnapCounter(c => c + 1);
    } catch (e) {
      console.error('Erro ao salvar layout', e);
    } finally {
      setIsEditing(false);
    }
  };

  const handleToggleSwitch = async (variable, currentValue) => {
    const newValue = !currentValue;
    try {
      await fetch(getBaseUrl() + '/api/modbus/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: variable.device_id,
          modbus_type: variable.modbus_type,
          address: variable.modbus_address,
          value: newValue,
          decimals: variable.decimals
        })
      });
    } catch (e) {
      console.error('Erro ao alternar switch', e);
    }
  };

  const handleWriteModbus = async (variable) => {
    const value = inputValues[variable.id];
    if (value === undefined || value === '') return;
    try {
      await fetch(getBaseUrl() + '/api/modbus/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: variable.device_id,
          modbus_type: variable.modbus_type,
          address: variable.modbus_address,
          value: parseFloat(value),
          decimals: variable.decimals
        })
      });
      setInputValues(prev => ({ ...prev, [variable.id]: '' }));
    } catch (e) {
      console.error('Erro ao escrever valor', e);
    }
  };

  return (
    <div>
      {/* Control Bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button 
          className={`btn ${isEditing ? 'btn-primary' : ''}`} 
          style={!isEditing ? { background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' } : {}}
          onClick={() => {
            if (!isEditing) {
              if (!currentUser) {
                if (onRequireLogin) onRequireLogin();
                return;
              }
              if (currentUser.role !== 'admin') {
                alert('Acesso Restrito: Apenas Administradores podem editar o layout do Dashboard.');
                return;
              }
              setIsEditing(true);
            } else {
              saveLayout();
            }
          }}
        >
          {isEditing ? <Check size={16} /> : <Edit2 size={16} />}
          {isEditing ? 'Salvar Layout' : 'Editar'}
        </button>
      </div>

      {variables.length === 0 && cameras.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Nenhuma variável ou câmera configurada. Vá para a aba <strong>Configuração</strong> para adicionar itens.
        </div>
      ) : (
        <div ref={containerRef} style={{ width: '100%', minHeight: '500px' }}>
          {isMobileView ? (
            <div className="dashboard-grid-mobile" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
              {variables.map((v, index) => {
                let l = {};
                try { l = JSON.parse(v.grid_layout || '{}'); } catch (e) {}
                const gridProps = {
                  x: l.x !== undefined ? l.x : (index * 3) % 12,
                  y: l.y !== undefined ? l.y : Math.floor((index * 3) / 12) * 2,
                  w: l.w || 3,
                  h: l.h || 2,
                  minW: 1, minH: 2
                };
                let opts = {};
                try {
                  opts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
                } catch(e) {}

                const val = plcState[v.name] !== undefined ? plcState[v.name] : 0;
                
                let isBitActive = Boolean(val);
                if ((v.modbus_type === 'holding' || v.modbus_type === 'input') && opts.bit_index !== undefined && opts.bit_index >= 0) {
                  isBitActive = (parseInt(val) & (1 << opts.bit_index)) !== 0;
                }

                return (
                  <div key={'var-' + v.id.toString()} className="card" style={{ width: '100%', minHeight: '170px', display: 'flex', flexDirection: 'column', padding: '1rem', borderTop: `4px solid ${v.color || 'var(--color-primary)'}` }}>
                    <div className="card-header" style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="card-title" style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Activity size={16} color={v.color || "var(--color-primary)"} />
                        {v.display_name}
                      </div>
                      {(v.widget_type === 'graph' || v.widget_type === 'timeseries') && (
                        <select 
                          value={timeRanges[v.id] !== undefined ? timeRanges[v.id] : 10} 
                          onChange={(e) => handleTimeRangeChange(v.id, parseInt(e.target.value))}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '2px solid #06b6d4',
                            color: 'var(--text-secondary)',
                            fontSize: '0.82rem',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            outline: 'none',
                            fontWeight: 500
                          }}
                        >
                          <option value={1} style={{ background: '#0b0f19', color: '#f8fafc' }}>1 minuto</option>
                          <option value={5} style={{ background: '#0b0f19', color: '#f8fafc' }}>5 minutos</option>
                          <option value={10} style={{ background: '#0b0f19', color: '#f8fafc' }}>10 minutos</option>
                          <option value={30} style={{ background: '#0b0f19', color: '#f8fafc' }}>30 minutos</option>
                          <option value={60} style={{ background: '#0b0f19', color: '#f8fafc' }}>1 hora</option>
                          <option value={1440} style={{ background: '#0b0f19', color: '#f8fafc' }}>24 horas</option>
                          <option value={10080} style={{ background: '#0b0f19', color: '#f8fafc' }}>7 dias</option>
                        </select>
                      )}
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                      
                      {/* 1. VALUE / GAUGE DE VALOR */}
                      {(v.widget_type === 'value' || v.widget_type === 'value_gauge') && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                            {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}
                            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>{v.unit}</span>
                          </div>
                        </div>
                      )}

                      {/* 2. RADIAL GAUGE / MEDIDOR RADIAL (SEMICÍRCULO) */}
                      {(v.widget_type === 'gauge' || v.widget_type === 'radial_gauge') && (() => {
                        const minVal = opts.min_val !== undefined ? opts.min_val : 0;
                        const maxVal = opts.max_val !== undefined ? opts.max_val : 100;
                        const range = (maxVal - minVal) > 0 ? (maxVal - minVal) : 100;
                        const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
                        const pct = Math.min(Math.max(((numVal - minVal) / range), 0), 1);
                        
                        const arcLength = 204.2;
                        const strokeDashoffset = arcLength * (1 - pct);

                        return (
                          <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ position: 'relative', width: '170px', height: '95px', display: 'flex', justifyContent: 'center' }}>
                              <svg viewBox="0 0 180 105" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                                <path 
                                  d="M 25 90 A 65 65 0 0 1 155 90" 
                                  fill="none" 
                                  stroke="rgba(255, 255, 255, 0.08)" 
                                  strokeWidth="15" 
                                  strokeLinecap="round"
                                />
                                <path 
                                  d="M 25 90 A 65 65 0 0 1 155 90" 
                                  fill="none" 
                                  stroke={v.color || '#06b6d4'} 
                                  strokeWidth="15" 
                                  strokeLinecap="round"
                                  strokeDasharray={arcLength}
                                  strokeDashoffset={strokeDashoffset}
                                  style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                                />
                              </svg>
                              
                              <div style={{ position: 'absolute', bottom: '10px', textAlign: 'center', width: '100%' }}>
                                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'white', lineHeight: '1' }}>
                                  {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>{v.unit}</span>
                                </div>
                              </div>

                              <div style={{ position: 'absolute', bottom: '-8px', left: '10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {minVal}
                              </div>
                              <div style={{ position: 'absolute', bottom: '-8px', right: '10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {maxVal}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* 3. TIMESERIES / GRÁFICO SÉRIE TEMPORAL */}
                      {(v.widget_type === 'graph' || v.widget_type === 'timeseries') && (
                        <div style={{ width: '100%', height: '100%', minHeight: '100px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={getFilteredGraphData(v.id)}>
                              <XAxis dataKey="time" hide />
                              <YAxis domain={['auto', 'auto']} hide />
                              <Tooltip contentStyle={{ background: '#0b0f19', borderColor: 'var(--border-color)', borderRadius: '8px' }} />
                              <Line type="monotone" dataKey="val" stroke={v.color || '#3b82f6'} strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* 4. DONUT CHART */}
                      {v.widget_type === 'donut' && (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={[{ name: 'Valor', value: Math.min(Math.max(val, 0), opts.max_val || 100) }, { name: 'Restante', value: Math.max((opts.max_val || 100) - Math.min(Math.max(val, 0), opts.max_val || 100), 0) }]} cx="50%" cy="50%" innerRadius={28} outerRadius={42} paddingAngle={4} dataKey="value">
                                <Cell key="val" fill={v.color || '#06b6d4'} />
                                <Cell key="rest" fill="rgba(255,255,255,0.08)" />
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                          <div style={{ position: 'absolute', fontSize: '0.9rem', fontWeight: 'bold', color: 'white' }}>
                            {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}{v.unit}
                          </div>
                        </div>
                      )}

                      {/* 5. BITMAP / STATUS */}
                      {(v.widget_type === 'switch' || v.widget_type === 'bitmap') && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                          <div 
                            style={{ 
                              padding: '0.75rem 1.5rem', borderRadius: '30px', fontSize: '1.1rem', fontWeight: 'bold',
                              border: `2px solid ${isBitActive ? (opts.color_on || v.color || '#22c55e') : (opts.color_off || 'var(--border-color)')}`, 
                              color: isBitActive ? (opts.color_on || v.color || '#22c55e') : (opts.color_off || 'var(--text-secondary)'),
                              background: isBitActive ? `${opts.color_on || v.color || '#22c55e'}15` : 'var(--bg-subcard)',
                              display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: isBitActive ? `0 0 15px ${opts.color_on || v.color || '#22c55e'}40` : 'none'
                            }}
                          >
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: isBitActive ? (opts.color_on || v.color || '#22c55e') : (opts.color_off || 'var(--text-muted)'), boxShadow: isBitActive ? `0 0 10px ${opts.color_on || v.color || '#22c55e'}` : 'none' }}></div> 
                            {isBitActive ? (opts.label_on || 'LIGADO') : (opts.label_off || 'DESLIGADO')}
                          </div>
                          {(v.modbus_type === 'holding' || v.modbus_type === 'input') && opts.bit_index >= 0 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                              Mapeado: Bit #{opts.bit_index} da Word
                            </div>
                          )}
                        </div>
                      )}

                      {/* 6. LEVEL INDICATOR / TANK */}
                      {(v.widget_type === 'tank' || v.widget_type === 'level_indicator') && (() => {
                        const minVal = opts.min_val !== undefined ? opts.min_val : 0;
                        const maxVal = opts.max_val !== undefined ? opts.max_val : 100;
                        const range = (maxVal - minVal) > 0 ? (maxVal - minVal) : 100;
                        const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
                        const pct = Math.min(Math.max(((numVal - minVal) / range) * 100, 0), 100);

                        return (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '1.25rem', height: '100%', width: '100%', paddingLeft: '1.25rem' }}>
                            <div style={{
                              position: 'relative', width: '38px', minWidth: '38px', flexShrink: 0, height: '85%', minHeight: '80px',
                              background: 'rgba(0, 0, 0, 0.5)', borderRadius: '12px', border: '2px solid var(--border-highlight)',
                              overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)'
                            }}>
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10% 0', pointerEvents: 'none' }}>
                                {[...Array(5)].map((_, i) => (
                                  <div key={i} style={{ width: '100%', borderTop: '1px dashed rgba(255,255,255,0.2)' }}></div>
                                ))}
                              </div>
                              <div style={{
                                width: '100%', height: `${pct}%`,
                                background: `linear-gradient(180deg, ${v.color || '#0ea5e9'} 0%, rgba(14,165,233,0.8) 100%)`,
                                transition: 'height 0.4s ease', boxShadow: `0 -4px 12px ${v.color || '#0ea5e9'}60`, position: 'relative'
                              }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'rgba(255, 255, 255, 0.7)' }}></div>
                              </div>
                            </div>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: v.color || '#0ea5e9', whiteSpace: 'nowrap' }}>
                              {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}<span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>{v.unit}</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* 7. WRITE BUTTON / INPUT */}
                      {(v.widget_type === 'input' || v.widget_type === 'write_button') && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 0.5rem', width: '100%' }}>
                          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: v.color || 'var(--text-primary)', marginBottom: '0.4rem' }}>
                            {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>{v.unit}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                            <input 
                              type="number" 
                              className="form-input" 
                              placeholder="Novo valor..."
                              value={inputValues[v.id] !== undefined ? inputValues[v.id] : ''}
                              onChange={(e) => setInputValues({ ...inputValues, [v.id]: e.target.value })}
                              style={{ flex: 1, padding: '0.4rem', fontSize: '0.9rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white' }}
                            />
                            <button 
                              className="btn btn-primary" 
                              onClick={() => handleWriteModbus(v)}
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                            >
                              Escrever Modbus
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 8. HORIZONTAL BAR */}
                      {v.widget_type === 'horizontal_bar' && (
                        <div style={{ width: '100%', padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center', height: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Progresso / Escala</span>
                            <strong style={{ color: v.color || '#3b82f6' }}>{typeof val === 'number' ? val.toFixed(v.decimals || 0) : val} {v.unit}</strong>
                          </div>
                          <div style={{ width: '100%', height: '14px', background: 'rgba(0,0,0,0.4)', borderRadius: '7px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <div style={{ width: `${Math.min(Math.max((typeof val === 'number' ? val : 0), 0), 100)}%`, height: '100%', background: v.color || '#3b82f6', borderRadius: '7px', transition: 'width 0.5s ease' }}></div>
                          </div>
                        </div>
                      )}

                      {/* 9. TABLE */}
                      {v.widget_type === 'table' && (
                        <TableWidget v={v} val={val} history={historyData[v.id] || []} />
                      )}

                      {/* 10. VARIABLE LIST */}
                      {v.widget_type === 'variable_list' && (
                        <div style={{ width: '100%', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', justifyContent: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                            <span>PV Atual</span>
                            <strong style={{ color: v.color || '#3b82f6' }}>{val} {v.unit}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                            <span>Modbus Endereço</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{v.modbus_type} #{v.modbus_address}</span>
                          </div>
                        </div>
                      )}

                      {/* 10.1 LISTA MULTIBIT */}
                      {v.widget_type === 'multibit_list' && (() => {
                        const mainWordVal = typeof val === 'number' ? Math.floor(val) : (parseInt(val) || 0);
                        const items = (opts.multibit_items && opts.multibit_items.length > 0) ? opts.multibit_items : [
                          { bit: 0, name: 'Status Alagamento', label_off: 'Sem Alagamento', label_on: 'ALAGAMENTO!', color_on: '#ef4444' },
                          { bit: 1, name: 'Status Extravasão', label_off: 'Sem Extravasão', label_on: 'EXTRAVASÃO!', color_on: '#ef4444' },
                          { bit: 2, name: 'Status Emergência', label_off: 'Não acionado', label_on: 'EMERGÊNCIA!', color_on: '#ef4444' },
                          { bit: 3, name: 'Status Falta de Fase', label_off: 'Fases OK', label_on: 'FALTA DE FASE!', color_on: '#f59e0b' },
                          { bit: 4, name: 'Status DPS', label_off: 'DPS OK', label_on: 'DPS ATUADO!', color_on: '#f59e0b' },
                          { bit: 5, name: 'Falha B1', label_off: 'Sem Falha', label_on: 'FALHA B1!', color_on: '#ef4444' },
                          { bit: 6, name: 'Falha B2', label_off: 'Sem Falha', label_on: 'FALHA B2!', color_on: '#ef4444' },
                          { bit: 7, name: 'Boia Drenagem Atuada', label_off: 'Não Atuada', label_on: 'BOIA ATUADA!', color_on: '#f59e0b' },
                        ];

                        return (
                          <div style={{ width: '100%', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.2rem 0.4rem' }}>
                            {items.map((item, idx) => {
                              let isBitActive = false;
                              if (item.variable_id) {
                                const targetV = variables.find(varObj => varObj.id === item.variable_id);
                                if (targetV && plcState && plcState[targetV.name] !== undefined) {
                                  const rawTargetVal = plcState[targetV.name];
                                  if (targetV.type === 'boolean' || targetV.modbus_type === 'coil' || targetV.modbus_type === 'discrete') {
                                    isBitActive = Boolean(rawTargetVal);
                                  } else {
                                    const numW = typeof rawTargetVal === 'number' ? Math.floor(rawTargetVal) : (parseInt(rawTargetVal) || 0);
                                    isBitActive = Boolean((numW >> (item.bit || 0)) & 1);
                                  }
                                }
                              } else {
                                isBitActive = Boolean((mainWordVal >> (item.bit || 0)) & 1);
                              }

                              const activeLabel = isBitActive ? (item.label_on || 'ATIVADO') : (item.label_off || 'NORMAL');
                              const activeColor = isBitActive ? (item.color_on || v.color || '#ef4444') : (item.color_off || 'var(--text-secondary)');
                              const bgPill = isBitActive ? `${activeColor}25` : 'rgba(255, 255, 255, 0.06)';
                              const borderPill = isBitActive ? `1px solid ${activeColor}` : '1px solid rgba(255, 255, 255, 0.05)';

                              return (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.85rem' }}>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.name}</span>
                                  <span style={{
                                    background: bgPill,
                                    border: borderPill,
                                    color: activeColor,
                                    padding: '0.25rem 0.85rem',
                                    borderRadius: '16px',
                                    fontSize: '0.8rem',
                                    fontWeight: isBitActive ? 600 : 400,
                                    boxShadow: isBitActive ? `0 0 10px ${activeColor}30` : 'none',
                                    transition: 'all 0.3s ease'
                                  }}>
                                    {activeLabel}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* 11. EXTERNAL LINK */}
                      {v.widget_type === 'external_link' && (() => {
                        const rawUrl = opts.url || v.unit || '';
                        let targetUrl = rawUrl.trim();
                        if (targetUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                          targetUrl = 'https://' + targetUrl;
                        }

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.5rem' }}>
                            <LinkIcon size={28} color={v.color || '#3b82f6'} />
                            <button
                              className="btn btn-primary"
                              onClick={() => {
                                if (targetUrl) {
                                  window.open(targetUrl, '_blank', 'noopener,noreferrer');
                                }
                              }}
                              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', cursor: 'pointer' }}
                            >
                              Abrir Link Externo
                            </button>
                          </div>
                        );
                      })()}

                      {/* 12. GEOLOCATION */}
                      {v.widget_type === 'geolocation' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.4rem', textAlign: 'center' }}>
                          <MapPin size={28} color={v.color || '#ef4444'} />
                          <div style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Estação Elevatória Central</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>GPS: -23.5505, -46.6333</div>
                        </div>
                      )}

                      {/* 13. IMAGE OVERLAY / SYNOPTIC */}
                      {v.widget_type === 'image_overlay' && (
                        <div style={{ position: 'relative', width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ImageIcon size={32} color="var(--text-muted)" />
                          <div style={{ position: 'absolute', top: '10px', right: '10px', background: v.color || '#3b82f6', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                            {val} {v.unit}
                          </div>
                        </div>
                      )}

                      {/* 14. COMPARATIVE ANALYSIS */}
                      {v.widget_type === 'comparative_analysis' && (
                        <div style={{ width: '100%', height: '100%' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[{ name: 'Atual', val: val }, { name: 'Setpoint', val: (val * 1.1) }]}>
                              <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                              <YAxis hide />
                              <Bar dataKey="val" fill={v.color || '#3b82f6'} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* 15. SCATTER */}
                      {v.widget_type === 'scatter' && (
                        <div style={{ width: '100%', height: '100%' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart>
                              <XAxis type="number" dataKey="x" name="Tempo" hide />
                              <YAxis type="number" dataKey="y" name="Valor" hide />
                              <Scatter name="Dados" data={[{ x: 1, y: val }, { x: 2, y: val*0.9 }, { x: 3, y: val*1.05 }]} fill={v.color || '#3b82f6'} />
                            </ScatterChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* 16. HEATMAP */}
                      {v.widget_type === 'heatmap' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', width: '100%', padding: '0.5rem' }}>
                          {[...Array(8)].map((_, i) => (
                            <div key={i} style={{ height: '24px', borderRadius: '4px', background: i % 2 === 0 ? (v.color || '#3b82f6') : 'rgba(255,255,255,0.05)', opacity: (i + 1) * 0.12 + 0.2 }}></div>
                          ))}
                        </div>
                      )}

                      {/* 17. TIMELINE */}
                      {v.widget_type === 'timeline' && (
                        <div style={{ width: '100%', padding: '0 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', justifyContent: 'center' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status da Operação</div>
                          <div style={{ display: 'flex', gap: '2px', height: '18px', width: '100%', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ flex: 3, background: 'var(--color-normal)' }}></div>
                            <div style={{ flex: 1, background: 'var(--color-warning)' }}></div>
                            <div style={{ flex: 4, background: v.color || '#3b82f6' }}></div>
                          </div>
                        </div>
                      )}

                      {/* 18. HEADER */}
                      {v.widget_type === 'header' && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: v.color || 'var(--color-primary)' }}>
                            {v.display_name}
                          </h3>
                        </div>
                      )}

                    </div>

                    {v.widget_type !== 'header' && (
                      <div style={{ position: 'absolute', bottom: '6px', right: '10px', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', pointerEvents: 'none' }}>
                        <Clock size={10} />
                        {formatTimeAgo(lastReadTimes[v.name])}
                      </div>
                    )}
                  </div>
                );
              })}

              {cameras.map((c, index) => {
                return (
                  <div key={'cam-' + c.id.toString()} className="card" style={{ width: '100%', height: '240px', padding: '0', overflow: 'hidden' }}>
                    <div className="card-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.5)', zIndex: 10, margin: 0, borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 className="card-title" style={{ color: 'white', margin: 0, fontSize: '0.875rem' }}>{c.name}</h3>
                    </div>
                    <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {c.url ? (
                        <iframe src={c.url} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={c.name}></iframe>
                      ) : (
                        <div style={{ color: 'var(--text-secondary)' }}>Sem sinal (URL inválida)</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <ResponsiveGridLayout
              key={isEditing ? 'grid-edit' : `grid-view-${snapKey}`}
              className="layout"
              width={width || 1200}
              layouts={{ lg: fullLayout, md: fullLayout, sm: fullLayout, xs: fullLayout, xxs: fullLayout }}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 767, xxs: 0 }}
              cols={{ lg: 12, md: 10, sm: 6, xs: 1, xxs: 1 }}
              rowHeight={100}
              isDraggable={true}
              isResizable={isEditing}
              onLayoutChange={handleLayoutChange}
              onDragStop={() => {
                if (!isEditing) {
                  // Efeito mola: remonta o grid com layout original salvo
                  setSnapKey(k => k + 1);
                }
              }}
            >
          {variables.map((v, index) => {
            let l = {};
            try { l = JSON.parse(v.grid_layout || '{}'); } catch (e) {}
            const gridProps = {
              x: l.x !== undefined ? l.x : (index * 3) % 12,
              y: l.y !== undefined ? l.y : Math.floor((index * 3) / 12) * 2,
              w: l.w || 3,
              h: l.h || 2,
              minW: 1, minH: 2
            };
            let opts = {};
            try {
              opts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
            } catch(e) {}

            const val = plcState[v.name] !== undefined ? plcState[v.name] : 0;
            
            // Evaluation of boolean / bit value based on bit_index option
            let isBitActive = Boolean(val);
            if ((v.modbus_type === 'holding' || v.modbus_type === 'input') && opts.bit_index !== undefined && opts.bit_index >= 0) {
              isBitActive = (parseInt(val) & (1 << opts.bit_index)) !== 0;
            }

            return (
              <div key={'var-' + v.id.toString()} className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '1rem', borderTop: `4px solid ${v.color || 'var(--color-primary)'}` }}>
                <div className="card-header" style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="card-title" style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Activity size={16} color={v.color || "var(--color-primary)"} />
                    {v.display_name}
                  </div>
                  {(v.widget_type === 'graph' || v.widget_type === 'timeseries') && (
                    <select 
                      value={timeRanges[v.id] !== undefined ? timeRanges[v.id] : 10} 
                      onChange={(e) => handleTimeRangeChange(v.id, parseInt(e.target.value))}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '2px solid #06b6d4',
                        color: 'var(--text-secondary)',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        outline: 'none',
                        fontWeight: 500
                      }}
                    >
                      <option value={1} style={{ background: '#0b0f19', color: '#f8fafc' }}>1 minuto</option>
                      <option value={5} style={{ background: '#0b0f19', color: '#f8fafc' }}>5 minutos</option>
                      <option value={10} style={{ background: '#0b0f19', color: '#f8fafc' }}>10 minutos</option>
                      <option value={30} style={{ background: '#0b0f19', color: '#f8fafc' }}>30 minutos</option>
                      <option value={60} style={{ background: '#0b0f19', color: '#f8fafc' }}>1 hora</option>
                      <option value={1440} style={{ background: '#0b0f19', color: '#f8fafc' }}>24 horas</option>
                      <option value={10080} style={{ background: '#0b0f19', color: '#f8fafc' }}>7 dias</option>
                    </select>
                  )}
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                  
                  {/* 1. VALUE / GAUGE DE VALOR */}
                  {(v.widget_type === 'value' || v.widget_type === 'value_gauge') && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                        {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}
                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>{v.unit}</span>
                      </div>
                    </div>
                  )}

                  {/* 2. RADIAL GAUGE / MEDIDOR RADIAL (SEMICÍRCULO) */}
                  {(v.widget_type === 'gauge' || v.widget_type === 'radial_gauge') && (() => {
                    const minVal = opts.min_val !== undefined ? opts.min_val : 0;
                    const maxVal = opts.max_val !== undefined ? opts.max_val : 100;
                    const range = (maxVal - minVal) > 0 ? (maxVal - minVal) : 100;
                    const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
                    const pct = Math.min(Math.max(((numVal - minVal) / range), 0), 1);
                    
                    // Semi-circle Arc length for R=65 (PI * 65 ≈ 204.2)
                    const arcLength = 204.2;
                    const strokeDashoffset = arcLength * (1 - pct);

                    return (
                      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ position: 'relative', width: '170px', height: '95px', display: 'flex', justifyContent: 'center' }}>
                          <svg viewBox="0 0 180 105" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                            {/* Track Arc */}
                            <path 
                              d="M 25 90 A 65 65 0 0 1 155 90" 
                              fill="none" 
                              stroke="rgba(255, 255, 255, 0.08)" 
                              strokeWidth="15" 
                              strokeLinecap="round"
                            />
                            {/* Value Filled Arc */}
                            <path 
                              d="M 25 90 A 65 65 0 0 1 155 90" 
                              fill="none" 
                              stroke={v.color || '#06b6d4'} 
                              strokeWidth="15" 
                              strokeLinecap="round"
                              strokeDasharray={arcLength}
                              strokeDashoffset={strokeDashoffset}
                              style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                            />
                          </svg>
                          
                          {/* Value Text centered inside arc */}
                          <div style={{ position: 'absolute', bottom: '10px', textAlign: 'center', width: '100%' }}>
                            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'white', lineHeight: '1' }}>
                              {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>{v.unit}</span>
                            </div>
                          </div>

                          {/* Min and Max Labels at Arc ends */}
                          <div style={{ position: 'absolute', bottom: '-8px', left: '10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {minVal}
                          </div>
                          <div style={{ position: 'absolute', bottom: '-8px', right: '10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {maxVal}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 3. TIMESERIES / GRÁFICO SÉRIE TEMPORAL */}
                  {(v.widget_type === 'graph' || v.widget_type === 'timeseries') && (
                    <div style={{ width: '100%', height: '100%', minHeight: '100px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={getFilteredGraphData(v.id)}>
                          <XAxis dataKey="time" hide />
                          <YAxis domain={['auto', 'auto']} hide />
                          <Tooltip contentStyle={{ background: '#0b0f19', borderColor: 'var(--border-color)', borderRadius: '8px' }} />
                          <Line type="monotone" dataKey="val" stroke={v.color || '#3b82f6'} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* 4. DONUT CHART */}
                  {v.widget_type === 'donut' && (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={[{ name: 'Valor', value: Math.min(Math.max(val, 0), opts.max_val || 100) }, { name: 'Restante', value: Math.max((opts.max_val || 100) - Math.min(Math.max(val, 0), opts.max_val || 100), 0) }]} cx="50%" cy="50%" innerRadius={28} outerRadius={42} paddingAngle={4} dataKey="value">
                            <Cell key="val" fill={v.color || '#06b6d4'} />
                            <Cell key="rest" fill="rgba(255,255,255,0.08)" />
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ position: 'absolute', fontSize: '0.9rem', fontWeight: 'bold', color: 'white' }}>
                        {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}{v.unit}
                      </div>
                    </div>
                  )}

                  {/* 5. BITMAP / STATUS */}
                  {(v.widget_type === 'switch' || v.widget_type === 'bitmap') && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <div 
                        style={{ 
                          padding: '0.75rem 1.5rem', borderRadius: '30px', fontSize: '1.1rem', fontWeight: 'bold',
                          border: `2px solid ${isBitActive ? (opts.color_on || v.color || '#22c55e') : (opts.color_off || 'var(--border-color)')}`, 
                          color: isBitActive ? (opts.color_on || v.color || '#22c55e') : (opts.color_off || 'var(--text-secondary)'),
                          background: isBitActive ? `${opts.color_on || v.color || '#22c55e'}15` : 'var(--bg-subcard)',
                          display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: isBitActive ? `0 0 15px ${opts.color_on || v.color || '#22c55e'}40` : 'none'
                        }}
                      >
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: isBitActive ? (opts.color_on || v.color || '#22c55e') : (opts.color_off || 'var(--text-muted)'), boxShadow: isBitActive ? `0 0 10px ${opts.color_on || v.color || '#22c55e'}` : 'none' }}></div> 
                        {isBitActive ? (opts.label_on || 'LIGADO') : (opts.label_off || 'DESLIGADO')}
                      </div>
                      {(v.modbus_type === 'holding' || v.modbus_type === 'input') && opts.bit_index >= 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                          Mapeado: Bit #{opts.bit_index} da Word
                        </div>
                      )}
                    </div>
                  )}

                  {/* 6. LEVEL INDICATOR / TANK */}
                  {(v.widget_type === 'tank' || v.widget_type === 'level_indicator') && (() => {
                    const minVal = opts.min_val !== undefined ? opts.min_val : 0;
                    const maxVal = opts.max_val !== undefined ? opts.max_val : 100;
                    const range = (maxVal - minVal) > 0 ? (maxVal - minVal) : 100;
                    const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
                    const pct = Math.min(Math.max(((numVal - minVal) / range) * 100, 0), 100);

                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '1.25rem', height: '100%', width: '100%', paddingLeft: '1.25rem' }}>
                        <div style={{
                          position: 'relative', width: '38px', minWidth: '38px', flexShrink: 0, height: '85%', minHeight: '80px',
                          background: 'rgba(0, 0, 0, 0.5)', borderRadius: '12px', border: '2px solid var(--border-highlight)',
                          overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)'
                        }}>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10% 0', pointerEvents: 'none' }}>
                            {[...Array(5)].map((_, i) => (
                              <div key={i} style={{ width: '100%', borderTop: '1px dashed rgba(255,255,255,0.2)' }}></div>
                            ))}
                          </div>
                          <div style={{
                            width: '100%', height: `${pct}%`,
                            background: `linear-gradient(180deg, ${v.color || '#0ea5e9'} 0%, rgba(14,165,233,0.8) 100%)`,
                            transition: 'height 0.4s ease', boxShadow: `0 -4px 12px ${v.color || '#0ea5e9'}60`, position: 'relative'
                          }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'rgba(255, 255, 255, 0.7)' }}></div>
                          </div>
                        </div>
                        <div style={{ fontSize: '2rem', fontWeight: 'bold', color: v.color || '#0ea5e9', whiteSpace: 'nowrap' }}>
                          {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}<span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>{v.unit}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 7. WRITE BUTTON / INPUT */}
                  {(v.widget_type === 'input' || v.widget_type === 'write_button') && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 0.5rem', width: '100%' }}>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: v.color || 'var(--text-primary)', marginBottom: '0.4rem' }}>
                        {typeof val === 'number' ? val.toFixed(v.decimals || 0) : val}
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>{v.unit}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          placeholder="Novo valor..."
                          value={inputValues[v.id] !== undefined ? inputValues[v.id] : ''}
                          onChange={(e) => setInputValues({ ...inputValues, [v.id]: e.target.value })}
                          style={{ flex: 1, padding: '0.4rem', fontSize: '0.9rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white' }}
                        />
                        <button 
                          className="btn btn-primary" 
                          onClick={() => handleWriteModbus(v)}
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                        >
                          Escrever Modbus
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 8. HORIZONTAL BAR */}
                  {v.widget_type === 'horizontal_bar' && (
                    <div style={{ width: '100%', padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center', height: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Progresso / Escala</span>
                        <strong style={{ color: v.color || '#3b82f6' }}>{typeof val === 'number' ? val.toFixed(v.decimals || 0) : val} {v.unit}</strong>
                      </div>
                      <div style={{ width: '100%', height: '14px', background: 'rgba(0,0,0,0.4)', borderRadius: '7px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ width: `${Math.min(Math.max((typeof val === 'number' ? val : 0), 0), 100)}%`, height: '100%', background: v.color || '#3b82f6', borderRadius: '7px', transition: 'width 0.5s ease' }}></div>
                      </div>
                    </div>
                  )}

                  {/* 9. TABLE */}
                  {v.widget_type === 'table' && (
                    <TableWidget v={v} val={val} history={historyData[v.id] || []} />
                  )}

                  {/* 10. VARIABLE LIST */}
                  {v.widget_type === 'variable_list' && (
                    <div style={{ width: '100%', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                        <span>PV Atual</span>
                        <strong style={{ color: v.color || '#3b82f6' }}>{val} {v.unit}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                        <span>Modbus Endereço</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{v.modbus_type} #{v.modbus_address}</span>
                      </div>
                    </div>
                  )}

                  {/* 10.1 LISTA MULTIBIT (SUPORTA MÚLTIPLAS VARIÁVEIS E BITS) */}
                  {v.widget_type === 'multibit_list' && (() => {
                    const mainWordVal = typeof val === 'number' ? Math.floor(val) : (parseInt(val) || 0);
                    const items = (opts.multibit_items && opts.multibit_items.length > 0) ? opts.multibit_items : [
                      { bit: 0, name: 'Status Alagamento', label_off: 'Sem Alagamento', label_on: 'ALAGAMENTO!', color_on: '#ef4444' },
                      { bit: 1, name: 'Status Extravasão', label_off: 'Sem Extravasão', label_on: 'EXTRAVASÃO!', color_on: '#ef4444' },
                      { bit: 2, name: 'Status Emergência', label_off: 'Não acionado', label_on: 'EMERGÊNCIA!', color_on: '#ef4444' },
                      { bit: 3, name: 'Status Falta de Fase', label_off: 'Fases OK', label_on: 'FALTA DE FASE!', color_on: '#f59e0b' },
                      { bit: 4, name: 'Status DPS', label_off: 'DPS OK', label_on: 'DPS ATUADO!', color_on: '#f59e0b' },
                      { bit: 5, name: 'Falha B1', label_off: 'Sem Falha', label_on: 'FALHA B1!', color_on: '#ef4444' },
                      { bit: 6, name: 'Falha B2', label_off: 'Sem Falha', label_on: 'FALHA B2!', color_on: '#ef4444' },
                      { bit: 7, name: 'Boia Drenagem Atuada', label_off: 'Não Atuada', label_on: 'BOIA ATUADA!', color_on: '#f59e0b' },
                    ];

                    return (
                      <div style={{ width: '100%', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.2rem 0.4rem' }}>
                        {items.map((item, idx) => {
                          let isBitActive = false;
                          if (item.variable_id) {
                            const targetV = variables.find(varObj => varObj.id === item.variable_id);
                            if (targetV && plcState && plcState[targetV.name] !== undefined) {
                              const rawTargetVal = plcState[targetV.name];
                              if (targetV.type === 'boolean' || targetV.modbus_type === 'coil' || targetV.modbus_type === 'discrete') {
                                isBitActive = Boolean(rawTargetVal);
                              } else {
                                const numW = typeof rawTargetVal === 'number' ? Math.floor(rawTargetVal) : (parseInt(rawTargetVal) || 0);
                                isBitActive = Boolean((numW >> (item.bit || 0)) & 1);
                              }
                            }
                          } else {
                            isBitActive = Boolean((mainWordVal >> (item.bit || 0)) & 1);
                          }

                          const activeLabel = isBitActive ? (item.label_on || 'ATIVADO') : (item.label_off || 'NORMAL');
                          const activeColor = isBitActive ? (item.color_on || v.color || '#ef4444') : (item.color_off || 'var(--text-secondary)');
                          const bgPill = isBitActive ? `${activeColor}25` : 'rgba(255, 255, 255, 0.06)';
                          const borderPill = isBitActive ? `1px solid ${activeColor}` : '1px solid rgba(255, 255, 255, 0.05)';

                          return (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.85rem' }}>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.name}</span>
                              <span style={{
                                background: bgPill,
                                border: borderPill,
                                color: activeColor,
                                padding: '0.25rem 0.85rem',
                                borderRadius: '16px',
                                fontSize: '0.8rem',
                                fontWeight: isBitActive ? 600 : 400,
                                boxShadow: isBitActive ? `0 0 10px ${activeColor}30` : 'none',
                                transition: 'all 0.3s ease'
                              }}>
                                {activeLabel}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* 11. EXTERNAL LINK */}
                  {v.widget_type === 'external_link' && (() => {
                    const rawUrl = opts.url || v.unit || '';
                    let targetUrl = rawUrl.trim();
                    if (targetUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                      targetUrl = 'https://' + targetUrl;
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.5rem' }}>
                        <LinkIcon size={28} color={v.color || '#3b82f6'} />
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            if (targetUrl) {
                              window.open(targetUrl, '_blank', 'noopener,noreferrer');
                            }
                          }}
                          style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', cursor: 'pointer' }}
                        >
                          Abrir Link Externo
                        </button>
                      </div>
                    );
                  })()}

                  {/* 12. GEOLOCATION */}
                  {v.widget_type === 'geolocation' && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.4rem', textAlign: 'center' }}>
                      <MapPin size={28} color={v.color || '#ef4444'} />
                      <div style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Estação Elevatória Central</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>GPS: -23.5505, -46.6333</div>
                    </div>
                  )}

                  {/* 13. IMAGE OVERLAY / SYNOPTIC */}
                  {v.widget_type === 'image_overlay' && (
                    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ImageIcon size={32} color="var(--text-muted)" />
                      <div style={{ position: 'absolute', top: '10px', right: '10px', background: v.color || '#3b82f6', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                        {val} {v.unit}
                      </div>
                    </div>
                  )}

                  {/* 14. COMPARATIVE ANALYSIS */}
                  {v.widget_type === 'comparative_analysis' && (
                    <div style={{ width: '100%', height: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={[{ name: 'Atual', val: val }, { name: 'Setpoint', val: (val * 1.1) }]}>
                          <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                          <YAxis hide />
                          <Bar dataKey="val" fill={v.color || '#3b82f6'} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* 15. SCATTER */}
                  {v.widget_type === 'scatter' && (
                    <div style={{ width: '100%', height: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart>
                          <XAxis type="number" dataKey="x" name="Tempo" hide />
                          <YAxis type="number" dataKey="y" name="Valor" hide />
                          <Scatter name="Dados" data={[{ x: 1, y: val }, { x: 2, y: val*0.9 }, { x: 3, y: val*1.05 }]} fill={v.color || '#3b82f6'} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* 16. HEATMAP */}
                  {v.widget_type === 'heatmap' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', width: '100%', padding: '0.5rem' }}>
                      {[...Array(8)].map((_, i) => (
                        <div key={i} style={{ height: '24px', borderRadius: '4px', background: i % 2 === 0 ? (v.color || '#3b82f6') : 'rgba(255,255,255,0.05)', opacity: (i + 1) * 0.12 + 0.2 }}></div>
                      ))}
                    </div>
                  )}

                  {/* 17. TIMELINE */}
                  {v.widget_type === 'timeline' && (
                    <div style={{ width: '100%', padding: '0 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', justifyContent: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status da Operação</div>
                      <div style={{ display: 'flex', gap: '2px', height: '18px', width: '100%', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ flex: 3, background: 'var(--color-normal)' }}></div>
                        <div style={{ flex: 1, background: 'var(--color-warning)' }}></div>
                        <div style={{ flex: 4, background: v.color || '#3b82f6' }}></div>
                      </div>
                    </div>
                  )}

                  {/* 18. HEADER */}
                  {v.widget_type === 'header' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: v.color || 'var(--color-primary)' }}>
                        {v.display_name}
                      </h3>
                    </div>
                  )}

                </div>

                {v.widget_type !== 'header' && (
                  <div style={{ position: 'absolute', bottom: '6px', right: '10px', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', pointerEvents: 'none' }}>
                    <Clock size={10} />
                    {formatTimeAgo(lastReadTimes[v.name])}
                  </div>
                )}
              </div>
            );
          })}

          {/* CAMERAS */}
          {cameras.map((c, index) => {
            let l = {};
            try { l = JSON.parse(c.grid_layout || '{}'); } catch (e) {}
            const gridProps = {
              x: l.x !== undefined ? l.x : (index * 4) % 12,
              y: l.y !== undefined ? l.y : Math.floor((index * 4) / 12) * 3 + 10,
              w: l.w || 4,
              h: l.h || 3,
              minW: 1, minH: 2
            };
            return (
              <div key={'cam-' + c.id.toString()} data-grid={gridProps} className="card" style={{ padding: '0', overflow: 'hidden' }}>
                <div className="card-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.5)', zIndex: 10, margin: 0, borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="card-title" style={{ color: 'white', margin: 0, fontSize: '0.875rem' }}>{c.name}</h3>
                </div>
                <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.url ? (
                    <iframe src={c.url} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={c.name}></iframe>
                  ) : (
                    <div style={{ color: 'var(--text-secondary)' }}>Sem sinal (URL inválida)</div>
                  )}
                </div>
              </div>
            );
          })}
          </ResponsiveGridLayout>
        )}
      </div>
    )}
  </div>
);
}

export default Dashboard;
