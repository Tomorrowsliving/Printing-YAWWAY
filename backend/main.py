from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from .routers import nodes, printers, files, assignments, events, backups, websocket, settings, notifications
import asyncio
import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from .database import AsyncSessionLocal
from .models import Node, Event

app = FastAPI(title="Klipper Farm Control Plane API")

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
# But for consistency with Caddy, let's keep it under /ws
app.include_router(websocket.router)

@app.on_event("startup")
async def startup_event():
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
