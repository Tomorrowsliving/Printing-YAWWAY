from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .routers import nodes, printers, files, assignments, events, backups, websocket, settings, notifications
import logging
import asyncio
import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from .database import AsyncSessionLocal, engine, Base
from .models import Node, Event, Printer, PrinterNote, Backup, NotificationSetting, FileRecord, Assignment

app = FastAPI(title="Klipper Farm Control Plane API")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("klipper-farm")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"422 Validation Error: {exc.errors()}")
    logger.error(f"Request body: {await request.body()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(await request.body())},
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

# Include the API router in the app
app.include_router(api_router)

# WebSocket usually sits outside /api or uses its own prefix
app.include_router(websocket.router)

@app.on_event("startup")
async def startup_event():
    # Initialise Database Tables
    print("Initialising database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables initialised.")

    # Data Migration: Fix "unknown" UUIDs
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(update(Node).where(Node.node_uuid == "unknown").values(node_uuid=None))
            await db.commit()
            print("Cleaned up 'unknown' node UUIDs from database.")
    except Exception as e:
        print(f"Migration error: {e}")

    # Start background tasks
    asyncio.create_task(monitor_nodes())

async def monitor_nodes():
    """Background task to detect offline nodes"""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                # Mark nodes offline if last_seen > 60 seconds
                threshold = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=60)

                # Find nodes going offline
                result = await db.execute(
                    select(Node).where(Node.online == True).where(Node.last_seen < threshold)
                )
                nodes_to_offline = result.scalars().all()

                for node in nodes_to_offline:
                    node.online = False
                    event = Event(
                        node_id=node.id,
                        severity="warning",
                        event_type="node_offline",
                        message=f"Node {node.hostname} is offline (no heartbeat for 60s)"
                    )
                    db.add(event)
                    print(f"Node {node.hostname} marked offline")

                await db.commit()
        except Exception as e:
            print(f"Error in monitor_nodes: {e}")

        await asyncio.sleep(30)

@app.get("/api")
@app.get("/")
async def root():
    return {"message": "Klipper Farm Control Plane API is running"}
