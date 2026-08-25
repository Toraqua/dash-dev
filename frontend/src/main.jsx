import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0b0f19', color: '#f8fafc', fontFamily: 'sans-serif', textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ color: '#ef4444', marginBottom: '0.5rem' }}>Ocorreu um erro na exibição da aplicação</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '500px', marginBottom: '1.5rem' }}>
            {this.state.error?.toString() || 'Erro desconhecido.'}
          </p>
          <button 
            onClick={() => window.location.reload()} 
            style={{ padding: '0.6rem 1.5rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Recarregar Aplicação
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

