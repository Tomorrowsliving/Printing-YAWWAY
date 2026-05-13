from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import nodes, printers, files, assignments, events, backups, websocket

app = FastAPI(title="Klipper Farm Control Plane API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes.router)
app.include_router(printers.router)
app.include_router(files.router)
app.include_router(assignments.router)
app.include_router(events.router)
app.include_router(backups.router)
app.include_router(websocket.router)

@app.get("/")
async def root():
    return {"message": "Klipper Farm Control Plane API is running"}
