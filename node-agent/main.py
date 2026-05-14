from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import psutil
import socket
import os
import time
import subprocess
import re
import uuid
import json
import requests
import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional

VERSION = "1.0.0"
AGENT_PORT = int(os.getenv("NODE_AGENT_PORT", 8001))

# Local storage for node UUID
NODE_ID_PATH = os.path.expanduser("~/.klipper-farm/node_id")

def get_node_uuid():
    if os.path.exists(NODE_ID_PATH):
        with open(NODE_ID_PATH, "r") as f:
            return f.read().strip()

    new_id = str(uuid.uuid4())
    os.makedirs(os.path.dirname(NODE_ID_PATH), exist_ok=True)
    with open(NODE_ID_PATH, "w") as f:
        f.write(new_id)
    return new_id

BACKEND_URL = os.getenv("BACKEND_URL")

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

def get_pi_model():
    try:
        if os.path.exists("/proc/device-tree/model"):
            with open("/proc/device-tree/model", "r") as f:
                return f.read().strip('\x00')
    except Exception:
        pass
    return "Unknown"

async def heartbeat_task():
    if not BACKEND_URL:
        print("BACKEND_URL not set. Heartbeat disabled.")
        return

    node_uuid = get_node_uuid()
    print(f"Starting heartbeat to {BACKEND_URL} from port {AGENT_PORT}")
    while True:
        try:
            cpu_usage = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory()

            temp = 0.0
            if os.path.exists("/sys/class/thermal/thermal_zone0/temp"):
                with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                    temp = float(f.read()) / 1000.0

            usb_devices = []
            usb_path = "/dev/serial/by-id"
            if os.path.exists(usb_path):
                for dev in os.listdir(usb_path):
                    usb_devices.append({"id": dev, "path": os.path.join(usb_path, dev)})

            payload = {
                "node_uuid": node_uuid,
                "hostname": socket.gethostname(),
                "ip_address": get_local_ip(),
                "agent_port": AGENT_PORT,
                "model": get_pi_model(),
                "cpu_usage": cpu_usage,
                "ram_usage": ram.percent,
                "temperature": temp,
                "uptime": f"{int(time.time() - psutil.boot_time())}s",
                "agent_version": VERSION,
                "usb_devices": usb_devices,
                "service_instances": []
            }

            requests.post(f"{BACKEND_URL}/api/nodes/heartbeat", json=payload, timeout=5)
        except Exception as e:
            print(f"Heartbeat failed: {e}")

        await asyncio.sleep(15)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(heartbeat_task())
    yield
    task.cancel()

app = FastAPI(title="Klipper Farm Node Agent", lifespan=lifespan)

class ServiceCommand(BaseModel):
    name: str

@app.get("/version")
async def get_version():
    return {
        "version": VERSION,
        "hostname": socket.gethostname(),
        "ip_address": get_local_ip()
    }

@app.get("/health")
async def get_health():
    try:
        cpu_usage = psutil.cpu_percent(interval=1)
        ram = psutil.virtual_memory()

        temp = 0.0
        if os.path.exists("/sys/class/thermal/thermal_zone0/temp"):
            with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                temp = float(f.read()) / 1000.0

        return {
            "hostname": socket.gethostname(),
            "ip_address": get_local_ip(),
            "cpu_usage": cpu_usage,
            "ram_usage": ram.percent,
            "temperature": temp,
            "uptime": f"{int(time.time() - psutil.boot_time())}s",
            "online": True,
            "pi_model": get_pi_model(),
            "version": VERSION
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/update")
async def update_agent():
    try:
        subprocess.run(["tar", "-czf", "../node-agent-backup.tar.gz", "."], check=True)
        subprocess.run(["git", "pull"], check=True)
        subprocess.run(["pip", "install", "-r", "requirements.txt"], check=True)
        os.system("sleep 2 && sudo systemctl restart klipper-farm-agent &")
        return {"status": "success", "message": "Update initiated."}
    except Exception as e:
        subprocess.run(["tar", "-xzf", "../node-agent-backup.tar.gz"], check=True)
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}.")

@app.get("/usb")
async def get_usb():
    devices = []
    path = "/dev/serial/by-id"
    if os.path.exists(path):
        for dev in os.listdir(path):
            devices.append({
                "id": dev,
                "path": os.path.join(path, dev),
                "target": os.path.realpath(os.path.join(path, dev))
            })
    return devices

@app.post("/instances/start")
async def start_instance(cmd: ServiceCommand):
    return run_systemctl("start", cmd.name)

@app.post("/instances/stop")
async def stop_instance(cmd: ServiceCommand):
    return run_systemctl("stop", cmd.name)

@app.post("/instances/restart")
async def restart_instance(cmd: ServiceCommand):
    return run_systemctl("restart", cmd.name)

def run_systemctl(action: str, service_name: str):
    if not re.match(r"^[a-zA-Z0-9\-\.]+$", service_name):
        raise HTTPException(status_code=400, detail="Invalid service name")

    if not service_name.startswith(("klipper", "moonraker", "node-agent")):
        raise HTTPException(status_code=400, detail="Unauthorised service name")

    try:
        subprocess.run(["sudo", "systemctl", action, service_name], check=True)
        return {"status": "success", "action": action, "service": service_name}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Failed to {action} {service_name}: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=AGENT_PORT)
