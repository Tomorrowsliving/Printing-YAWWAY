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
REPO_URL="https://github.com/Tomorrowsliving/Printing-YAWWAY-.git"
REPO_DIR="/opt/klipper-farm-control"
ENV_FILE="/etc/klipper-farm-node-agent.env"
SERVICE_FILE="/etc/systemd/system/klipper-farm-node-agent.service"
SUDOERS_FILE="/etc/sudoers.d/klipper-farm-node-agent"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --backend-url) BACKEND_URL="$2"; shift ;;
        --port) AGENT_PORT="$2"; shift ;;
        --repo-url) REPO_URL="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$BACKEND_URL" ]; then
    echo "Error: --backend-url is required"
    exit 1
fi

echo "--- Initialising Klipper Farm Node Agent Installation ---"

# 1. Install system dependencies
echo "Installing system dependencies..."
apt-get update
apt-get install -y python3 python3-venv python3-pip git curl tar

# 2. Clone the repository for auto-update support
echo "Cloning repository to $REPO_DIR..."
if [ -d "$REPO_DIR" ]; then
    echo "Directory exists, pulling latest..."
    git -C "$REPO_DIR" pull || true
else
    git clone "$REPO_URL" "$REPO_DIR"
fi

INSTALL_DIR="$REPO_DIR/node-agent"

# 3. Create virtual environment in node-agent folder
echo "Creating Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# 4. Verify dependencies
echo "Verifying dependencies..."
"$INSTALL_DIR/venv/bin/python" -c "import fastapi, uvicorn, psutil, requests, httpx; print('All dependencies verified successfully.')"
if [ $? -ne 0 ]; then
    echo "Error: Dependency verification failed."
    exit 1
fi

# 5. Create environment file
echo "Creating environment file $ENV_FILE..."
cat <<EOF_ENV > "$ENV_FILE"
BACKEND_URL=$BACKEND_URL
NODE_AGENT_PORT=$AGENT_PORT
NODE_AGENT_DIR=$INSTALL_DIR
NODE_AGENT_REPO_DIR=$REPO_DIR
EOF_ENV
chmod 600 "$ENV_FILE"

# 6. Create systemd service
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

# 7. Create sudoers file for auto-updates and remote actions
echo "Configuring sudoers..."
cat <<EOF_SUDO > "$SUDOERS_FILE"
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart klipper-farm-node-agent.service
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart klipper-farm-node-agent
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl status klipper-farm-node-agent.service
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart klipper*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart moonraker*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop klipper*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop moonraker*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl start klipper*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl start moonraker*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable klipper*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable moonraker*
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
ALL ALL=(ALL) NOPASSWD: /usr/sbin/reboot
ALL ALL=(ALL) NOPASSWD: /usr/bin/apt-get update
ALL ALL=(ALL) NOPASSWD: /usr/bin/apt-get install *
ALL ALL=(ALL) NOPASSWD: /usr/bin/mv /tmp/klipper-*.service /etc/systemd/system/
ALL ALL=(ALL) NOPASSWD: /usr/bin/mv /tmp/moonraker-*.service /etc/systemd/system/
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
echo "Repo Location: $REPO_DIR"
