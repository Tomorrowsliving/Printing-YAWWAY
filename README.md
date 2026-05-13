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
3. Run the agent: `uvicorn main:app --host 0.0.0.0 --port 8000`.
4. (Optional) Set up as a systemd service using the provided example file.

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
