from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .routers import nodes, printers, files, assignments, events, backups, websocket, settings, notifications, storage, slicer, filaments
import logging
import asyncio
import datetime
import os
import httpx
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from .database import AsyncSessionLocal, engine, Base
from .models import Event, Node, Printer

app = FastAPI(title="Klipper Farm Control Plane API")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("klipper-farm")
HEALTH_EVENT_CACHE = {}
HEALTH_EVENT_COOLDOWN_SECONDS = 3600

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    logger.error(f"422 Validation Error: {exc.errors()}")
    logger.error(f"Request body: {body}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": body.decode(errors="replace")},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create a main API router with /api prefix
api_router = APIRouter(prefix="/api")

api_router.include_router(nodes.router)
api_router.include_router(printers.router)
api_router.include_router(files.router)
api_router.include_router(assignments.router)
api_router.include_router(events.router)
api_router.include_router(backups.router)
api_router.include_router(settings.router)
api_router.include_router(notifications.router)
api_router.include_router(storage.router)
api_router.include_router(slicer.router)
api_router.include_router(filaments.router)

# Include the API router in the app
app.include_router(api_router)

# WebSocket usually sits outside /api or uses its own prefix
app.include_router(websocket.router)

@app.on_event("startup")
async def startup_event():
    # Initialise Database Tables
    logger.info("Initialising database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables initialised.")

    # Data Migration: Fix "unknown" UUIDs
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(update(Node).where(Node.node_uuid == "unknown").values(node_uuid=None))
            await db.commit()
            logger.info("Cleaned up 'unknown' node UUIDs from database.")
    except Exception as e:
        logger.error("Migration error: %s", e)

    # Start background tasks
    asyncio.create_task(monitor_nodes())
    asyncio.create_task(monitor_farm_health())
    asyncio.create_task(nodes.monitor_approved_node_storage())
    asyncio.create_task(backups.scheduled_backup_loop())

async def monitor_nodes():
    """Background task to detect offline nodes"""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                # Mark nodes offline if last_seen > 60 seconds
                threshold = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=60)

                # Find nodes going offline
                result = await db.execute(
                    select(Node).where(Node.online.is_(True)).where(Node.last_seen < threshold)
                )
                nodes_to_offline = result.scalars().all()

                for node in nodes_to_offline:
                    active_operation = nodes.get_node_operation(node.id)
                    if active_operation:
                        node.status = active_operation.get("operation", node.status)
                        continue

                    node.online = False
                    event = Event(
                        node_id=node.id,
                        severity="warning",
                        event_type="node_offline",
                        message=f"Node {node.hostname} is offline (no heartbeat for 60s)"
                    )
                    db.add(event)
                    logger.info("Node %s marked offline", node.hostname)

                await db.commit()
        except Exception as e:
            logger.error("Error in monitor_nodes: %s", e)

        await asyncio.sleep(30)

def _health_cache_expired(key):
    last_seen = HEALTH_EVENT_CACHE.get(key)
    if not last_seen:
        return True
    return (datetime.datetime.now(datetime.timezone.utc) - last_seen).total_seconds() >= HEALTH_EVENT_COOLDOWN_SECONDS

async def record_health_warning(db, key, *, severity, event_type, message, node_id=None, printer_id=None, details=None):
    if not _health_cache_expired(key):
        return
    HEALTH_EVENT_CACHE[key] = datetime.datetime.now(datetime.timezone.utc)
    db.add(Event(
        node_id=node_id,
        printer_id=printer_id,
        severity=severity,
        event_type=event_type,
        message=message,
        details=details or {},
    ))

def clear_health_warning(key):
    HEALTH_EVENT_CACHE.pop(key, None)

async def monitor_farm_health():
    """Background health checks for operator warnings without adding new schema."""
    await asyncio.sleep(20)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                storage_key = "storage:writable"
                writable = os.path.isdir(storage.STORAGE_ROOT) and os.access(storage.STORAGE_ROOT, os.W_OK)
                if writable:
                    test_path = os.path.join(storage.STORAGE_ROOT, ".health-write-test")
                    try:
                        with open(test_path, "w", encoding="utf-8") as f:
                            f.write("ok\n")
                        os.remove(test_path)
                        clear_health_warning(storage_key)
                    except Exception as exc:
                        writable = False
                        await record_health_warning(
                            db,
                            storage_key,
                            severity="warning",
                            event_type="health_storage_writable",
                            message=f"Central storage is not writable: {exc}",
                            details={
                                "what_failed": "storage writable check",
                                "likely_cause": "NFS mount missing, permissions issue, or full disk",
                                "suggested_fix": "Open Settings, run Test NFS Connection, then check export permissions and free space.",
                                "fix": "Run Test NFS Connection and verify the central storage mount is writable.",
                            },
                        )
                if not writable:
                    await record_health_warning(
                        db,
                        storage_key,
                        severity="warning",
                        event_type="health_storage_writable",
                        message="Central storage is not writable",
                        details={
                            "what_failed": "storage writable check",
                            "likely_cause": "NFS mount missing, permissions issue, or full disk",
                            "suggested_fix": "Open Settings, run Test NFS Connection, then check export permissions and free space.",
                            "fix": "Run Test NFS Connection and verify the central storage mount is writable.",
                        },
                    )

                now = datetime.datetime.now(datetime.timezone.utc)
                node_result = await db.execute(select(Node).where(Node.approved.is_(True)))
                approved_nodes = node_result.scalars().all()
                approved_online_nodes = []
                for node in approved_nodes:
                    node_key = f"node:{node.id}:online"
                    last_seen = node.last_seen
                    if last_seen and last_seen.tzinfo is None:
                        last_seen = last_seen.replace(tzinfo=datetime.timezone.utc)
                    heartbeat_age = (now - last_seen).total_seconds() if last_seen else None
                    heartbeat_stale = heartbeat_age is None or heartbeat_age > 180
                    if node.online and not heartbeat_stale:
                        clear_health_warning(node_key)
                        approved_online_nodes.append(node)
                        continue
                    await record_health_warning(
                        db,
                        node_key,
                        severity="warning",
                        event_type="health_node_offline",
                        node_id=node.id,
                        message=f"Node agent offline or heartbeat stale for {node.hostname}",
                        details={
                            "what_failed": "node heartbeat check",
                            "likely_cause": "Node agent offline, node powered off, network unavailable, or wrong node IP/port",
                            "suggested_fix": "Check node power/network, then restart klipper-farm-node-agent on the node.",
                            "fix": "Restart the node agent and verify the node IP/port.",
                            "last_seen": node.last_seen.isoformat() if node.last_seen else None,
                            "heartbeat_age_seconds": heartbeat_age,
                        },
                    )
                async with httpx.AsyncClient() as client:
                    for node in approved_online_nodes:
                        nfs_key = f"node:{node.id}:nfs"
                        try:
                            res = await client.get(f"http://{node.ip_address}:{node.agent_port}/storage/check", timeout=5)
                            data = res.json() if res.status_code == 200 else {}
                            if res.status_code == 200 and data.get("nfs_available"):
                                clear_health_warning(nfs_key)
                                continue
                            await record_health_warning(
                                db,
                                nfs_key,
                                severity="warning",
                                event_type="health_nfs_mount",
                                node_id=node.id,
                                message=f"NFS mount missing or not writable on node {node.hostname}",
                                details={
                                    "what_failed": "node NFS mount check",
                                    "likely_cause": data.get("error") or f"Node returned HTTP {res.status_code}",
                                    "suggested_fix": "Use Test NFS Connection on the node card, then check /mnt/klipper-farm.",
                                    "fix": "Use Test NFS Connection on the node card.",
                                    "response": data,
                                },
                            )
                        except Exception as exc:
                            await record_health_warning(
                                db,
                                nfs_key,
                                severity="warning",
                                event_type="health_nfs_mount",
                                node_id=node.id,
                                message=f"Could not verify NFS mount on node {node.hostname}: {exc}",
                                details={
                                    "what_failed": "node NFS mount check",
                                    "likely_cause": "Node agent offline or storage endpoint unavailable",
                                    "suggested_fix": "Check node-agent status, then retry NFS mount from the node card.",
                                    "fix": "Check node-agent status and retry NFS mount.",
                                },
                            )

                    printer_result = await db.execute(
                        select(Printer)
                        .options(selectinload(Printer.node))
                        .where(Printer.assigned_node_id.is_not(None))
                    )
                    for printer in printer_result.scalars().all():
                        if not printer.node or not printer.moonraker_port:
                            continue
                        moonraker_key = f"printer:{printer.id}:moonraker"
                        url = f"http://{printer.node.ip_address}:{printer.moonraker_port}/server/info"
                        try:
                            res = await client.get(url, timeout=5)
                            if res.status_code == 200:
                                clear_health_warning(moonraker_key)
                                continue
                            await record_health_warning(
                                db,
                                moonraker_key,
                                severity="warning",
                                event_type="health_moonraker",
                                printer_id=printer.id,
                                node_id=printer.node.id,
                                message=f"Moonraker not reachable for printer {printer.name}: HTTP {res.status_code}",
                                details={
                                    "what_failed": "Moonraker reachability check",
                                    "likely_cause": "Moonraker service stopped, wrong port, or node network issue",
                                    "suggested_fix": "Open the printer detail page, check service logs, and verify the Moonraker port.",
                                    "fix": "Check Moonraker service logs and saved port.",
                                    "url": url,
                                },
                            )
                        except Exception as exc:
                            await record_health_warning(
                                db,
                                moonraker_key,
                                severity="warning",
                                event_type="health_moonraker",
                                printer_id=printer.id,
                                node_id=printer.node.id,
                                message=f"Moonraker not reachable for printer {printer.name}: {exc}",
                                details={
                                    "what_failed": "Moonraker reachability check",
                                    "likely_cause": "Moonraker service stopped, wrong port, or node network issue",
                                    "suggested_fix": "Open the printer detail page, check service logs, and verify the Moonraker port.",
                                    "fix": "Check Moonraker service logs and saved port.",
                                    "url": url,
                                },
                            )

                await db.commit()
        except Exception as e:
            logger.error("Error in monitor_farm_health: %s", e)

        await asyncio.sleep(60)

@app.get("/api")
@app.get("/")
async def root():
    return {"message": "Klipper Farm Control Plane API is running"}
