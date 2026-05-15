import os
import psutil
import subprocess
import socket
import asyncio
import httpx
import logging
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from pydantic import BaseModel
import time
import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("node-agent")

app = FastAPI(title="Klipper Farm Node Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration from environment
AGENT_PORT = int(os.getenv("NODE_AGENT_PORT", os.getenv("AGENT_PORT", 8001)))
CENTRAL_SERVER_URL = os.getenv("BACKEND_URL", os.getenv("CENTRAL_SERVER_URL", "http://server:8001"))
NODE_AGENT_REPO_DIR = os.getenv("NODE_AGENT_REPO_DIR", "/home/pi/klipper-farm-control-plane")

class InstanceCreate(BaseModel):
    printer_slug: str
    mcu_serial: str
    moonraker_port: int
    config_path: str
    gcode_path: str
    logs_path: str

def clean_string(value):
    if value is None:
        return None
    return str(value).replace("\x00", "").strip()

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def get_pi_model():
    try:
        with open("/proc/device-tree/model", "r") as f:
            return f.read().strip()
    except:
        return "Unknown"

def get_cpu_temperature():
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return 0.0
        for key in ("cpu_thermal", "cpu-thermal", "soc_thermal"):
            entries = temps.get(key)
            if entries:
                return float(entries[0].current)
        for entries in temps.values():
            if entries:
                return float(entries[0].current)
    except Exception:
        pass
    return 0.0

@app.get("/health")
async def health():
    usb_serial = []
    base_path = "/dev/serial/by-id"
    if os.path.exists(base_path):
        usb_serial = os.listdir(base_path)

    return {
        "hostname": clean_string(socket.gethostname()),
        "ip_address": clean_string(get_ip()),
        "cpu_usage": psutil.cpu_percent(),
        "ram_usage": psutil.virtual_memory().percent,
        "temperature": get_cpu_temperature(),
        "uptime": clean_string(f"{int(time.time() - psutil.boot_time())}s"),
        "model": clean_string(get_pi_model()),
        "pi_model": clean_string(get_pi_model()),
        "version": "1.0.0",
        "online": True,
        "usb_serial_count": len(usb_serial),
        "usb_device_count": len(psutil.disk_partitions()) # Placeholder for device count
    }

@app.get("/usb")
async def list_usb():
    devices = []
    base_path = "/dev/serial/by-id"
    if os.path.exists(base_path):
        for d in os.listdir(base_path):
            devices.append({
                "id": d,
                "path": os.path.join(base_path, d)
            })
    return devices

@app.get("/instances")
async def list_instances():
    # In a real scenario, we'd list systemd services matching klipper-*.service
    try:
        result = subprocess.run(['systemctl', 'list-units', '--type=service', 'klipper-*', 'moonraker-*', '--all', '--no-legend'], capture_output=True, text=True)
        instances = []
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 4:
                instances.append({
                    "name": parts[0],
                    "status": parts[3],
                    "active": parts[2]
                })
        return instances
    except Exception as e:
        return {"error": str(e)}

@app.post("/instances/create")
async def create_instance(data: InstanceCreate):
    """
    Creates systemd services and minimal config for a new printer instance.
    In a real MVP, this would also write the service files to /etc/systemd/system/
    """
    logger.info(f"Creating instance for {data.printer_slug}")

    # Ensure directories exist (NFS usually)
    os.makedirs(data.config_path, exist_ok=True)
    os.makedirs(data.gcode_path, exist_ok=True)
    os.makedirs(data.logs_path, exist_ok=True)

    printer_cfg = os.path.join(data.config_path, "printer.cfg")
    if not os.path.exists(printer_cfg):
        with open(printer_cfg, "w") as f:
            f.write(f"[mcu]\nserial: {data.mcu_serial}\n\n[printer]\nkinematics: none\nmax_velocity: 300\nmax_accel: 3000\n")

    moonraker_conf = os.path.join(data.config_path, "moonraker.conf")
    if not os.path.exists(moonraker_conf):
        with open(moonraker_conf, "w") as f:
            f.write(f"[server]\nhost: 0.0.0.0\nport: {data.moonraker_port}\n\n[file_manager]\nconfig_path: {data.config_path}\nlog_path: {data.logs_path}\n\n[authorization]\ntrusted_clients:\n  127.0.0.1\n  192.168.0.0/16\n  10.0.0.0/8\n  172.16.0.0/12\n")

    # TODO: In production, generate and install systemd units here.
    # For now, we return success to simulate the flow.
    return {"status": "success", "message": f"Configs generated for {data.printer_slug}. Systemd units pending manual install or root implementation."}

def validate_service_name(service: str):
    if not (service.startswith("klipper-") or service.startswith("moonraker-")):
        raise HTTPException(status_code=403, detail="Unauthorised service name")

@app.post("/instances/start")
async def start_instance(service: str = Body(..., embed=True)):
    validate_service_name(service)
    subprocess.run(["sudo", "systemctl", "start", service])
    return {"status": "started"}

@app.post("/instances/stop")
async def stop_instance(service: str = Body(..., embed=True)):
    validate_service_name(service)
    subprocess.run(["sudo", "systemctl", "stop", service])
    return {"status": "stopped"}

@app.post("/instances/restart")
async def restart_instance(service: str = Body(..., embed=True)):
    validate_service_name(service)
    subprocess.run(["sudo", "systemctl", "restart", service])
    return {"status": "restarted"}

@app.get("/version")
async def get_version():
    commit = "unknown"
    branch = "unknown"
    if os.path.exists(NODE_AGENT_REPO_DIR):
        try:
            commit = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "HEAD"], text=True).strip()
            branch = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
        except: pass

    return {
        "version": "1.0.0",
        "commit": commit,
        "branch": branch,
        "repo_dir": NODE_AGENT_REPO_DIR,
        "agent_dir": os.path.join(NODE_AGENT_REPO_DIR, "node-agent")
    }

@app.post("/update")
async def update_agent():
    if not os.path.exists(NODE_AGENT_REPO_DIR):
        raise HTTPException(status_code=404, detail="Repo directory not found")

    result = {
        "success": False,
        "status": "failed",
        "message": "",
        "before_commit": "",
        "after_commit": "",
        "remote_commit": "",
        "git_fetch_output": "",
        "git_pull_output": "",
        "pip_output": "",
        "restart_required": False,
        "timestamp": datetime.datetime.now().isoformat()
    }

    try:
        # 1. Get current commit
        result["before_commit"] = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "HEAD"], text=True).strip()

        # 2. Fetch
        fetch_res = subprocess.run(["git", "-C", NODE_AGENT_REPO_DIR, "fetch", "origin"], capture_output=True, text=True)
        result["git_fetch_output"] = fetch_res.stdout + fetch_res.stderr

        # 3. Get remote commit
        branch = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
        result["remote_commit"] = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", f"origin/{branch}"], text=True).strip()

        if result["before_commit"] == result["remote_commit"]:
            result["success"] = True
            result["status"] = "already_up_to_date"
            result["message"] = "Node-agent is already up to date."
            result["after_commit"] = result["before_commit"]
        else:
            # 4. Pull
            pull_res = subprocess.run(["git", "-C", NODE_AGENT_REPO_DIR, "pull", "--ff-only"], capture_output=True, text=True)
            result["git_pull_output"] = pull_res.stdout + pull_res.stderr
            if pull_res.returncode != 0:
                result["message"] = f"Git pull failed: {pull_res.stderr}"
                return result

            result["after_commit"] = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "HEAD"], text=True).strip()
            result["status"] = "updated"
            result["message"] = "Source code updated successfully."
            result["restart_required"] = True
            result["success"] = True

        # 5. Always check dependencies if requirements changed or explicitly on update
        agent_dir = os.path.join(NODE_AGENT_REPO_DIR, "node-agent")
        venv_pip = os.path.join(agent_dir, "venv", "bin", "pip")
        requirements_txt = os.path.join(agent_dir, "requirements.txt")

        if os.path.exists(venv_pip) and os.path.exists(requirements_txt):
            pip_res = subprocess.run([venv_pip, "install", "-r", requirements_txt], capture_output=True, text=True)
            result["pip_output"] = pip_res.stdout + pip_res.stderr
            if pip_res.returncode != 0:
                result["success"] = False
                result["status"] = "failed"
                result["message"] = f"Pip install failed: {pip_res.stderr}"

        return result
    except Exception as e:
        logger.error(f"Update failed: {e}")
        result["message"] = str(e)
        return result

async def heartbeat_task():
    """Background task to notify central server we are online."""
    async with httpx.AsyncClient() as client:
        while True:
            try:
                # Use health info for heartbeat
                h = await health()
                payload = {
                    "node_uuid": clean_string(os.getenv("NODE_UUID", "unknown")),
                    "hostname": h["hostname"],
                    "ip_address": h["ip_address"],
                    "agent_port": AGENT_PORT,
                    "model": h["model"],
                    "pi_model": h["pi_model"],
                    "version": h["version"],
                    "cpu_usage": h["cpu_usage"],
                    "ram_usage": h["ram_usage"],
                    "temperature": h["temperature"],
                    "uptime": h["uptime"],
                    "usb_serial_count": h["usb_serial_count"],
                    "usb_device_count": h["usb_device_count"]
                }
                await client.post(f"{CENTRAL_SERVER_URL}/api/nodes/heartbeat", json=payload, timeout=5.0)
            except Exception as e:
                logger.error(f"Heartbeat failed: {e}")
            await asyncio.sleep(15)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(heartbeat_task())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=AGENT_PORT)
