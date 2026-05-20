from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from ..utils.network_settings import describe_network_state, save_network_settings

router = APIRouter(prefix="/settings", tags=["settings"])

class EmailSettings(BaseModel):
    host: str
    port: int
    user: str
    password: str
    from_email: str

class NetworkSettingsRequest(BaseModel):
    dashboard_host: str = ""

@router.post("/email")
async def save_email_settings(settings: EmailSettings):
    # In a real app, this would save to a config file or DB
    # For MVP, we record the attempt
    return {"status": "success", "message": "Settings saved (Note: MVP only uses environment variables for actual mailing)"}

@router.get("/network")
async def get_network_settings(request: Request):
    return describe_network_state(request)

@router.post("/network")
async def update_network_settings(settings: NetworkSettingsRequest, request: Request):
    try:
        save_network_settings(settings.dashboard_host)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return describe_network_state(request)
