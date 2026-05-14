#!/bin/bash

# Klipper Farm Node Agent Uninstaller

set -e

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

INSTALL_DIR="/opt/klipper-farm-node-agent"
ENV_FILE="/etc/klipper-farm-node-agent.env"
SERVICE_FILE="/etc/systemd/system/klipper-farm-node-agent.service"
SUDOERS_FILE="/etc/sudoers.d/klipper-farm-node-agent"

echo "--- Initialising Klipper Farm Node Agent Uninstallation ---"

# 1. Stop and disable service
if [ -f "$SERVICE_FILE" ]; then
    echo "Stopping and disabling service..."
    systemctl stop klipper-farm-node-agent || true
    systemctl disable klipper-farm-node-agent || true
    rm "$SERVICE_FILE"
    systemctl daemon-reload
fi

# 2. Remove sudoers file
if [ -f "$SUDOERS_FILE" ]; then
    echo "Removing sudoers configuration..."
    rm "$SUDOERS_FILE"
fi

# 3. Remove environment file
if [ -f "$ENV_FILE" ]; then
    echo "Removing environment file..."
    rm "$ENV_FILE"
fi

# 4. Remove installation directory
if [ -d "$INSTALL_DIR" ]; then
    read -p "Do you want to remove the installation directory $INSTALL_DIR? (y/N): " confirm
    if [[ \$confirm == [yY] || \$confirm == [yY][eE][sS] ]]; then
        echo "Removing $INSTALL_DIR..."
        rm -rf "$INSTALL_DIR"
    else
        echo "Skipping removal of $INSTALL_DIR."
    fi
fi

echo "--- Uninstallation Complete ---"
