#!/bin/bash
# ==============================================================================
# KRONOX OS / DASH - Automated Installer for Raspberry Pi OS (64-bit)
# ==============================================================================

set -e

echo "🚀 Iniciando a instalação do KRONOX OS / Dash..."

# 1. Checar privilégios de superusuário (root)
if [ "$EUID" -ne 0 ]; then
  echo "❌ Por favor, execute como root: sudo bash install.sh"
  exit 1
fi

INSTALL_DIR="/opt/kronox-dash"
REPO_URL="https://github.com/Toraqua/Dash.git"

# 2. Atualizar pacotes e instalar dependências do sistema
echo "📦 Instalando dependências do sistema (Node.js, Git, NetworkManager)..."
apt-get update -y || true
apt-get install -y --fix-missing curl git network-manager build-essential sqlite3 || true

# Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
  echo "🟢 Instalando Node.js v20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
  apt-get install -y nodejs || true
fi

echo "✅ Node.js versão: $(node -v)"
echo "✅ NPM versão: $(npm -v)"

# 3. Clonar ou atualizar o repositório em /opt/kronox-dash
if [ -d "$INSTALL_DIR" ]; then
  echo "🔄 Atualizando código existente em $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git pull origin main
else
  echo "📥 Clonando o repositório $REPO_URL..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 4. Instalar dependências do Backend
echo "⚙️ Instalando dependências do Backend..."
cd "$INSTALL_DIR/backend"
npm install --production
chmod -R 777 "$INSTALL_DIR/backend"

# 5. Instalar dependências do Frontend e Compilar
echo "🎨 Compilando o Frontend React..."
cd "$INSTALL_DIR/frontend"
npm install
npm run build

# Liberar permissões completas no diretório
chmod -R 777 "$INSTALL_DIR"

# 6. Liberar a porta 3001 no Firewall (UFW / iptables)
echo "🛡️ Liberando porta 3001 no Firewall..."
ufw allow 3001/tcp 2>/dev/null || iptables -A INPUT -p tcp --dport 3001 -j ACCEPT 2>/dev/null || true

NODE_BIN=$(which node || echo "/usr/bin/node")
echo "📍 Caminho do Node.js: $NODE_BIN"

# 7. Configurar o Serviço systemd (Auto-start no boot)
echo "⚡ Configurando o serviço no systemd (Auto-start no boot)..."
cat << EOF > /etc/systemd/system/kronox-dash.service
[Unit]
Description=KRONOX OS / Dash Supervisory System
After=network.target network-online.target NetworkManager.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/kronox-dash/backend
ExecStart=${NODE_BIN} server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\$(dirname ${NODE_BIN})

[Install]
WantedBy=multi-user.target
EOF

# 8. Recarregar e Iniciar o Serviço
systemctl daemon-reload
systemctl enable kronox-dash
systemctl restart kronox-dash

echo "=============================================================================="
echo "🎉 KRONOX OS / Dash instalado com sucesso!"
echo "📍 Acesse pelo navegador: http://$(hostname -I | awk '{print $1}'):3001"
echo "🔧 Status do Serviço: sudo systemctl status kronox-dash"
echo "=============================================================================="
