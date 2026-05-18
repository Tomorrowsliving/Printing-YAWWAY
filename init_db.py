import asyncio
from backend.database import engine, Base
from backend.models import Node, Backup, Event, Printer

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

asyncio.run(init_db())
