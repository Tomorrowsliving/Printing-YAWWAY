from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import psutil
import socket
import os
import time
import subprocess
import re

app = FastAPI(title="Klipper Farm Node Agent")

class ServiceCommand(BaseModel):
    name: str

@app.get("/health")
async def get_health():
    try:
        cpu_usage = psutil.cpu_percent(interval=1)
        ram = psutil.virtual_memory()

        temp = 0.0
        try:
            if os.path.exists("/sys/class/thermal/thermal_zone0/temp"):
                with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                    temp = float(f.read()) / 1000.0
            else:
                temps = psutil.sensors_temperatures()
                if 'cpu_thermal' in temps:
                    temp = temps['cpu_thermal'][0].current
                elif 'coretemp' in temps:
                    temp = temps['coretemp'][0].current
        except Exception:
            pass

        return {
            "hostname": socket.gethostname(),
            "ip_address": socket.gethostbyname(socket.gethostname()),
            "cpu_usage": cpu_usage,
            "ram_usage": ram.percent,
            "temperature": temp,
            "uptime": f"{int(time.time() - psutil.boot_time())}s",
            "online": True,
            "pi_model": get_pi_model()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

@app.get("/instances")
async def get_instances():
    # Placeholder: In real usage, we'd list klipper-* and moonraker-* services
    # For now, return empty list or mock data
    return []

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
    # Security: validate service name
    if not re.match(r"^[a-zA-Z0-9\-\.]+$", service_name):
        raise HTTPException(status_code=400, detail="Invalid service name")

    if not service_name.startswith(("klipper", "moonraker", "node-agent")):
        raise HTTPException(status_code=400, detail="Unauthorised service name")

    try:
        subprocess.run(["sudo", "systemctl", action, service_name], check=True)
        return {"status": "success", "action": action, "service": service_name}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Failed to {action} {service_name}: {e}")

def get_pi_model():
    try:
        if os.path.exists("/proc/device-tree/model"):
            with open("/proc/device-tree/model", "r") as f:
                return f.read().strip('\x00')
    except Exception:
        pass
    return "Unknown"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
