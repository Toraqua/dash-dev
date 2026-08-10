import React, { useState } from 'react';
import { Camera, Lightbulb, Maximize2, RefreshCw } from 'lucide-react';

function CamerasPanel({ plcState, cameras = [] }) {
  // Simulação de estado de luz que seria idealmente propagada pelo backend também
  const [lightingState, setLightingState] = useState(plcState.lighting === 'On');
  const [refreshing, setRefreshing] = useState({});

  const toggleLighting = () => {
    // Na vida real faria uma requisição para ligar relé de luz
    setLightingState(!lightingState);
  };

  const handleRefresh = (id) => {
    setRefreshing({ ...refreshing, [id]: true });
    setTimeout(() => setRefreshing({ ...refreshing, [id]: false }), 1500);
  };

  return (
    <div className="dashboard-grid">
      
      {cameras.length === 0 && (
        <div className="card" style={{ gridColumn: '1 / -1', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Nenhuma câmera configurada. Adicione câmeras na aba Configuração.
        </div>
      )}

      {cameras.map(cam => (
        <div className="card" key={cam.id} style={{ gridColumn: '1 / -1' }}>
          <div className="card-header" style={{ marginBottom: '1rem' }}>
            <div className="card-title">
              <Camera size={20} color="var(--color-primary)" />
              {cam.name}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" style={{ background: 'rgba(255,255,255,0.05)', padding: '0.5rem' }} onClick={() => handleRefresh(cam.id)}>
                <RefreshCw size={16} className={refreshing[cam.id] ? 'spinning' : ''} style={{ transition: 'transform 0.5s', transform: refreshing[cam.id] ? 'rotate(180deg)' : 'none' }} />
              </button>
              <button className="btn" style={{ background: 'rgba(255,255,255,0.05)', padding: '0.5rem' }}>
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
          
          <div style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16/9',
            background: '#050810',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 0 50px rgba(0,0,0,0.8)'
          }}>
            {refreshing[cam.id] ? (
              <div style={{ color: 'var(--color-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <RefreshCw size={32} className="spinning" style={{ animation: 'pulse 1s infinite' }} />
                <span>Conectando ao stream RTSP...</span>
              </div>
            ) : (
              <>
                {cam.url && !cam.url.startsWith('http://simulated') ? (
                  <iframe src={cam.url} style={{ width: '100%', height: '100%', border: 'none' }} title={cam.name}></iframe>
                ) : (
                  <>
                    <div style={{ position: 'absolute', top: '1rem', right: '1rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      REC 🔴 {new Date().toLocaleTimeString()}
                    </div>
                    <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      KRONOX CAM {cam.id} - H264
                    </div>
                    <div style={{ 
                      width: '100%', height: '100%', 
                      background: 'linear-gradient(45deg, rgba(0,0,0,0.8) 0%, rgba(20,30,50,0.5) 100%)',
                      backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 4px)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)'
                    }}>
                      [ FEED DE VÍDEO OFFLINE NO AMBIENTE DE DESENVOLVIMENTO ]
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default CamerasPanel;
