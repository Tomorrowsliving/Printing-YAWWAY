#!/bin/bash

# Klipper Farm Node Agent Installer
# Usage: sudo ./install.sh --backend-url http://SERVER_IP:8001 --port 8001

set -e

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

BACKEND_URL=""
AGENT_PORT="8001"
INSTALL_DIR="/opt/klipper-farm-node-agent"
ENV_FILE="/etc/klipper-farm-node-agent.env"
SERVICE_FILE="/etc/systemd/system/klipper-farm-node-agent.service"
SUDOERS_FILE="/etc/sudoers.d/klipper-farm-node-agent"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --backend-url) BACKEND_URL="$2"; shift ;;
        --port) AGENT_PORT="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$BACKEND_URL" ]; then
    echo "Error: --backend-url is required"
    echo "Usage: sudo ./install.sh --backend-url http://10.1.8.133:8001 [--port 8001]"
    exit 1
fi

echo "--- Initialising Klipper Farm Node Agent Installation ---"

# 1. Install system dependencies
echo "Installing system dependencies..."
apt-get update
apt-get install -y python3 python3-venv python3-pip git curl tar

# 2. Create installation directory
echo "Setting up directory $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"

# 3. Create virtual environment
echo "Creating Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# 4. Create environment file
echo "Creating environment file $ENV_FILE..."
cat <<EOF > "$ENV_FILE"
BACKEND_URL=$BACKEND_URL
NODE_AGENT_PORT=$AGENT_PORT
NODE_AGENT_DIR=$INSTALL_DIR
EOF
chmod 600 "$ENV_FILE"

# 5. Create systemd service
echo "Creating systemd service..."
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Klipper Farm Node Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/venv/bin/python3 main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 6. Create narrow sudoers file for auto-updates
echo "Configuring sudoers for service management..."
cat <<EOF > "$SUDOERS_FILE"
# Allow node-agent to restart its own service for updates
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart klipper-farm-node-agent.service
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl status klipper-farm-node-agent.service
EOF
chmod 440 "$SUDOERS_FILE"

# 7. Enable and start service
echo "Starting service..."
systemctl daemon-reload
systemctl enable klipper-farm-node-agent
systemctl restart klipper-farm-node-agent

# 8. Final Health Check Info
NODE_IP=$(hostname -I | awk '{print $1}')
echo "--- Installation Complete ---"
echo "Node Agent is running at: http://$NODE_IP:$AGENT_PORT"
echo "Health check URL: http://$NODE_IP:$AGENT_PORT/health"
echo "Backend URL configured as: $BACKEND_URL"
