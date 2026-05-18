# Klipper Farm Control Plane

A modular, expandable print farm dashboard for managing multiple Klipper-based 3D printers.

## Project Structure

- `backend/`: Python FastAPI service for central management and API.
- `frontend/`: React + Tailwind CSS dashboard UI.
- `node-agent/`: Lightweight Python FastAPI service running on Raspberry Pi nodes.
- `storage/`: Centralised storage for configs, G-code, logs, and backups (designed for NFS).

## Goal

Create a central server to manage printer profiles, configs, G-code storage, node status, backups, events, and printer-to-node assignments. Raspberry Pis act as disposable Klipper execution nodes, mounting the central storage over NFS.

## Tech Stack

- Backend: Python FastAPI
- Frontend: React + Tailwind CSS
- Database: PostgreSQL
- Real-time Updates: WebSockets
- Deployment: Docker Compose (Dashboard/Backend/DB/Reverse Proxy)
- Node Agent: Python FastAPI (installed on Pis)
- Reverse Proxy: Caddy
- Storage: NFS share from central server

## Setup Instructions

### Backend & Dashboard (Docker Compose)

1. Copy `.env.example` to `.env` and configure your settings.
2. Ensure you have Docker and Docker Compose installed.
3. Run `docker-compose up -d`.
4. Access the dashboard at `http://localhost`.

### Node Agent (on Raspberry Pi)

1. Ensure Python 3.9+ is installed.
2. Install dependencies: `pip install -r requirements.txt`.
3. Set the backend URL environment variable:
   ```bash
   export BACKEND_URL=http://CENTRAL_SERVER_IP
   ```
4. Run the agent: `uvicorn main:app --host 0.0.0.0 --port 8001`.
5. (Optional) Set up as a systemd service using the provided example file. Ensure `Environment=BACKEND_URL=http://CENTRAL_SERVER_IP` is added to the service file.

## NFS Configuration

The central server runs an NFS server container (`nfs`) that exports the `./storage` directory.

### Server Side
The NFS container is configured in `docker-compose.yml`:
- Image: `itsthenetwork/nfs-server-alpine`
- Exported path: `/exports` (mapped from `./storage`)
- Port: `2049`

### Client Side (Raspberry Pi)
To mount the shared storage on your Pi nodes:

1. Install NFS client:
   ```bash
   sudo apt update && sudo apt install -y nfs-common
   ```
2. Create mount point:
   ```bash
   sudo mkdir -p /mnt/klipper-farm
   ```
3. Mount the share (replace `YOUR_SERVER_IP` with the dashboard server's IP):
   ```bash
   sudo mount YOUR_SERVER_IP:/exports /mnt/klipper-farm
   ```
4. To make it persistent, add to `/etc/fstab`:
   ```text
   YOUR_SERVER_IP:/exports /mnt/klipper-farm nfs defaults,soft,intr 0 0
   ```

## Storage Layout

The `storage/` directory is organised as follows:
- `printers/`: Klipper/Moonraker instance data per printer.
- `gcodes/`: Centralised G-code file storage.
- `backups/`: System and configuration backups.
- `configs/`: Global or shared configuration templates.
- `uploads/`: Temporary directory for file uploads.

## UI Labels & Language

This project uses British English (e.g., "Initialise", "Organise", "Colour") for all UI labels, comments, and documentation.

## Recommended Node Agent Installation

The easiest way to install the node-agent on a Raspberry Pi is using the provided one-command installer.

### Automatic Installation (Recommended)

```bash
git clone https://github.com/Tomorrowsliving/Printing-YAWWAY.git
cd Printing-YAWWAY/node-agent
sudo ./install.sh --backend-url http://YOUR_SERVER_IP:8001 --port 8001
```

This script will:
- Install system dependencies (Python, Git, etc.).
- Install the agent to `/opt/klipper-farm-control`.
- Set up a virtual environment and install requirements.
- Create a systemd service and start the agent automatically.
- Configure narrow sudoers rules for automatic updates.

When provisioning a printer from the dashboard, the backend generates `moonraker.conf` for the selected node. It uses `BACKEND_PUBLIC_URL` for the trusted backend host, the selected node's `ip_address`, the assigned Moonraker port, and the printer slug for the Klippy Unix socket.

Node software setup is exposed through:
- `GET /software/status`
- `POST /software/install/runtime`
- `POST /software/install/klipper`
- `POST /software/install/moonraker`
- `POST /software/install/mainsail`

The runtime installer runs Klipper, Moonraker, then Mainsail. Mainsail is served by nginx at `http://NODE_IP`, while each printer keeps its own Moonraker API port such as `http://NODE_IP:7125/server/info`.

### Manual Installation

If you prefer to install manually:

1. Install dependencies: `sudo apt update && sudo apt install -y git python3-venv python3-pip`.
2. Clone and enter the directory.
3. Create venv: `python3 -m venv venv && source venv/bin/activate`.
4. Install requirements: `pip install -r requirements.txt`.
5. Run manually: `export BACKEND_URL=http://your-server-ip:8001 && python3 main.py`.

When setting up as a systemd service, ensure `Environment=NODE_AGENT_DIR=/path/to/node-agent` is included in the unit file.

### Uninstallation

To remove the agent and its configuration:
```bash
sudo ./uninstall.sh
```
