import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Maximize2, RefreshCw, WifiOff, Play, AlertCircle } from 'lucide-react';

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && window.location) {
    if (window.location.port === '5173') return '';
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return '';
  }
  return 'http://localhost:3001';
};

function CameraStream({ cam }) {
  const [status, setStatus] = useState('connecting'); // connecting | live | error
  const [errorMsg, setErrorMsg] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const retryTimeout = useRef(null);

  const streamUrl = `${getBaseUrl()}/api/cameras/${cam.id}/stream?t=${retryCount}`;

  const handleLoad = () => {
    setStatus('live');
    setErrorMsg('');
  };

  const handleError = useCallback(() => {
    setStatus('error');
    setErrorMsg('Não foi possível conectar ao stream RTSP. Verifique se a câmera está acessível e se o FFmpeg está instalado no servidor.');
    // Auto-retry após 10s
    clearTimeout(retryTimeout.current);
    retryTimeout.current = setTimeout(() => {
      setStatus('connecting');
      setRetryCount(c => c + 1);
    }, 10000);
  }, []);

  const handleRetry = () => {
    clearTimeout(retryTimeout.current);
    setStatus('connecting');
    setErrorMsg('');
    setRetryCount(c => c + 1);
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    }
  };

  useEffect(() => {
    return () => clearTimeout(retryTimeout.current);
  }, []);

  const isRtsp = cam.url && cam.url.toLowerCase().startsWith('rtsp');

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {/* Header */}
      <div className="card-header" style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Camera size={18} color="var(--color-primary)" />
          {cam.name}
          {/* Status pill */}
          <span style={{
            fontSize: '0.7rem',
            padding: '2px 8px',
            borderRadius: '999px',
            fontWeight: 600,
            background: status === 'live' ? 'rgba(34,197,94,0.15)' : status === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(251,191,36,0.15)',
            color: status === 'live' ? '#22c55e' : status === 'error' ? '#ef4444' : '#fbbf24',
            border: `1px solid ${status === 'live' ? 'rgba(34,197,94,0.3)' : status === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(251,191,36,0.3)'}`,
          }}>
            {status === 'live' ? '● AO VIVO' : status === 'error' ? '● OFFLINE' : '● CONECTANDO...'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            className="btn"
            title="Reconectar"
            onClick={handleRetry}
            style={{ background: 'rgba(255,255,255,0.05)', padding: '0.4rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <RefreshCw size={15} style={{ display: 'block' }} />
          </button>
          <button
            className="btn"
            title="Tela cheia"
            onClick={handleFullscreen}
            style={{ background: 'rgba(255,255,255,0.05)', padding: '0.4rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Maximize2 size={15} style={{ display: 'block' }} />
          </button>
        </div>
      </div>

      {/* Stream container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          background: '#020508',
          borderRadius: '10px',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {isRtsp ? (
          <>
            {/* MJPEG stream via proxy backend */}
            <img
              ref={imgRef}
              src={streamUrl}
              alt={cam.name}
              onLoad={handleLoad}
              onError={handleError}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: status === 'error' ? 'none' : 'block',
              }}
            />

            {/* Overlay: Conectando */}
            {status === 'connecting' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem',
                color: '#fbbf24', background: 'rgba(2,5,8,0.85)'
              }}>
                <RefreshCw size={32} style={{ animation: 'spin 1.2s linear infinite' }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Conectando ao stream RTSP...</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '360px', textAlign: 'center' }}>
                  {cam.url.replace(/:([^@]+)@/, ':***@')}
                </span>
              </div>
            )}

            {/* Overlay: Erro */}
            {status === 'error' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem',
                background: 'rgba(2,5,8,0.92)', padding: '2rem', textAlign: 'center'
              }}>
                <WifiOff size={40} color="#ef4444" />
                <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '1rem' }}>Stream Indisponível</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: '380px', lineHeight: 1.5 }}>
                  {errorMsg}
                </div>
                <button className="btn" onClick={handleRetry} style={{
                  marginTop: '0.5rem', background: 'var(--color-primary)', color: '#fff',
                  padding: '0.5rem 1.25rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.4rem'
                }}>
                  <Play size={14} /> Tentar Novamente
                </button>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  Reconexão automática em 10 segundos...
                </div>
              </div>
            )}

            {/* Cantos decorativos ao vivo */}
            {status === 'live' && (
              <>
                <div style={{ position: 'absolute', top: '0.6rem', left: '0.75rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  REC
                </div>
                <div style={{ position: 'absolute', top: '0.6rem', right: '0.75rem', color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                  {new Date().toLocaleTimeString('pt-BR')}
                </div>
              </>
            )}
          </>
        ) : (
          /* URL não é RTSP — mostrar placeholder informativo */
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
            color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center'
          }}>
            <AlertCircle size={36} color="rgba(251,191,36,0.7)" />
            <div style={{ fontWeight: 600, color: '#fbbf24' }}>URL Não Suportada</div>
            <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              Para streaming ao vivo, configure uma URL no formato:<br />
              <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                rtsp://usuario:senha@ip:554/caminho
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CamerasPanel({ plcState, cameras = [] }) {
  if (cameras.length === 0) {
    return (
      <div className="dashboard-grid">
        <div className="card" style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center' }}>
          <Camera size={40} color="var(--text-muted)" style={{ margin: '0 auto 1rem', display: 'block' }} />
          <div style={{ color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.5rem' }}>
            Nenhuma câmera configurada
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Adicione câmeras na aba <strong>Configuração → Câmeras</strong> com a URL RTSP do dispositivo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      {cameras.map(cam => (
        <CameraStream key={cam.id} cam={cam} />
      ))}
    </div>
  );
}

export default CamerasPanel;
