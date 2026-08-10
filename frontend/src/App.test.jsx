import React from 'react';
import { render, screen, act } from '@testing-library/react';
import App from './App';
import * as ioModule from 'socket.io-client';

// Mock do socket.io-client
vi.mock('socket.io-client', () => {
  const mSocket = {
    on: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
  };
  return {
    io: vi.fn(() => mSocket)
  };
});

describe('Sistema de Supervisão (Frontend)', () => {
  let mockSocket;
  let socketEventCallbacks = {};

  beforeEach(() => {
    socketEventCallbacks = {};
    
    // Configura o mock para interceptar callbacks de eventos
    mockSocket = {
      on: vi.fn((event, callback) => {
        socketEventCallbacks[event] = callback;
      }),
      emit: vi.fn(),
      close: vi.fn(),
    };
    
    ioModule.io.mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deve exibir status de Offline em caso de perda de comunicação', () => {
    render(<App />);

    // Simulando a conexão bem sucedida inicial
    act(() => {
      if (socketEventCallbacks['connect']) socketEventCallbacks['connect']();
    });

    // Simulando recebimento de dados do PLC
    act(() => {
      if (socketEventCallbacks['update']) {
        socketEventCallbacks['update']({
          level: 2.5,
          pump1: 'Normal',
          pump1_active: true,
          pump2: 'Normal',
          pump2_active: false,
          alarms: [],
          connected: true, // PLC conectado ao Backend
          camera: 'Online',
          lighting: 'On'
        });
      }
      if (socketEventCallbacks['config']) {
        socketEventCallbacks['config']({
          alarm_high_sp: 4.5,
          pump1_start_level: 2.0,
          pump1_stop_level: 1.0,
          pump2_start_level: 3.0,
          pump2_stop_level: 1.5,
        });
      }
    });

    // A UI deve mostrar "Sistema Online" (conectado ao PLC/Backend)
    expect(screen.getByText('Sistema Online')).toBeInTheDocument();
    
    // Cenário Crítico: Queda de conexão (simulando cabo de rede desconectado)
    act(() => {
      if (socketEventCallbacks['disconnect']) socketEventCallbacks['disconnect']();
    });

    // A UI deve reagir e alterar o status para Offline
    expect(screen.getByText('Sistema Offline')).toBeInTheDocument();
  });

  it('deve reconectar automaticamente e restaurar o status quando a comunicação voltar', () => {
    render(<App />);

    // Simula disconnect primeiro
    act(() => {
      if (socketEventCallbacks['disconnect']) socketEventCallbacks['disconnect']();
    });
    expect(screen.getByText('Sistema Offline')).toBeInTheDocument();

    // Simula que a conexão voltou (reconexão automática do socket.io)
    act(() => {
      if (socketEventCallbacks['connect']) socketEventCallbacks['connect']();
      if (socketEventCallbacks['update']) {
        socketEventCallbacks['update']({
          level: 2.5,
          pump1: 'Normal',
          pump1_active: true,
          pump2: 'Normal',
          pump2_active: false,
          alarms: [],
          connected: true, // reconectado
          camera: 'Online',
          lighting: 'On'
        });
      }
    });

    // UI deve restaurar o status
    expect(screen.getByText('Sistema Online')).toBeInTheDocument();
  });

  it('deve navegar entre as abas Câmeras e Alarmes', () => {
    render(<App />);

    // Clica na aba Câmeras
    const camerasButton = screen.getByText('Câmeras');
    act(() => {
      camerasButton.click();
    });
    
    // Verifica se o título da página mudou
    expect(screen.getByText('Monitoramento de CFTV')).toBeInTheDocument();

    // Clica na aba Alarmes
    const alarmsButton = screen.getByText('Alarmes');
    act(() => {
      alarmsButton.click();
    });
    
    // Verifica se o título da página mudou
    expect(screen.getByText('Alarmes e Histórico')).toBeInTheDocument();
  });
});
