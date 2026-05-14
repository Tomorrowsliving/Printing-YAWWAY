# Printing-YAWWAY

A modular, expandable Klipper print farm control platform for managing multiple 3D printers across distributed Raspberry Pi nodes.

Designed for:

* Klipper print farms
* Centralised configuration management
* Disposable/stateless Pi nodes
* Multi-printer deployments
* Future network-boot infrastructure
* Centralised G-code and backup management

---

# Overview

Printing-YAWWAY separates **printer profiles** from the physical Raspberry Pi running them.

Instead of permanently tying one printer to one Pi, the dashboard treats each printer as a logical profile which can be:

* assigned to different nodes
* migrated between Pis
* centrally managed
* backed up automatically
* monitored from a single dashboard

The central server manages:

* printer profiles
* configurations
* G-code storage
* backups
* node health
* event logging
* printer assignments
* update orchestration

Raspberry Pis act as lightweight execution nodes running:

* Klipper
* Moonraker
* webcam services
* node-agent

All printer data is designed to live centrally over NFS.

---

# Features

## Current MVP Features

### Central Dashboard

* Fleet overview
* Node overview
* Printer overview
* Live node health monitoring
* CPU/RAM/temperature monitoring
* Node approval workflow
* Printer-to-node assignment tracking
* Centralised event logging
* Embedded Mainsail/Fluidd support
* WebSocket live updates
* Centralised G-code storage
* NFS-based shared storage
* Node-agent remote update support
* Automatic node discovery
* Service restart controls

### Raspberry Pi Node-Agent

* Health reporting
* USB device discovery
* Service management
* Heartbeat registration
* Remote update support
* Automatic installation
* Systemd integration
* Narrow sudoers integration
* Lightweight FastAPI API

### Infrastructure

* Docker Compose deployment
* PostgreSQL database
* Caddy reverse proxy
* NFS server container
* Modular backend/frontend architecture

---

# Planned Features

* Automatic printer migration
* Printer failover handling
* Auto reassignment prompts
* Stateless/network-boot Pi nodes
* Webcam streaming
* Discord/email notifications
* Multi-user authentication
* Role-based access control
* Backup scheduling
* Cluster-aware scheduling
* Printer usage analytics
* Print queue orchestration
* OTA node-agent updates
* Remote Klipper config editing
* Full file browser
* Multi-camera support
* Per-printer permissions
* AI-assisted diagnostics

---

# Architecture

## Central Server

The central server runs:

* Dashboard frontend
* FastAPI backend
* PostgreSQL database
* WebSocket server
* NFS server
* Reverse proxy
* Backup services
* Central storage

## Raspberry Pi Nodes

Each Pi runs:

* Klipper
* Moonraker
* webcam services
* node-agent
* local systemd services

Each printer instance has:

* separate Klipper service
* separate Moonraker service
* separate socket
* separate logs
* separate config directory
* separate Moonraker port

---

# Tech Stack

| Component         | Technology           |
| ----------------- | -------------------- |
| Backend           | FastAPI              |
| Frontend          | React + Tailwind CSS |
| Database          | PostgreSQL           |
| Realtime Updates  | WebSockets           |
| Reverse Proxy     | Caddy                |
| Node-Agent        | FastAPI              |
| Deployment        | Docker Compose       |
| Storage           | NFS                  |
| Container Runtime | Docker               |

---

# Repository Structure

```text
backend/        FastAPI backend API
frontend/       React dashboard frontend
node-agent/     Raspberry Pi node-agent
storage/        Centralised storage
docker-compose.yml
README.md
```

---

# Backend Setup

## Requirements

* Docker
* Docker Compose

## Start the Stack

Clone the repository:

```bash
git clone https://github.com/Tomorrowsliving/Printing-YAWWAY.git
cd Printing-YAWWAY
```

Copy the environment template:

```bash
cp .env.example .env
```

Start the stack:

```bash
docker compose up -d --build
```

Dashboard:

```text
http://SERVER_IP
```

API:

```text
http://SERVER_IP/api
```

---

# Raspberry Pi Node-Agent Installation

## Recommended Installation

The installer automatically:

* installs dependencies
* creates the virtual environment
* installs Python requirements
* creates systemd services
* configures sudoers rules
* enables automatic startup
* configures environment files

Run:

```bash
git clone https://github.com/Tomorrowsliving/Printing-YAWWAY.git
cd Printing-YAWWAY/node-agent

sudo ./install.sh \
  --backend-url http://YOUR_SERVER_IP \
  --port 8001
```

Example:

```bash
sudo ./install.sh \
  --backend-url http://10.1.8.133 \
  --port 8001
```

---

# Node-Agent Service

After installation:

```bash
systemctl status klipper-farm-node-agent
```

Health endpoint:

```text
http://PI_IP:8001/health
```

Restart service:

```bash
sudo systemctl restart klipper-farm-node-agent
```

View logs:

```bash
journalctl -u klipper-farm-node-agent -f
```

---

# NFS Shared Storage

The central server exports the storage directory using NFS.

## Server Export

Docker service:

* `itsthenetwork/nfs-server-alpine`

Exported path:

```text
/exports
```

Mapped from:

```text
./storage
```

---

# Raspberry Pi NFS Mount

Install NFS tools:

```bash
sudo apt update
sudo apt install -y nfs-common
```

Create mount point:

```bash
sudo mkdir -p /mnt/klipper-farm
```

Mount the share:

```bash
sudo mount SERVER_IP:/exports /mnt/klipper-farm
```

Persistent mount:

```bash
sudo nano /etc/fstab
```

Add:

```text
SERVER_IP:/exports /mnt/klipper-farm nfs defaults,soft,intr 0 0
```

---

# Storage Layout

```text
storage/
├── printers/
├── gcodes/
├── backups/
├── configs/
└── uploads/
```

## printers/

Per-printer instance data:

* configs
* logs
* Moonraker state
* macros

## gcodes/

Centralised G-code storage.

## backups/

Automatic backups and snapshots.

## configs/

Shared templates and reusable configs.

## uploads/

Temporary upload staging.

---

# API Endpoints

## Node-Agent

| Endpoint                | Description        |
| ----------------------- | ------------------ |
| GET /health             | Node health        |
| GET /usb                | USB device listing |
| GET /instances          | Running instances  |
| POST /instances/start   | Start instance     |
| POST /instances/stop    | Stop instance      |
| POST /instances/restart | Restart instance   |
| POST /update            | Update node-agent  |

---

# Dashboard Pages

## Fleet Overview

* Printer list
* Status monitoring
* Quick actions
* Embedded UI access

## Node Overview

* Node health
* CPU/RAM/temp monitoring
* USB device visibility
* Online/offline state

## Printer Detail

* Logs
* Service controls
* Config references
* Webcam placeholder
* Node assignment

## Assignment Page

* Printer migration
* Node selection
* MCU verification
* Assignment management

## Event Log

* Service restarts
* Node errors
* MCU disconnects
* Migration history

---

# Language & UI Standards

This project uses British English throughout:

* Initialise
* Organise
* Colour
* Optimise

---

# Security Notes

Current MVP defaults:

* local-network deployment
* no authentication enabled by default

Recommended production setup:

* VPN or Cloudflare Tunnel
* authentication enabled
* firewall restrictions
* TLS certificates
* segmented printer VLAN/network

---

# Development Goals

Primary priorities:

1. Stable MVP
2. Modular architecture
3. Expandable infrastructure
4. Centralised management
5. Reliable node orchestration

The project intentionally avoids overcomplicating the first release while maintaining long-term scalability.

---

# Uninstallation

Remove the node-agent:

```bash
sudo ./uninstall.sh
```

---

# License

Work in progress.
