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

## NFS Assumptions

- Central server exports `/srv/klipper-farm` (or similar) as an NFS share.
- Raspberry Pi nodes mount this share at a consistent path.
- Paths are structured as:
  - `/srv/klipper-farm/printers/{printer_slug}/config`
  - `/srv/klipper-farm/printers/{printer_slug}/gcode`
  - `/srv/klipper-farm/printers/{printer_slug}/logs`
  - `/srv/klipper-farm/backups`

## UI Labels & Language

This project uses British English (e.g., "Initialise", "Organise", "Colour") for all UI labels, comments, and documentation.
