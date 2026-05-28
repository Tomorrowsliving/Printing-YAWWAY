from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .routers import nodes, printers, files, assignments, events, backups, websocket, settings, notifications, storage
import logging
import asyncio
import datetime
from sqlalchemy import select, update
from .database import AsyncSessionLocal, engine, Base
from .models import Event, Node

app = FastAPI(title="Klipper Farm Control Plane API")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("klipper-farm")

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
    asyncio.create_task(nodes.monitor_approved_node_storage())

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

@app.get("/api")
@app.get("/")
async def root():
    return {"message": "Klipper Farm Control Plane API is running"}
