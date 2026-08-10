# ⚡ KRONOX OS / Dash - Sistema Supervisório SCADA & Gateway IoT

**KRONOX OS / Dash** é um sistema supervisório web completo (SCADA / IHM) de classe industrial com suporte nativo a comunicação **Modbus RTU/TCP**, gerenciamento de **Gateway de Rede** (interfaces `eth0`, `wlan0`, `wlan1`), **VPN Netbird**, telemetria **MQTT** com buffer local em SQLite WAL e monitoramento de **Câmeras IP / RTSP**.

Projetado especialmente para rodar em hardware de baixo custo como **Raspberry Pi 3/4/5 (64-bit)** ou servidores industriais Linux/Windows.

---

## 📸 Principais Recursos

### 🎛️ 1. Supervisão & Dashboard Dinâmico (Drag & Drop)
* **Widgets Customizáveis:** Séries Temporais, Medidores Radiais/Gauges, Gráficos de Donut, Indicadores de Nível/Tanques, Barras Horizontais, Botões de Escrita Modbus, Links Externos e a nova **Lista Multibit** (Alarmes sintéticos por bit/variável).
* **Edição Interativa:** Redimensionamento e reposicionamento livre de blocos na tela com salvamento de layout no banco de dados.

### 🌐 2. Menu Gateway (Rede, VPN & MQTT)
* **Gerenciamento de Interfaces:** Configuração de IP Fixo / DHCP para `eth0`, `wlan0` e `wlan1` (Wi-Fi USB) via NetworkManager (`nmcli`).
* **Proteção Anti-Brick (Modo Seguro de 60s):** Temporizador automático de segurança ao aplicar novos IPs de rede para evitar perda de comunicação remota.
* **Rotas Estáticas Persistentes:** Cadastro e persistência de rotas Linux retentivas pós-reboot.
* **Cliente VPN Netbird:** Controle de conexão via Setup Key e status da rede mesh WireGuard.
* **Broker MQTT & Payload JSON Customizável:** Transmissão contínua de dados com editor de JSON, preview em tempo real, importação/exportação de mapeamento e **Buffer Local SQLite** com reconexão automática.

### ⚡ 3. Modbus RTU/TCP de Alta Performance
* Suporte a 16 e 32 bits (Float IEEE 754, Int32, UInt32, Int16, UInt16) com os 4 formatos de endianness (`ABCD`, `BADC`, `DCBA`, `CDAB`).
* Endereçamento 0-based padrão Modbus.

### 📊 4. Alarmes & Histórico Exportável
* Monitoramento contínuo com histórico de falhas e botões para **Exportação CSV** de relatórios de telemetria e alarmes.

---

## ⚡ Instalação Rápida no Raspberry Pi (1 Comando)

Em um **Raspberry Pi OS (64-bit)** limpo, abra o terminal e execute o comando abaixo:

```bash
curl -fsSL https://raw.githubusercontent.com/Toraqua/Dash/main/install.sh | sudo bash
```

O script irá automaticamente:
1. Instalar o Node.js v20 LTS, Git e utilitários de rede.
2. Clonar este repositório para `/opt/kronox-dash`.
3. Compilar a aplicação e configurar o banco de dados em modo **SQLite WAL**.
4. Criar e iniciar o serviço `kronox-dash.service` no `systemd` para iniciar automaticamente no boot do sistema.

Após a instalação, acesse no seu navegador: `http://<IP_DO_RASPBERRY>:3001`

---

## 🔄 Como Atualizar o Sistema Existente

Se você já possui o sistema instalado no Raspberry Pi e quer atualizar para a versão mais recente do GitHub, execute:

```bash
cd /opt/kronox-dash
sudo git pull origin main

cd /opt/kronox-dash/frontend
sudo npm install
sudo npm run build

cd /opt/kronox-dash/backend
sudo node server.js
# Ou se estiver rodando via serviço systemd:
# sudo systemctl restart kronox-dash
```

---

## 🛠️ Desenvolvido Com

* **Frontend:** React, Vite, Lucide Icons, Recharts, React-Grid-Layout.
* **Backend:** Node.js, Express, Socket.IO, SQLite3 (Modo WAL), `modbus-serial`, `mqtt`.
* **Stack de Rede:** NetworkManager (`nmcli`), Netbird CLI.

---

## 📄 Licença

Este projeto é disponibilizado sob a licença MIT. Sinta-se livre para usar e modificar.
