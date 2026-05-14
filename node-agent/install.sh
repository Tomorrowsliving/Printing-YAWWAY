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
        --install-dir) INSTALL_DIR="$2"; shift ;;
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

# 2. Create installation directory and copy files
echo "Setting up directory $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"

# 3. Create virtual environment reliably
echo "Creating Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# 4. Verify uvicorn exists
if [ ! -x "$INSTALL_DIR/venv/bin/uvicorn" ]; then
    echo "Error: uvicorn was not installed correctly in the venv."
    exit 1
fi

# 5. Create environment file
echo "Creating environment file $ENV_FILE..."
cat <<EOF_ENV > "$ENV_FILE"
BACKEND_URL=$BACKEND_URL
NODE_AGENT_PORT=$AGENT_PORT
NODE_AGENT_DIR=$INSTALL_DIR
EOF_ENV
chmod 600 "$ENV_FILE"

# 6. Create systemd service using venv uvicorn
echo "Creating systemd service..."
cat <<EOF_SVC > "$SERVICE_FILE"
[Unit]
Description=Klipper Farm Node Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/venv/bin/uvicorn main:app --host 0.0.0.0 --port $AGENT_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF_SVC

# 7. Create sudoers file for auto-updates
echo "Configuring sudoers..."
cat <<EOF_SUDO > "$SUDOERS_FILE"
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart klipper-farm-node-agent.service
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl status klipper-farm-node-agent.service
EOF_SUDO
chmod 440 "$SUDOERS_FILE"

# 8. Enable and start service
echo "Starting service..."
systemctl daemon-reload
systemctl enable klipper-farm-node-agent
systemctl restart klipper-farm-node-agent

# 9. Verify and show status
echo "--- Installation Verification ---"
systemctl status klipper-farm-node-agent --no-pager

NODE_IP=$(hostname -I | awk '{print $1}')
echo "--- Installation Complete ---"
echo "Node Agent is running at: http://$NODE_IP:$AGENT_PORT"
echo "Health check URL: http://$NODE_IP:$AGENT_PORT/health"
echo "Backend URL: $BACKEND_URL"
