import React, { useState, useEffect } from 'react';
import {
  Save, X, Check, Plus, Trash2, Server, Edit2, TrendingUp, PieChart,
  Gauge, Table, List, Link, MapPin, Image, BarChart2, ScatterChart,
  Layout, Grid, Binary, Clock, Type, Edit3, Activity, BarChart, Info,
  ChevronRight, ChevronLeft, Sparkles, Lightbulb, Download, Upload, Calendar, FileText, Settings, Zap, Users, User, Lock, Key, Shield, Search, RefreshCw
} from 'lucide-react';

const BLOCK_TYPES = [
  { id: 'value',             label: 'Valor Numérico',              icon: Layout,      info: 'Exibe o valor atual da variável em destaque, com unidade de medida. Ideal para leituras simples como corrente, tensão e temperatura.' },
  { id: 'value_gauge',       label: 'Valor Numérico (Grande)',     icon: Layout,      info: 'Cartão de valor numérico em tamanho ampliado para facilitar visualização a distância.' },
  { id: 'timeseries',        label: 'Gráfico de Tendência',        icon: TrendingUp,  info: 'Gráfico de linha contínuo para acompanhamento de tendência ao longo do tempo. Ideal para análise de variáveis analógicas.' },
  { id: 'radial_gauge',      label: 'Medidor Radial (Arco)',       icon: Gauge,       info: 'Velocímetro circular com arco de progresso. Exibe o valor atual em relação a uma faixa mínima e máxima configurável.' },
  { id: 'level_indicator',   label: 'Indicador de Nível (Tanque)', icon: Activity,    info: 'Coluna vertical animada que representa o nível de reservatórios, caixas d\'água, poços ou tanques.' },
  { id: 'horizontal_bar',    label: 'Barra de Progresso',          icon: BarChart,    info: 'Barra horizontal de progresso proporcional ao valor atual em relação ao fundo de escala.' },
  { id: 'bitmap',            label: 'Status Ligado / Desligado',   icon: Binary,      info: 'Indicador de estado lógico com cores configuráveis. Para sinais digitais, bobinas (Coil) e bits individuais de palavras.' },
  { id: 'multibit_list',     label: 'Lista de Status (Multibit)',  icon: List,        info: 'Lista de múltiplos status e alarmes mapeados em bits individuais de uma palavra Modbus (Word 16 bits).' },
  { id: 'write_button',      label: 'Entrada de Setpoint (Escrita)', icon: Edit3,     info: 'Campo de entrada numérico com botão de envio para escrever setpoints diretamente no CLP via Modbus.' },
  { id: 'table',             label: 'Tabela de Histórico',         icon: Table,       info: 'Tabela paginada com os registros históricos mais recentes da variável, com opção de exportar para CSV.' },
  { id: 'donut',             label: 'Gráfico de Rosca (Donut)',    icon: PieChart,    info: 'Gráfico circular proporcional para visualização de percentual ou fração do valor em relação ao máximo.' },
  { id: 'scatter',           label: 'Gráfico de Dispersão (XY)',   icon: ScatterChart,info: 'Gráfico XY de dispersão para análise de correlação entre duas variáveis de processo.' },
  { id: 'variable_list',     label: 'Lista de Variáveis',          icon: List,        info: 'Lista compacta com múltiplas variáveis de processo exibidas simultaneamente em um único bloco.' },
  { id: 'external_link',     label: 'Link Externo / Atalho',       icon: Link,        info: 'Atalho ou incorporação de link para páginas externas, relatórios ou sistemas secundários.' },
  { id: 'geolocation',       label: 'Geolocalização (Mapa)',       icon: MapPin,      info: 'Mapa geográfico com indicação da localização da estação de bombeamento ou unidade monitorada.' },
  { id: 'image_overlay',     label: 'Sinóptico / Imagem Overlay',  icon: Image,       info: 'Diagrama sinóptico ou planta baixa com sobreposição de dados em tempo real sobre a imagem de fundo.' },
  { id: 'comparative_analysis', label: 'Análise Comparativa',     icon: BarChart2,   info: 'Gráfico comparativo entre valores medidos e setpoints ou referências esperadas.' },
  { id: 'heatmap',           label: 'Mapa de Calor (Heatmap)',     icon: Grid,        info: 'Matriz de intensidade hora × dia para identificar padrões de operação ao longo da semana.' },
  { id: 'timeline',          label: 'Linha do Tempo (Timeline)',   icon: Clock,       info: 'Linha do tempo cronológica com eventos de comutação, alarmes e mudanças de estado.' },
  { id: 'header',            label: 'Cabeçalho de Seção',          icon: Type,        info: 'Bloco de título divisor para organizar o painel em seções com nome e descrição.' },
];


function ConfigPanel({ socket, variables = [], cameras = [], devices = [], generalConfig = {}, onRefresh }) {
  const [activeTab, setActiveTab] = useState('variables');

  // Wizard State
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [activeTooltip, setActiveTooltip] = useState(null);

  // Devices State
  const [newDevice, setNewDevice] = useState({ name: '', ip_address: '192.168.0.10', port: 502, polling_interval_ms: 1000 });
  const [editingDeviceId, setEditingDeviceId] = useState(null);

  const defaultVarOptions = {
    data_format: '16_int',
    endianness: 'ABCD',
    scale: 1,
    offset: 0,
    bit_index: -1,
    min_val: 0,
    max_val: 100,
    label_off: 'DESLIGADO',
    label_on: 'LIGADO',
    color_off: '#ef4444',
    color_on: '#22c55e'
  };

  const [newVar, setNewVar] = useState({
    device_id: devices.length > 0 ? devices[0].id : '',
    name: '', display_name: '', type: 'analog', unit: '',
    modbus_address: 0, modbus_type: 'holding', decimals: 0,
    widget_type: 'value', color: '#3b82f6', category: 'supervision',
    options: { ...defaultVarOptions }
  });
  const [editingVarId, setEditingVarId] = useState(null);

  // Cameras State
  const [newCam, setNewCam] = useState({ name: '', url: '' });
  const [editingCamId, setEditingCamId] = useState(null);

  // Lighting State
  const [lightingConfig, setLightingConfig] = useState({
    enabled: true,
    name: 'Iluminação Elevatória',
    device_id: devices.length > 0 ? devices[0].id : 1,
    modbus_type: 'coil',
    modbus_address: 0
  });

  const [genConfig, setGenConfig] = useState({
    system_name: (generalConfig && generalConfig.system_name) || 'KRONOX OS',
    system_logo: (generalConfig && generalConfig.system_logo) || '/kronox_logo.png',
    sidebar_display: (generalConfig && generalConfig.sidebar_display) || 'image',
    dashboard_title: (generalConfig && generalConfig.dashboard_title) || 'Visão Geral da Estação',
    timezone: (generalConfig && generalConfig.timezone) || 'America/Sao_Paulo',
    history_interval_seconds: (generalConfig && generalConfig.history_interval_seconds) !== undefined ? generalConfig.history_interval_seconds : 15
  });

  useEffect(() => {
    if (generalConfig) {
      setGenConfig({
        system_name: generalConfig.system_name || 'KRONOX OS',
        system_logo: generalConfig.system_logo !== undefined ? generalConfig.system_logo : '/kronox_logo.png',
        sidebar_display: generalConfig.sidebar_display || 'image',
        dashboard_title: generalConfig.dashboard_title || 'Visão Geral da Estação',
        timezone: generalConfig.timezone || 'America/Sao_Paulo',
        history_interval_seconds: generalConfig.history_interval_seconds !== undefined ? generalConfig.history_interval_seconds : 15
      });
    }
  }, [generalConfig]);

  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'operator' });
  const [editingUserId, setEditingUserId] = useState(null);

  // Audit State
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const res = await fetch(getBaseUrl() + '/api/audit');
      if (res.ok) setAuditLogs(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleExportAuditCSV = () => {
    try {
      const headers = ['ID', 'Data/Hora', 'Usuário', 'Ação', 'Parâmetro / Detalhes', 'Valor Anterior', 'Novo Valor', 'Status'];
      const rows = auditLogs.map(l => {
        const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '';
        const oldVal = (l.old_value !== undefined && l.old_value !== null ? String(l.old_value) : '').replace('.', ',');
        const newVal = (l.new_value !== undefined && l.new_value !== null ? String(l.new_value) : '').replace('.', ',');
        return [
          l.id,
          `"${dateStr}"`,
          `"${(l.user || 'Sistema').replace(/"/g, '""')}"`,
          `"${(l.action || '').replace(/"/g, '""')}"`,
          `"${(l.param_name || '').replace(/"/g, '""')}"`,
          `"${oldVal.replace(/"/g, '""')}"`,
          `"${newVal.replace(/"/g, '""')}"`,
          `"${(l.status || 'SUCESSO').replace(/"/g, '""')}"`
        ];
      });
      const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
      const bytes = new Uint8Array(csvContent.length);
      for (let i = 0; i < csvContent.length; i++) {
        const code = csvContent.charCodeAt(i);
        bytes[i] = code < 256 ? code : 63;
      }
      const blob = new Blob([bytes], { type: 'text/csv;charset=iso-8859-1;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KRONOX_Auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('Relatório de auditoria exportado com sucesso!', 'success');
    } catch (e) {
      showNotification('Erro ao exportar auditoria', 'error');
    }
  };

  const [notification, setNotification] = useState(null);

  // Telemetry Export Modal State
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [telemetryFilter, setTelemetryFilter] = useState({
    preset: '24h',
    start_time: new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 16),
    end_time: new Date().toISOString().slice(0, 16),
    step_seconds: 60,
    selected_var_ids: []
  });

  // Handle System Config JSON Export
  const handleExportConfigJSON = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/config/export');
      if (!res.ok) throw new Error('Erro ao exportar configurações');
      const data = await res.json();
      const jsonStr = JSON.stringify(data, null, 2);
      const fileName = `KRONOX_Backup_Configuracoes_${new Date().toISOString().slice(0, 10)}.json`;

      if ('showSaveFilePicker' in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'Arquivo de Backup JSON (*.json)', accept: { 'application/json': ['.json'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(jsonStr);
          await writable.close();
          showNotification('Backup exportado com sucesso!', 'success');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('Backup exportado com sucesso!', 'success');
    } catch (e) {
      showNotification('Erro ao exportar backup de configurações', 'error');
    }
  };

  // Handle System Config JSON Import
  const handleImportConfigJSON = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      const res = await fetch(getBaseUrl() + '/api/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showNotification('Configurações importadas e restauradas com sucesso!', 'success');
        if (onRefresh) onRefresh();
      } else {
        const errData = await res.json();
        showNotification(errData.error || 'Erro ao importar arquivo', 'error');
      }
    } catch (e) {
      showNotification('Arquivo de configuração inválido ou corrompido', 'error');
    }
    e.target.value = '';
  };



  // Handle Telemetry CSV Export
  const handleExportTelemetryCSV = async () => {
    try {
      let startIso = '';
      let endIso = '';

      if (telemetryFilter.preset === '1h') {
        startIso = new Date(Date.now() - 3600 * 1000).toISOString();
      } else if (telemetryFilter.preset === '24h') {
        startIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      } else if (telemetryFilter.preset === '7d') {
        startIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      } else if (telemetryFilter.preset === 'custom') {
        if (telemetryFilter.start_time) startIso = new Date(telemetryFilter.start_time).toISOString();
        if (telemetryFilter.end_time) endIso = new Date(telemetryFilter.end_time).toISOString();
      }

      const varIdsParam = telemetryFilter.selected_var_ids.length > 0 ? telemetryFilter.selected_var_ids.join(',') : '';
      const queryUrl = `${getBaseUrl()}/api/history/export/csv?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&step_seconds=${telemetryFilter.step_seconds}&var_ids=${encodeURIComponent(varIdsParam)}`;

      const res = await fetch(queryUrl);
      if (!res.ok) throw new Error('Erro ao buscar telemetria');
      const blob = await res.blob();

      const fileName = `Telemetria_Funcionamento_KRONOX_${new Date().toISOString().slice(0, 10)}.csv`;

      if ('showSaveFilePicker' in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'Arquivo CSV (*.csv)', accept: { 'text/csv': ['.csv'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setShowTelemetryModal(false);
          showNotification('Relatório de telemetria exportado com sucesso!', 'success');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowTelemetryModal(false);
      showNotification('Relatório de telemetria exportado com sucesso!', 'success');
    } catch (e) {
      showNotification('Erro ao exportar telemetria de variáveis', 'error');
    }
  };

  const showNotification = (msg, type) => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      if (window.location.port === '5173') return '';
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
    }
    return 'http://localhost:3001';
  };

  const handleSaveGeneralConfig = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/settings/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genConfig)
      });
      if (res.ok) {
        if (onRefresh) onRefresh();
        showNotification('Configurações gerais salvas com sucesso!', 'success');
      }
    } catch (e) {
      console.error(e);
      showNotification('Erro ao salvar configurações gerais', 'error');
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showNotification('A imagem deve ter no máximo 2MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setGenConfig(prev => ({ ...prev, system_logo: reader.result }));
        showNotification('Logomarca carregada! Clique em Salvar para aplicar.', 'success');
      };
      reader.readAsDataURL(file);
    }
  };

  const fetchLightingConfig = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/settings/lighting');
      if (res.ok) {
        const data = await res.json();
        setLightingConfig(data);
      }
    } catch (e) { }
  };

  useEffect(() => {
    fetchLightingConfig();
  }, []);

  const handleSaveLightingConfig = async (customConfig) => {
    const isPlainObj = customConfig && typeof customConfig === 'object' && !('nativeEvent' in customConfig) && !('target' in customConfig);
    const configToSave = isPlainObj ? customConfig : lightingConfig;
    try {
      const res = await fetch(getBaseUrl() + '/api/settings/lighting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSave)
      });
      if (res.ok) {
        showNotification('Configurações de iluminação salvas com sucesso!', 'success');
        if (onRefresh) onRefresh();
      } else {
        const data = await res.json();
        showNotification(data.error || 'Erro ao salvar configurações de iluminação', 'error');
      }
    } catch (e) {
      showNotification('Erro ao salvar configurações de iluminação', 'error');
    }
  };

  const handleAddDevice = async () => {
    try {
      let response;
      if (editingDeviceId) {
        response = await fetch(getBaseUrl() + `/api/devices/${editingDeviceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newDevice)
        });
      } else {
        response = await fetch(getBaseUrl() + '/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newDevice)
        });
      }
      if (response.ok) {
        showNotification(editingDeviceId ? 'CLP atualizado!' : 'CLP adicionado!', 'success');
        setNewDevice({ name: '', ip_address: '192.168.0.10', port: 502, polling_interval_ms: 1000 });
        setEditingDeviceId(null);
        if (onRefresh) onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || (editingDeviceId ? 'Erro ao atualizar CLP' : 'Erro ao adicionar CLP'), 'error');
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  const handleEditDevice = (d) => {
    setEditingDeviceId(d.id);
    setNewDevice({
      name: d.name,
      ip_address: d.ip_address,
      port: d.port,
      polling_interval_ms: d.polling_interval_ms
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteDevice = async (id) => {
    try {
      const response = await fetch(getBaseUrl() + `/api/devices/${id}`, { method: 'DELETE' });
      if (response.ok) {
        showNotification('CLP removido!', 'success');
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  const handleImportTagsCSV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n');
      const toImport = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        
        const parts = line.split(';');
        if (parts.length >= 6) {
          const rawVarName = parts[1].replace(/"/g, '').trim(); 
          const varNameParts = rawVarName.split('.');
          const displayName = varNameParts[varNameParts.length - 1]; 
          
          const dataTypeStr = parts[2].replace(/"/g, '').trim(); 
          const address = Math.max(0, parseInt(parts[3].replace(/"/g, '').trim()) - 1); 
          const iecType = parts[5].replace(/"/g, '').trim(); 
          
          let modbus_type = 'holding';
          if (dataTypeStr.toLowerCase() === 'coil') modbus_type = 'coil';
          else if (dataTypeStr.toLowerCase() === 'inputstatus') modbus_type = 'discrete';
          else if (dataTypeStr.toLowerCase() === 'holdingregister') modbus_type = 'holding';
          else if (dataTypeStr.toLowerCase() === 'inputregister') modbus_type = 'input';
          
          let widget_type = 'value';
          let data_format = '16_int';
          if (iecType === 'BOOL') {
            widget_type = 'bitmap';
          } else if (iecType === 'REAL') {
            data_format = '32_float';
          }
          
          toImport.push({
            device_id: devices.length > 0 ? devices[0].id : null,
            name: rawVarName.replace(/\./g, '_'), 
            display_name: displayName,
            type: iecType === 'BOOL' ? 'boolean' : 'analog',
            unit: '',
            modbus_address: address,
            modbus_type,
            decimals: iecType === 'REAL' ? 2 : 0,
            widget_type,
            color: '#3b82f6',
            category: 'supervision',
            options: { ...defaultVarOptions, data_format }
          });
        }
      }
      
      if (toImport.length === 0) {
        showNotification('Nenhuma tag válida encontrada no CSV', 'error');
        return;
      }
      
      let imported = 0;
      for (const item of toImport) {
        try {
          const res = await fetch(getBaseUrl() + '/api/variables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          if (res.ok) imported++;
        } catch(err) {}
      }
      
      showNotification(`${imported} tags importadas com sucesso!`, 'success');
      if (onRefresh) onRefresh();
    } catch (err) {
      showNotification('Erro ao ler arquivo CSV', 'error');
    }
    e.target.value = '';
  };

  const handleAddVariable = async () => {
    try {
      const payload = { ...newVar, device_id: newVar.device_id || (devices.length > 0 ? devices[0].id : null) };
      let response;
      if (editingVarId) {
        response = await fetch(getBaseUrl() + `/api/variables/${editingVarId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        response = await fetch(getBaseUrl() + '/api/variables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (response.ok) {
        showNotification(editingVarId ? 'Variável atualizada!' : 'Variável adicionada!', 'success');
        setNewVar({
          device_id: devices.length > 0 ? devices[0].id : '',
          name: '', display_name: '', type: 'analog', unit: '',
          modbus_address: 0, modbus_type: 'holding', decimals: 0,
          widget_type: 'value', color: '#3b82f6', category: 'supervision',
          options: { ...defaultVarOptions }
        });
        setEditingVarId(null);
        if (onRefresh) onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || (editingVarId ? 'Erro ao atualizar variável' : 'Erro ao adicionar variável'), 'error');
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  const handleEditVariable = (v) => {
    setEditingVarId(v.id);
    let parsedOpts = {};
    try {
      parsedOpts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {});
    } catch (e) { }
    setNewVar({
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
      options: {
        ...defaultVarOptions,
        ...parsedOpts
      }
    });
    document.getElementById('var-edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteVariable = async (id) => {
    try {
      const response = await fetch(getBaseUrl() + `/api/variables/${id}`, { method: 'DELETE' });
      if (response.ok) {
        showNotification('Variável removida!', 'success');
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  const handleAddCamera = async () => {
    try {
      let response;
      if (editingCamId) {
        response = await fetch(getBaseUrl() + `/api/cameras/${editingCamId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newCam)
        });
      } else {
        response = await fetch(getBaseUrl() + '/api/cameras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newCam)
        });
      }
      if (response.ok) {
        showNotification(editingCamId ? 'Câmera atualizada!' : 'Câmera adicionada!', 'success');
        setNewCam({ name: '', url: '' });
        setEditingCamId(null);
        if (onRefresh) onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || (editingCamId ? 'Erro ao atualizar câmera' : 'Erro ao adicionar câmera'), 'error');
      }
    } catch (e) {
      showNotification('Erro: ' + e.message, 'error');
    }
  };

  const handleEditCamera = (c) => {
    setEditingCamId(c.id);
    setNewCam({
      name: c.name,
      url: c.url
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteCamera = async (id) => {
    try {
      const response = await fetch(getBaseUrl() + `/api/cameras/${id}`, { method: 'DELETE' });
      if (response.ok) {
        showNotification('Câmera removida!', 'success');
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(getBaseUrl() + '/api/users');
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'audit') fetchAuditLogs();
  }, [activeTab]);

  const handleAddOrUpdateUser = async () => {
    if (!newUser.username) {
      showNotification('Preencha o nome do usuário', 'error');
      return;
    }
    if (!editingUserId && !newUser.password) {
      showNotification('Preencha a senha para o novo usuário', 'error');
      return;
    }
    try {
      const url = editingUserId ? `${getBaseUrl()}/api/users/${editingUserId}` : `${getBaseUrl()}/api/users`;
      const method = editingUserId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(editingUserId ? 'Credenciais atualizadas com sucesso!' : 'Usuário cadastrado com sucesso!', 'success');
        setEditingUserId(null);
        setNewUser({ username: '', password: '', role: 'operator' });
        fetchUsers();
      } else {
        showNotification(data.error || 'Erro ao salvar usuário', 'error');
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  const handleEditUser = (user) => {
    setEditingUserId(user.id);
    setNewUser({ username: user.username, password: '', role: user.role });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Deseja realmente excluir este usuário?')) return;
    try {
      const res = await fetch(`${getBaseUrl()}/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showNotification('Usuário excluído com sucesso!', 'success');
        fetchUsers();
      } else {
        showNotification(data.error || 'Erro ao excluir usuário', 'error');
      }
    } catch (e) {
      showNotification('Erro de conexão', 'error');
    }
  };

  return (
    <div className="card" style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div className="card-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
          <button className={`btn ${activeTab === 'variables' ? 'btn-primary' : ''}`} style={activeTab !== 'variables' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('variables')}>Variáveis / Widgets</button>
          <button className={`btn ${activeTab === 'devices' ? 'btn-primary' : ''}`} style={activeTab !== 'devices' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('devices')}>Rede Modbus (PLCs)</button>
          <button className={`btn ${activeTab === 'cameras' ? 'btn-primary' : ''}`} style={activeTab !== 'cameras' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('cameras')}>Câmeras (RTSP)</button>
          <button className={`btn ${activeTab === 'lighting' ? 'btn-primary' : ''}`} style={activeTab !== 'lighting' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('lighting')}>Iluminação (Sidebar)</button>
          <button className={`btn ${activeTab === 'general' ? 'btn-primary' : ''}`} style={activeTab !== 'general' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('general')}>Geral</button>
          <button className={`btn ${activeTab === 'users' ? 'btn-primary' : ''}`} style={activeTab !== 'users' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('users')}>Usuários & Credenciais</button>
          <button className={`btn ${activeTab === 'audit' ? 'btn-primary' : ''}`} style={activeTab !== 'audit' ? { background: 'rgba(0,0,0,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' } : {}} onClick={() => setActiveTab('audit')}>Auditoria</button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', fontSize: '0.825rem', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(6, 182, 212, 0.3)', cursor: 'pointer' }} onClick={() => setShowTelemetryModal(true)}>
            <FileText size={15} /> Telemetria (.CSV)
          </button>
          <button className="btn" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', fontSize: '0.825rem', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(59, 130, 246, 0.3)', cursor: 'pointer' }} onClick={handleExportConfigJSON}>
            <Download size={15} /> Backup (.JSON)
          </button>
          <label className="btn" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontSize: '0.825rem', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(16, 185, 129, 0.3)', cursor: 'pointer', margin: 0 }}>
            <Upload size={15} /> Importar (.JSON)
            <input type="file" accept=".json" onChange={handleImportConfigJSON} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {activeTab === 'devices' && (
        <div>
          <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{editingDeviceId ? 'Editar CLP' : 'Adicionar PLC Modbus TCP'}</h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
              <label className="form-label">Nome do CLP</label>
              <input type="text" className="form-input" value={newDevice.name} onChange={e => setNewDevice({ ...newDevice, name: e.target.value })} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, width: '150px' }}>
              <label className="form-label">Endereço IP</label>
              <input type="text" className="form-input" value={newDevice.ip_address} onChange={e => setNewDevice({ ...newDevice, ip_address: e.target.value })} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, width: '100px' }}>
              <label className="form-label">Porta</label>
              <input type="number" className="form-input" value={newDevice.port} onChange={e => setNewDevice({ ...newDevice, port: parseInt(e.target.value) })} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, width: '120px' }}>
              <label className="form-label">Polling (ms)</label>
              <input type="number" className="form-input" value={newDevice.polling_interval_ms} onChange={e => setNewDevice({ ...newDevice, polling_interval_ms: parseInt(e.target.value) })} />
            </div>
            <button className="btn btn-primary" onClick={handleAddDevice} disabled={!newDevice.name || !newDevice.ip_address}>
              {editingDeviceId ? <><Save size={16} /> Salvar</> : <><Plus size={16} /> Adicionar</>}
            </button>
            {editingDeviceId && (
              <button className="btn" onClick={() => { setEditingDeviceId(null); setNewDevice({ name: '', ip_address: '192.168.0.10', port: 502, polling_interval_ms: 1000 }); }} style={{ background: 'rgba(255,255,255,0.1)' }}>
                Cancelar
              </button>
            )}
          </div>

          <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Dispositivos Configurados</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {devices.map(d => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <Server size={24} color="var(--color-primary)" />
                  <div>
                    <strong>{d.name}</strong>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>IP: {d.ip_address}:{d.port} | {d.polling_interval_ms}ms</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className={`status-indicator ${d.live_status === 'Online' ? 'status-normal' : 'status-danger'}`}>
                    <div className="status-dot"></div> {d.live_status}
                  </div>
                  <button className="btn" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleEditDevice(d)}>
                    <Edit2 size={16} />
                  </button>
                  <button className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--color-danger)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleDeleteDevice(d.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {devices.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Nenhum dispositivo configurado.</p>}
          </div>
        </div>
      )}

      {activeTab === 'variables' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ color: 'var(--text-secondary)', margin: 0 }}>
              {editingVarId ? 'Editar Variável' : 'Adicionar Nova Variável ao Dashboard'}
            </h3>
            <label className="btn" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontSize: '0.825rem', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(16, 185, 129, 0.3)', cursor: 'pointer', margin: 0 }}>
              <Upload size={15} /> Importar Tags CLP (.CSV)
              <input type="file" accept=".csv" onChange={handleImportTagsCSV} style={{ display: 'none' }} />
            </label>
          </div>
          <div id="var-edit-form" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem', background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: editingVarId ? '1px solid var(--color-primary)' : '1px solid var(--border-color)' }}>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">CLP Destino</label>
                <select className="form-input" value={newVar.device_id} onChange={e => setNewVar({ ...newVar, device_id: e.target.value })}>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">Categoria (Tela)</label>
                <select className="form-input" value={newVar.category} onChange={e => setNewVar({ ...newVar, category: e.target.value })}>
                  <option value="supervision">Supervisão (Dashboard)</option>
                  <option value="engineering">Engenharia (Parâmetros)</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">Nome (Tag Interna)</label>
                <input type="text" className="form-input" placeholder="ex: current_l1" value={newVar.name} onChange={e => setNewVar({ ...newVar, name: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">Título Exibido no Painel</label>
                <input type="text" className="form-input" placeholder="ex: Corrente Linha 1" value={newVar.display_name} onChange={e => setNewVar({ ...newVar, display_name: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, width: '120px' }}>
                <label className="form-label">Função Modbus</label>
                <select className="form-input" value={newVar.modbus_type} onChange={e => setNewVar({ ...newVar, modbus_type: e.target.value })}>
                  <option value="holding">Holding Reg</option>
                  <option value="input">Input Reg</option>
                  <option value="coil">Coil (Write)</option>
                  <option value="discrete">Discrete Input</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0, width: '110px' }}>
                <label className="form-label" title="Endereço Offset 0-based. Ex: 40029 no CLP é Endereço 28 (40029 - 40001)">Endereço</label>
                <input type="number" className="form-input" value={newVar.modbus_address} onChange={e => setNewVar({ ...newVar, modbus_address: parseInt(e.target.value) })} title="Ex: 40029 no CLP = Endereço 28" />
              </div>
              <div className="form-group" style={{ marginBottom: 0, width: '80px' }}>
                <label className="form-label">Decimais</label>
                <input type="number" className="form-input" value={newVar.decimals} onChange={e => setNewVar({ ...newVar, decimals: parseInt(e.target.value) })} title="Ex: 2 para dividir por 100" />
              </div>
              <div className="form-group" style={{ marginBottom: 0, width: '80px' }}>
                <label className="form-label">Unidade</label>
                <input type="text" className="form-input" placeholder="A" value={newVar.unit} onChange={e => setNewVar({ ...newVar, unit: e.target.value })} />
              </div>

              {(newVar.modbus_type === 'holding' || newVar.modbus_type === 'input') && (
                <>
                  <div className="form-group" style={{ marginBottom: 0, width: '160px' }}>
                    <label className="form-label">Formato (Bits)</label>
                    <select
                      className="form-input"
                      value={newVar.options?.data_format || '16_int'}
                      onChange={e => setNewVar({
                        ...newVar,
                        options: { ...(newVar.options || {}), data_format: e.target.value }
                      })}
                    >
                      <option value="16_int">16 bits (1 Reg - Int16)</option>
                      <option value="16_uint">16 bits (1 Reg - UInt16)</option>
                      <option value="32_float">32 bits (2 Regs - Float IEEE 754)</option>
                      <option value="32_int">32 bits (2 Regs - Int32)</option>
                      <option value="32_uint">32 bits (2 Regs - UInt32)</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0, width: '190px' }}>
                    <label className="form-label">Endianness</label>
                    <select
                      className="form-input"
                      value={newVar.options?.endianness || 'ABCD'}
                      onChange={e => setNewVar({
                        ...newVar,
                        options: { ...(newVar.options || {}), endianness: e.target.value }
                      })}
                    >
                      <option value="ABCD">ABCD (Big word e big byte)</option>
                      <option value="BADC">BADC (Big word e little byte)</option>
                      <option value="DCBA">DCBA (Little word e little byte)</option>
                      <option value="CDAB">CDAB (Little word e big byte)</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0, width: '90px' }}>
                    <label className="form-label">Escala</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      value={newVar.options?.scale !== undefined ? newVar.options.scale : 1}
                      onChange={e => setNewVar({
                        ...newVar,
                        options: { ...(newVar.options || {}), scale: parseFloat(e.target.value) || 1 }
                      })}
                      title="Fator de multiplicação da escala (padrão 1.0)"
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0, width: '90px' }}>
                    <label className="form-label">Offset</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      value={newVar.options?.offset !== undefined ? newVar.options.offset : 0}
                      onChange={e => setNewVar({
                        ...newVar,
                        options: { ...(newVar.options || {}), offset: parseFloat(e.target.value) || 0 }
                      })}
                      title="Valor de offset/deslocamento (padrão 0.0)"
                    />
                  </div>
                </>
              )}

              <div className="form-group" style={{ marginBottom: 0, minWidth: '180px', flex: 1 }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Tipo no Dashboard</span>
                  <span style={{ color: '#06b6d4', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }} onClick={() => { setWizardStep(1); setShowWizard(true); }}>
                    ✨ Assistente em 3 Passos
                  </span>
                </label>
                <select className="form-input" value={newVar.widget_type} onChange={e => {
                  const wt = e.target.value;
                  setNewVar({ ...newVar, widget_type: wt, type: (wt === 'switch' || wt === 'bitmap' ? 'boolean' : 'analog') });
                }}>
                  {BLOCK_TYPES.map(bt => (
                    <option key={bt.id} value={bt.id}>{bt.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0, width: '80px' }}>
                <label className="form-label">Cor</label>
                <input type="color" style={{ width: '100%', height: '40px', padding: '0 4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '6px' }} value={newVar.color} onChange={e => setNewVar({ ...newVar, color: e.target.value })} />
              </div>
            </div>

            {/* CONFIGURAÇÕES ESPECÍFICAS DE PERSONALIZAÇÃO */}
            <div style={{ background: 'var(--bg-subcard)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#06b6d4', marginBottom: '0.75rem' }}>
                ⚙️ Personalização Visual do Bloco ({newVar.widget_type})
              </div>

              {(newVar.widget_type === 'switch' || newVar.widget_type === 'bitmap') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(newVar.modbus_type === 'holding' || newVar.modbus_type === 'input') && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Bit Específico da Palavra (Word 16-bits)</label>
                      <select
                        className="form-input"
                        value={newVar.options?.bit_index !== undefined ? newVar.options.bit_index : -1}
                        onChange={e => setNewVar({
                          ...newVar,
                          options: { ...(newVar.options || {}), bit_index: parseInt(e.target.value) }
                        })}
                      >
                        <option value={-1}>Palavra Inteira (Qualquer bit ativo / Valor &gt; 0)</option>
                        {[...Array(16)].map((_, bit) => (
                          <option key={bit} value={bit}>Bit #{bit} (Máscara 0x{((1 << bit).toString(16)).toUpperCase().padStart(4, '0')})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Texto Bit 0 (Falso)</label>
                      <input type="text" className="form-input" placeholder="DESLIGADO" value={newVar.options?.label_off !== undefined ? newVar.options.label_off : 'DESLIGADO'} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), label_off: e.target.value } })} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Cor Bit 0</label>
                      <input type="color" style={{ width: '100%', height: '38px', padding: '0 4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '6px' }} value={newVar.options?.color_off || '#ef4444'} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), color_off: e.target.value } })} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Texto Bit 1 (Verdadeiro)</label>
                      <input type="text" className="form-input" placeholder="LIGADO" value={newVar.options?.label_on !== undefined ? newVar.options.label_on : 'LIGADO'} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), label_on: e.target.value } })} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Cor Bit 1</label>
                      <input type="color" style={{ width: '100%', height: '38px', padding: '0 4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '6px' }} value={newVar.options?.color_on || '#22c55e'} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), color_on: e.target.value } })} />
                    </div>
                  </div>
                </div>
              )}

              {(newVar.widget_type === 'gauge' || newVar.widget_type === 'radial_gauge' || newVar.widget_type === 'tank' || newVar.widget_type === 'level_indicator' || newVar.widget_type === 'horizontal_bar' || newVar.widget_type === 'donut') && (
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label">Mínimo (Fundo de Escala Min)</label>
                    <input type="number" className="form-input" value={newVar.options?.min_val !== undefined ? newVar.options.min_val : 0} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), min_val: parseFloat(e.target.value) } })} />
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label">Máximo (Fundo de Escala Max)</label>
                    <input type="number" className="form-input" value={newVar.options?.max_val !== undefined ? newVar.options.max_val : 100} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), max_val: parseFloat(e.target.value) } })} />
                  </div>
                </div>
              )}

              {newVar.widget_type === 'external_link' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">URL de Destino</label>
                  <input type="text" className="form-input" placeholder="https://..." value={newVar.options?.url || ''} onChange={e => setNewVar({ ...newVar, options: { ...(newVar.options || {}), url: e.target.value } })} />
                </div>
              )}

              {newVar.widget_type === 'multibit_list' && (() => {
                const currentItems = newVar.options?.multibit_items || [
                  { bit: 0, name: 'Status Alagamento', label_off: 'Sem Alagamento', label_on: 'ALAGAMENTO!', color_on: '#ef4444' },
                  { bit: 1, name: 'Status Extravasão', label_off: 'Sem Extravasão', label_on: 'EXTRAVASÃO!', color_on: '#ef4444' },
                  { bit: 2, name: 'Status Emergência', label_off: 'Não acionado', label_on: 'EMERGÊNCIA!', color_on: '#ef4444' },
                  { bit: 3, name: 'Status Falta de Fase', label_off: 'Fases OK', label_on: 'FALTA DE FASE!', color_on: '#f59e0b' },
                  { bit: 4, name: 'Status DPS', label_off: 'DPS OK', label_on: 'DPS ATUADO!', color_on: '#f59e0b' },
                  { bit: 5, name: 'Falha B1', label_off: 'Sem Falha', label_on: 'FALHA B1!', color_on: '#ef4444' },
                  { bit: 6, name: 'Falha B2', label_off: 'Sem Falha', label_on: 'FALHA B2!', color_on: '#ef4444' },
                  { bit: 7, name: 'Boia Drenagem Atuada', label_off: 'Não Atuada', label_on: 'BOIA ATUADA!', color_on: '#f59e0b' }
                ];

                const handleItemChange = (idx, field, val) => {
                  const updated = [...currentItems];
                  updated[idx] = { ...updated[idx], [field]: val };
                  setNewVar({
                    ...newVar,
                    options: { ...(newVar.options || {}), multibit_items: updated }
                  });
                };

                const handleAddItem = () => {
                  const nextBit = currentItems.length < 16 ? currentItems.length : 0;
                  const updated = [...currentItems, { bit: nextBit, name: `Status Bit #${nextBit}`, label_off: 'NORMAL', label_on: 'ALERTA', color_on: '#ef4444' }];
                  setNewVar({
                    ...newVar,
                    options: { ...(newVar.options || {}), multibit_items: updated }
                  });
                };

                const handleRemoveItem = (idx) => {
                  const updated = currentItems.filter((_, i) => i !== idx);
                  setNewVar({
                    ...newVar,
                    options: { ...(newVar.options || {}), multibit_items: updated }
                  });
                };

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Mapeamento de Bits da Word Modbus</span>
                      <button className="btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.15)', color: 'var(--color-primary)' }} onClick={handleAddItem}>
                        <Plus size={14} /> Adicionar Bit
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {currentItems.map((item, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr 2fr 1fr auto', gap: '0.5rem', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '6px' }}>
                          <select className="form-input" style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }} value={item.bit || 0} onChange={e => handleItemChange(idx, 'bit', parseInt(e.target.value))}>
                            {[...Array(16)].map((_, b) => (
                              <option key={b} value={b}>Bit #{b}</option>
                            ))}
                          </select>
                          <input type="text" className="form-input" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} placeholder="Nome (ex: Status Alagamento)" value={item.name} onChange={e => handleItemChange(idx, 'name', e.target.value)} />
                          <input type="text" className="form-input" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} placeholder="Texto Bit 0 (ex: Sem Alagamento)" value={item.label_off} onChange={e => handleItemChange(idx, 'label_off', e.target.value)} />
                          <input type="text" className="form-input" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} placeholder="Texto Bit 1 (ex: ALAGAMENTO!)" value={item.label_on} onChange={e => handleItemChange(idx, 'label_on', e.target.value)} />
                          <input type="color" style={{ width: '100%', height: '30px', padding: '0 2px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '4px' }} value={item.color_on || '#ef4444'} onChange={e => handleItemChange(idx, 'color_on', e.target.value)} />
                          <button className="btn" style={{ padding: '0.25rem 0.5rem', background: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-danger)' }} onClick={() => handleRemoveItem(idx)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              {editingVarId && (
                <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }} onClick={() => {
                  setEditingVarId(null);
                  setNewVar({ ...newVar, name: '', display_name: '' });
                }}>
                  Cancelar
                </button>
              )}
              <button className="btn btn-primary" onClick={handleAddVariable} disabled={!newVar.name || !newVar.display_name || devices.length === 0}>
                {editingVarId ? <Save size={16} /> : <Plus size={16} />}
                {editingVarId ? ' Atualizar Variável' : ' Adicionar ao Dashboard'}
              </button>
            </div>
          </div>

          <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Variáveis Mapeadas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {variables.map(v => {
              let opts = {};
              try { opts = typeof v.options === 'string' ? JSON.parse(v.options || '{}') : (v.options || {}); } catch (e) { }
              const isWordType = v.modbus_type === 'holding' || v.modbus_type === 'input';
              const formatText = isWordType ? (opts.data_format || '16_int') : v.modbus_type.toUpperCase();
              const endianText = isWordType ? (opts.endianness || 'ABCD') : '';
              return (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-subcard)', borderRadius: '8px', alignItems: 'center', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: v.color }}></div>
                    <div>
                      <strong>{v.display_name}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>({v.name})</span>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        Modbus {v.modbus_type.toUpperCase()} Addr: {v.modbus_address}
                        {isWordType && ` | Formato: ${formatText} | Endian: ${endianText}`}
                        {opts.scale !== undefined && opts.scale !== 1 && ` | Escala: x${opts.scale}`}
                        {opts.offset !== undefined && opts.offset !== 0 && ` | Offset: ${opts.offset > 0 ? '+' : ''}${opts.offset}`}
                        {opts.bit_index !== undefined && opts.bit_index >= 0 && ` | Bit #${opts.bit_index}`}
                        {` | ${v.decimals} decimais | Widget: ${v.widget_type}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleEditVariable(v)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--color-danger)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleDeleteVariable(v.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            {variables.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Nenhuma variável configurada.</p>}
          </div>
        </div>
      )}

      {activeTab === 'cameras' && (
        // Camera tab remains exactly the same
        <div>
          <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{editingCamId ? 'Editar Câmera RTSP / HTTP' : 'Adicionar Câmera RTSP / HTTP'}</h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
              <label className="form-label">Nome da Câmera</label>
              <input type="text" className="form-input" value={newCam.name} onChange={e => setNewCam({ ...newCam, name: e.target.value })} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: 2, minWidth: '250px' }}>
              <label className="form-label">URL do Stream (ex: http://ip:port/stream)</label>
              <input type="text" className="form-input" value={newCam.url} onChange={e => setNewCam({ ...newCam, url: e.target.value })} />
            </div>
            <button className="btn btn-primary" onClick={handleAddCamera} disabled={!newCam.name || !newCam.url}>
              {editingCamId ? <><Save size={16} /> Salvar</> : <><Plus size={16} /> Adicionar</>}
            </button>
            {editingCamId && (
              <button className="btn" onClick={() => { setEditingCamId(null); setNewCam({ name: '', url: '' }); }} style={{ background: 'rgba(255,255,255,0.1)' }}>
                Cancelar
              </button>
            )}
          </div>

          <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Câmeras Configuradas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {cameras.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-subcard)', borderRadius: '8px', alignItems: 'center', border: '1px solid var(--border-color)' }}>
                <div>
                  <strong>{c.name}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>({c.url})</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleEditCamera(c)}>
                    <Edit2 size={16} />
                  </button>
                  <button className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--color-danger)', padding: '0.5rem', cursor: 'pointer' }} onClick={() => handleDeleteCamera(c.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {cameras.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Nenhuma câmera configurada.</p>}
          </div>
        </div>
      )}

      {activeTab === 'lighting' && (
        <div style={{ background: 'var(--bg-subcard)', padding: '1.5rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: '#06b6d4', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Lightbulb size={20} color="#f59e0b" /> Configuração de Iluminação no Menu Lateral
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Habilite ou remova o controle rápido de iluminação do menu lateral esquerdo e configure a comunicação Modbus vinculada ao CLP.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-subcard)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ display: 'block', fontSize: '1rem' }}>Exibir Controle de Iluminação no Menu Lateral</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Quando desativado, o botão é removido completamente da interface (UI).</span>
              </div>
              <label className="ios-switch">
                <input
                  type="checkbox"
                  checked={Boolean(lightingConfig.enabled && lightingConfig.enabled !== 'false' && lightingConfig.enabled !== 0)}
                  onChange={e => {
                    const updated = { ...lightingConfig, enabled: e.target.checked };
                    setLightingConfig(updated);
                    handleSaveLightingConfig(updated);
                  }}
                />
                <span className="ios-slider"></span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Nome / Rótulo da Iluminação</label>
                <input
                  type="text"
                  className="form-input"
                  value={lightingConfig.name || ''}
                  onChange={e => setLightingConfig({ ...lightingConfig, name: e.target.value })}
                  placeholder="Ex: Refletor Elevatória, Iluminação Externa"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">CLP de Origem (Dispositivo)</label>
                <select
                  className="form-input"
                  value={lightingConfig.device_id || (devices[0]?.id || 1)}
                  onChange={e => setLightingConfig({ ...lightingConfig, device_id: parseInt(e.target.value) })}
                >
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.ip_address}:{d.port})</option>
                  ))}
                  {devices.length === 0 && <option value={1}>CLP Principal (127.0.0.1)</option>}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tipo de Memória Modbus</label>
                <select
                  className="form-input"
                  value={lightingConfig.modbus_type || 'coil'}
                  onChange={e => setLightingConfig({ ...lightingConfig, modbus_type: e.target.value })}
                >
                  <option value="coil">Coil (0x - Saída Digital)</option>
                  <option value="holding">Holding Register (4x - Registrador Interno)</option>
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Endereço Modbus</label>
                <input
                  type="number"
                  className="form-input"
                  value={lightingConfig.modbus_address !== undefined ? lightingConfig.modbus_address : 0}
                  onChange={e => setLightingConfig({ ...lightingConfig, modbus_address: parseInt(e.target.value) })}
                />
              </div>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSaveLightingConfig()}>
                <Save size={16} /> Salvar Configurações de Iluminação
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'general' && (
        <div style={{ background: 'var(--bg-subcard)', padding: '1.5rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: '#06b6d4', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={20} color="#06b6d4" /> Configurações Gerais do Sistema
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Personalize o nome do sistema, o título principal do dashboard e a logomarca no menu lateral.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nome do Sistema (Sidebar)</label>
              <input type="text" className="form-input" placeholder="Ex: KRONOX" value={genConfig?.system_name || ''} onChange={e => setGenConfig({ ...genConfig, system_name: e.target.value })} />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Exibição na Sidebar</label>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setGenConfig({ ...genConfig, sidebar_display: 'image' })}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
                    background: genConfig.sidebar_display !== 'text' ? 'rgba(59,130,246,0.2)' : 'var(--bg-panel)',
                    border: genConfig.sidebar_display !== 'text' ? '2px solid #3b82f6' : '2px solid var(--border-color)',
                    color: genConfig.sidebar_display !== 'text' ? '#3b82f6' : 'var(--text-secondary)'
                  }}
                >
                  🖼 Logomarca (Imagem)
                </button>
                <button
                  type="button"
                  onClick={() => setGenConfig({ ...genConfig, sidebar_display: 'text' })}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
                    background: genConfig.sidebar_display === 'text' ? 'rgba(59,130,246,0.2)' : 'var(--bg-panel)',
                    border: genConfig.sidebar_display === 'text' ? '2px solid #3b82f6' : '2px solid var(--border-color)',
                    color: genConfig.sidebar_display === 'text' ? '#3b82f6' : 'var(--text-secondary)'
                  }}
                >
                  🔤 Nome do Sistema (Texto)
                </button>
              </div>

              {genConfig.sidebar_display !== 'text' && (
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem' }}>Logomarca do Sistema (Sidebar)</label>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {genConfig?.system_logo ? (
                      <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <img
                          src={
                            genConfig.system_logo?.includes('kronox_logo')
                              ? ((document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? '/kronox_logo_dark.png' : '/kronox_logo_light.png')
                              : genConfig.system_logo
                          }
                          alt="Preview Logo"
                          style={{ height: '42px', maxWidth: '180px', objectFit: 'contain' }}
                        />
                        <button className="btn" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', padding: '0.35rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer' }} onClick={() => setGenConfig({ ...genConfig, system_logo: '' })}>
                          <Trash2 size={14} /> Remover
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <Zap size={24} color="var(--color-primary)" />
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma imagem selecionada</span>
                      </div>
                    )}
                    <label className="btn" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Upload size={16} /> Selecionar Imagem do Dispositivo
                      <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>
              )}
            </div>


            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Título da Tela Inicial (Dashboard)</label>
              <input type="text" className="form-input" placeholder="Ex: Visão Geral da Estação" value={genConfig?.dashboard_title || ''} onChange={e => setGenConfig({ ...genConfig, dashboard_title: e.target.value })} />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Fuso Horário do Sistema (Timezone / Data & Hora)</label>
              <select
                className="form-input"
                value={genConfig?.timezone || 'America/Sao_Paulo'}
                onChange={e => setGenConfig({ ...genConfig, timezone: e.target.value })}
              >
                <option value="America/Sao_Paulo">Horário de Brasília (BRT / UTC-3)</option>
                <option value="America/Manaus">Horário do Amazonas (AMT / UTC-4)</option>
                <option value="America/Noronha">Fernando de Noronha (FNT / UTC-2)</option>
                <option value="America/Rio_Branco">Horário do Acre (ACT / UTC-5)</option>
                <option value="UTC">Coordinated Universal Time (UTC / GMT+0)</option>
                <option value="Europe/Lisbon">Lisboa / Portugal (WEST / UTC+1)</option>
                <option value="America/New_York">New York / USA (EST / UTC-5)</option>
              </select>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                Todos os gráficos, alarmes e registros de telemetria usarão este fuso horário.
              </span>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Intervalo de Gravação do Histórico no Banco (Segundos)</label>
              <input
                type="number"
                className="form-input"
                min="1"
                max="3600"
                placeholder="Ex: 15"
                value={genConfig?.history_interval_seconds !== undefined ? genConfig.history_interval_seconds : 15}
                onChange={e => setGenConfig({ ...genConfig, history_interval_seconds: parseInt(e.target.value) || 1 })}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                Frequência com que cada variável é gravada continuamente no banco de dados (padrão: 15 segundos).
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={handleSaveGeneralConfig}>
                <Save size={16} /> Salvar Configurações
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div style={{ background: 'var(--bg-subcard)', padding: '1.5rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: '#06b6d4', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={20} color="#06b6d4" /> Gestão de Usuários e Controle de Acesso
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Cadastre novos usuários, altere senhas de acesso e gerencie permissões (Administrador ou Operador).
          </p>

          {/* Form de Cadastro / Edição */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem', background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '8px', border: editingUserId ? '1px solid var(--color-primary)' : '1px solid var(--border-color)' }}>
            <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              {editingUserId ? '✏️ Alterar Credenciais de Usuário' : '➕ Cadastrar Novo Usuário'}
            </h4>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '180px' }}>
                <label className="form-label">Nome de Usuário</label>
                <input type="text" className="form-input" placeholder="Ex: operador1" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} />
              </div>

              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '180px' }}>
                <label className="form-label">{editingUserId ? 'Nova Senha (Vazio = Manter)' : 'Senha de Acesso'}</label>
                <input type="password" className="form-input" placeholder={editingUserId ? 'Mudar senha...' : 'Senha'} value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
              </div>

              <div className="form-group" style={{ marginBottom: 0, width: '180px' }}>
                <label className="form-label">Nível de Permissão</label>
                <select className="form-input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="operator">Operador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              {editingUserId && (
                <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }} onClick={() => {
                  setEditingUserId(null);
                  setNewUser({ username: '', password: '', role: 'operator' });
                }}>
                  Cancelar
                </button>
              )}
              <button className="btn btn-primary" onClick={handleAddOrUpdateUser}>
                {editingUserId ? <Save size={16} /> : <Plus size={16} />}
                {editingUserId ? ' Atualizar Credenciais' : ' Cadastrar Usuário'}
              </button>
            </div>
          </div>

          {/* Tabela / Lista de Usuários Cadastrados */}
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '1rem' }}>Usuários Cadastrados</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {users.map(u => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-card)', borderRadius: '8px', alignItems: 'center', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: u.role === 'admin' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: u.role === 'admin' ? 'var(--color-primary)' : 'var(--color-normal)' }}>
                    <User size={20} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '1rem', color: 'var(--text-primary)', display: 'block' }}>{u.username}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Perfil: <span style={{ fontWeight: 600, color: u.role === 'admin' ? 'var(--color-primary)' : 'var(--color-normal)' }}>{u.role === 'admin' ? 'Administrador' : 'Operador'}</span>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-primary)', padding: '0.5rem', cursor: 'pointer' }} title="Editar Usuário" onClick={() => handleEditUser(u)}>
                    <Edit2 size={16} />
                  </button>
                  <button className="btn" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)', padding: '0.5rem', cursor: 'pointer' }} title="Excluir Usuário" onClick={() => handleDeleteUser(u.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {users.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Nenhum usuário encontrado.</p>}
          </div>
        </div>
      )}

      {/* ABA DE AUDITORIA DE SEGURANÇA */}
      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={20} color="#3b82f6" /> Logs de Auditoria & Segurança
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                Registro cronológico de acessos, escritas Modbus e alterações de configurações.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                className="btn"
                onClick={fetchAuditLogs}
                disabled={auditLoading}
                style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}
              >
                <RefreshCw size={15} style={{ animation: auditLoading ? 'spin 1s linear infinite' : 'none' }} />
                {auditLoading ? 'Atualizando...' : 'Atualizar'}
              </button>

              <button
                className="btn btn-primary"
                onClick={handleExportAuditCSV}
                style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
              >
                <Download size={15} /> Exportar Auditoria (.CSV)
              </button>
            </div>
          </div>

          {/* Filtro de Busca */}
          <div style={{ position: 'relative' }}>
            <Search size={18} color="var(--text-secondary)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Filtrar por usuário, ação ou detalhe..."
              value={auditSearch}
              onChange={e => setAuditSearch(e.target.value)}
              style={{ paddingLeft: '2.5rem', width: '100%' }}
            />
          </div>

          {/* Tabela de Audit Logs */}
          <div style={{ overflowX: 'auto', background: 'var(--bg-subcard)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>Data / Hora</th>
                  <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>Usuário</th>
                  <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>Ação</th>
                  <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>Detalhes / Parâmetro</th>
                  <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>Novo Valor</th>
                  <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs
                  .filter(l => {
                    if (!auditSearch.trim()) return true;
                    const q = auditSearch.toLowerCase();
                    return (
                      (l.user || '').toLowerCase().includes(q) ||
                      (l.action || '').toLowerCase().includes(q) ||
                      (l.param_name || '').toLowerCase().includes(q) ||
                      (l.new_value || '').toLowerCase().includes(q)
                    );
                  })
                  .map((log, idx) => (
                    <tr key={log.id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(log.timestamp).toLocaleString('pt-BR')}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {log.user || 'Sistema'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                          background: (log.action || '').includes('LOGIN') ? 'rgba(59,130,246,0.15)' : (log.action || '').includes('MODBUS') ? 'rgba(245,158,11,0.15)' : 'rgba(147,51,234,0.15)',
                          color: (log.action || '').includes('LOGIN') ? '#60a5fa' : (log.action || '').includes('MODBUS') ? '#fbbf24' : '#c084fc'
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>
                        {log.param_name || '-'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: '#10b981' }}>
                        {log.new_value !== undefined && log.new_value !== '' ? String(log.new_value) : '-'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                          background: log.status === 'FALHA' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                          color: log.status === 'FALHA' ? '#ef4444' : '#10b981'
                        }}>
                          {log.status || 'SUCESSO'}
                        </span>
                      </td>
                    </tr>
                  ))}

                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      Nenhum registro de auditoria encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL EXPORTAR TELEMETRIA DE VARIÁVEIS (.CSV) */}
      {showTelemetryModal && (
        <div className="overlay" onClick={() => setShowTelemetryModal(false)} style={{ zIndex: 10000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px', width: '92%', padding: '2rem', background: 'rgba(15, 23, 42, 0.96)', backdropFilter: 'blur(25px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 60px rgba(0,0,0,0.9)', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', color: '#06b6d4', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={22} color="#06b6d4" /> Exportar Telemetria de Variáveis (.CSV)
              </h2>
              <button onClick={() => setShowTelemetryModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Presets de Período */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>1. Selecionar Período de Tempo</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {[
                    { id: '1h', label: 'Última 1h' },
                    { id: '24h', label: 'Últimas 24h' },
                    { id: '7d', label: 'Últimos 7 Dias' },
                    { id: 'custom', label: 'Personalizado' },
                  ].map(p => (
                    <button
                      key={p.id}
                      className="btn"
                      style={{
                        padding: '0.5rem',
                        fontSize: '0.8rem',
                        background: telemetryFilter.preset === p.id ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)',
                        color: telemetryFilter.preset === p.id ? 'white' : 'var(--text-secondary)',
                        border: telemetryFilter.preset === p.id ? '1px solid var(--color-primary)' : '1px solid rgba(255,255,255,0.08)'
                      }}
                      onClick={() => setTelemetryFilter({ ...telemetryFilter, preset: p.id })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Data/Hora Personalizada se preset === 'custom' */}
              {telemetryFilter.preset === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Data/Hora Inicial</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={telemetryFilter.start_time}
                      onChange={e => setTelemetryFilter({ ...telemetryFilter, start_time: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Data/Hora Final</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={telemetryFilter.end_time}
                      onChange={e => setTelemetryFilter({ ...telemetryFilter, end_time: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Intervalo de Amostragem (Downsampling Resolution) */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>2. Frequência de Amostragem dos Dados (Resolução)</label>
                <select
                  className="form-input"
                  style={{ marginTop: '0.5rem' }}
                  value={telemetryFilter.step_seconds}
                  onChange={e => setTelemetryFilter({ ...telemetryFilter, step_seconds: parseInt(e.target.value) })}
                >
                  <option value={0}>Todos os Dados Brutos (Tempo Real)</option>
                  <option value={10}>A cada 10 Segundos</option>
                  <option value={60}>A cada 1 Minuto</option>
                  <option value={300}>A cada 5 Minutos</option>
                  <option value={900}>A cada 15 Minutos</option>
                  <option value={3600}>A cada 1 Hora</option>
                </select>
              </div>

              {/* Seleção de Variáveis */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>3. Variáveis Selecionadas</label>
                  <button
                    style={{ background: 'none', border: 'none', color: '#06b6d4', fontSize: '0.8rem', cursor: 'pointer' }}
                    onClick={() => {
                      if (telemetryFilter.selected_var_ids.length === variables.length) {
                        setTelemetryFilter({ ...telemetryFilter, selected_var_ids: [] });
                      } else {
                        setTelemetryFilter({ ...telemetryFilter, selected_var_ids: variables.map(v => v.id) });
                      }
                    }}
                  >
                    {telemetryFilter.selected_var_ids.length === variables.length ? 'Desmarcar Todas' : 'Selecionar Todas'}
                  </button>
                </div>

                <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {variables.map(v => {
                    const isSelected = telemetryFilter.selected_var_ids.length === 0 || telemetryFilter.selected_var_ids.includes(v.id);
                    return (
                      <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            let currentIds = telemetryFilter.selected_var_ids.length === 0 ? variables.map(x => x.id) : [...telemetryFilter.selected_var_ids];
                            if (e.target.checked) {
                              if (!currentIds.includes(v.id)) currentIds.push(v.id);
                            } else {
                              currentIds = currentIds.filter(id => id !== v.id);
                            }
                            setTelemetryFilter({ ...telemetryFilter, selected_var_ids: currentIds });
                          }}
                        />
                        <span><strong>{v.display_name}</strong> <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({v.name})</span></span>
                      </label>
                    );
                  })}
                  {variables.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhuma variável cadastrada.</p>}
                </div>
              </div>

              {/* Ações do Modal */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                <button className="btn" onClick={() => setShowTelemetryModal(false)} style={{ background: 'rgba(255,255,255,0.08)' }}>
                  Cancelar
                </button>
                <button className="btn btn-primary" style={{ background: '#06b6d4', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none', cursor: 'pointer' }} onClick={handleExportTelemetryCSV}>
                  <Download size={16} /> Baixar Relatório (.CSV)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          right: '2rem',
          background: notification.type === 'error' ? 'var(--color-danger)' : (notification.type === 'success' ? 'var(--color-normal)' : 'var(--color-primary)'),
          color: 'white',
          padding: '1rem 2rem',
          borderRadius: '8px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.3s ease-out',
          zIndex: 100
        }}>
          {notification.msg}
        </div>
      )}

      {/* MODAL ASSISTENTE DE BLOCOS (3 PASSOS - IDÊNTICO À IMAGEM) */}
      {showWizard && (
        <div className="overlay" onClick={() => setShowWizard(false)} style={{ zIndex: 10000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '880px', width: '92%', padding: '2rem', background: 'rgba(15, 23, 42, 0.96)', backdropFilter: 'blur(25px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 60px rgba(0,0,0,0.9)', borderRadius: '16px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

            {/* Header com os 3 Passos (Stepper idêntico à imagem) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flex: 1, justifyContent: 'center' }}>

                {/* Passo 1 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', opacity: wizardStep === 1 ? 1 : 0.6 }}>
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '50%',
                    background: wizardStep === 1 ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.05)',
                    color: 'white', fontWeight: 'bold', fontSize: '1rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: wizardStep === 1 ? '3px dashed #67e8f9' : '1px solid rgba(255,255,255,0.2)',
                    boxShadow: wizardStep === 1 ? '0 0 15px rgba(6, 182, 212, 0.5)' : 'none'
                  }}>
                    1
                  </div>
                  <span style={{ fontSize: '0.85rem', color: wizardStep === 1 ? '#06b6d4' : 'var(--text-secondary)', fontWeight: wizardStep === 1 ? 'bold' : 'normal' }}>
                    Tipo de bloco
                  </span>
                </div>

                <div style={{ height: '2px', width: '50px', background: wizardStep > 1 ? '#06b6d4' : 'rgba(255,255,255,0.1)' }}></div>

                {/* Passo 2 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', opacity: wizardStep === 2 ? 1 : 0.6 }}>
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '50%',
                    background: wizardStep === 2 ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.05)',
                    color: 'white', fontWeight: 'bold', fontSize: '1rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: wizardStep === 2 ? '3px dashed #67e8f9' : '1px solid rgba(255,255,255,0.2)',
                    boxShadow: wizardStep === 2 ? '0 0 15px rgba(6, 182, 212, 0.5)' : 'none'
                  }}>
                    2
                  </div>
                  <span style={{ fontSize: '0.85rem', color: wizardStep === 2 ? '#06b6d4' : 'var(--text-secondary)', fontWeight: wizardStep === 2 ? 'bold' : 'normal' }}>
                    Configurar título
                  </span>
                </div>

                <div style={{ height: '2px', width: '50px', background: wizardStep > 2 ? '#06b6d4' : 'rgba(255,255,255,0.1)' }}></div>

                {/* Passo 3 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', opacity: wizardStep === 3 ? 1 : 0.6 }}>
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '50%',
                    background: wizardStep === 3 ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.05)',
                    color: 'white', fontWeight: 'bold', fontSize: '1rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: wizardStep === 3 ? '3px dashed #67e8f9' : '1px solid rgba(255,255,255,0.2)',
                    boxShadow: wizardStep === 3 ? '0 0 15px rgba(6, 182, 212, 0.5)' : 'none'
                  }}>
                    3
                  </div>
                  <span style={{ fontSize: '0.85rem', color: wizardStep === 3 ? '#06b6d4' : 'var(--text-secondary)', fontWeight: wizardStep === 3 ? 'bold' : 'normal' }}>
                    Configurar dados
                  </span>
                </div>

              </div>

              <button className="btn" style={{ padding: '0.25rem 0.5rem', background: 'transparent', color: 'var(--text-secondary)', fontSize: '1.2rem' }} onClick={() => setShowWizard(false)}>✕</button>
            </div>

            {/* Conteúdo dos Passos */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>

              {/* PASSO 1: Selecionar Tipo de Bloco */}
              {wizardStep === 1 && (
                <div>
                  <h4 style={{ color: 'white', marginBottom: '1rem', fontSize: '0.95rem' }}>Selecione o formato do bloco para o seu Dashboard:</h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {BLOCK_TYPES.map(bt => {
                      const IconComp = bt.icon;
                      const isSelected = newVar.widget_type === bt.id;
                      return (
                        <div
                          key={bt.id}
                          onClick={() => {
                            setNewVar({ ...newVar, widget_type: bt.id, type: (bt.id === 'switch' || bt.id === 'bitmap' ? 'boolean' : 'analog') });
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.75rem 1rem', borderRadius: '10px',
                            background: isSelected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.02)',
                            border: isSelected ? '2px solid #06b6d4' : '1px solid rgba(255,255,255,0.08)',
                            boxShadow: isSelected ? '0 0 15px rgba(6, 182, 212, 0.25)' : 'none',
                            cursor: 'pointer', transition: 'all 0.2s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <IconComp size={18} color={isSelected ? '#06b6d4' : 'var(--text-secondary)'} />
                            <span style={{ color: isSelected ? 'white' : 'var(--text-primary)', fontSize: '0.85rem', fontWeight: isSelected ? 'bold' : 'normal' }}>
                              {bt.label}
                            </span>
                          </div>

                          <div
                            style={{ position: 'relative', cursor: 'help' }}
                            onMouseEnter={() => setActiveTooltip(bt.id)}
                            onMouseLeave={() => setActiveTooltip(null)}
                          >
                            <Info size={16} color={isSelected ? '#06b6d4' : 'var(--text-secondary)'} />
                            {activeTooltip === bt.id && (
                              <div style={{
                                position: 'absolute', right: '110%', top: '50%', transform: 'translateY(-50%)',
                                width: '220px', background: 'rgba(15,23,42,0.95)', border: '1px solid var(--border-highlight)',
                                padding: '0.75rem', borderRadius: '8px', zIndex: 1000, fontSize: '0.8rem', color: '#cbd5e1',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.8)', pointerEvents: 'none'
                              }}>
                                {bt.info}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PASSO 2: Configurar Título & Aparência */}
              {wizardStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <h4 style={{ color: 'white', marginBottom: '0.5rem', fontSize: '0.95rem' }}>Defina o título e exibição no painel:</h4>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Título Exibido no Painel (Display Name)</label>
                    <input type="text" className="form-input" placeholder="ex: Nível da Elevatória 1" value={newVar.display_name} onChange={e => setNewVar({ ...newVar, display_name: e.target.value })} autoFocus />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Nome Técnico (Tag Interna)</label>
                    <input type="text" className="form-input" placeholder="ex: nivel_elevatoria_1" value={newVar.name} onChange={e => setNewVar({ ...newVar, name: e.target.value })} />
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Tela Destino (Categoria)</label>
                      <select className="form-input" value={newVar.category} onChange={e => setNewVar({ ...newVar, category: e.target.value })}>
                        <option value="supervision">Supervisão (Dashboard Principal)</option>
                        <option value="engineering">Engenharia (Parâmetros)</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ width: '120px', marginBottom: 0 }}>
                      <label className="form-label">Cor de Destaque</label>
                      <input type="color" style={{ width: '100%', height: '42px', padding: '0 4px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '6px' }} value={newVar.color} onChange={e => setNewVar({ ...newVar, color: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* PASSO 3: Configurar Dados Modbus */}
              {wizardStep === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <h4 style={{ color: 'white', marginBottom: '0.5rem', fontSize: '0.95rem' }}>Vincule aos dados do barramento Modbus:</h4>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">CLP de Origem (Dispositivo)</label>
                    <select className="form-input" value={newVar.device_id} onChange={e => setNewVar({ ...newVar, device_id: e.target.value })}>
                      {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.ip_address}:{d.port})</option>)}
                      {devices.length === 0 && <option value={1}>CLP Principal (127.0.0.1)</option>}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Função Modbus</label>
                      <select className="form-input" value={newVar.modbus_type} onChange={e => setNewVar({ ...newVar, modbus_type: e.target.value })}>
                        <option value="holding">Holding Register (4x - Registrador Interno)</option>
                        <option value="input">Input Register (3x - Entrada Analógica)</option>
                        <option value="coil">Coil (0x - Saída Digital / Comando)</option>
                        <option value="discrete">Discrete Input (1x - Entrada Digital)</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ width: '120px', marginBottom: 0 }}>
                      <label className="form-label">Endereço</label>
                      <input type="number" className="form-input" value={newVar.modbus_address} onChange={e => setNewVar({ ...newVar, modbus_address: parseInt(e.target.value) })} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Casas Decimais (Divisor 10^N)</label>
                      <input type="number" className="form-input" value={newVar.decimals} onChange={e => setNewVar({ ...newVar, decimals: parseInt(e.target.value) })} placeholder="0" />
                    </div>

                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Unidade de Medida</label>
                      <input type="text" className="form-input" placeholder="ex: m, A, V, °C, %" value={newVar.unit} onChange={e => setNewVar({ ...newVar, unit: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Rodapé com Navegação */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {wizardStep > 1 ? (
                <button className="btn" onClick={() => setWizardStep(wizardStep - 1)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}>
                  <ChevronLeft size={16} /> Voltar
                </button>
              ) : <div></div>}

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn" onClick={() => setShowWizard(false)} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
                  Cancelar
                </button>

                {wizardStep < 3 ? (
                  <button className="btn btn-primary" onClick={() => setWizardStep(wizardStep + 1)}>
                    Próximo Passo <ChevronRight size={16} />
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => {
                    handleAddVariable();
                    setShowWizard(false);
                  }} disabled={!newVar.name || !newVar.display_name}>
                    <Sparkles size={16} /> Finalizar e Criar Bloco
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default ConfigPanel;
