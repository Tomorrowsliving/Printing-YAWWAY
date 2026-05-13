from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from typing import Optional
from ..utils.notifications import send_email

router = APIRouter(prefix="/notifications", tags=["notifications"])

class EmailTestRequest(BaseModel):
    email: str
    config: Optional[dict] = None

@router.post("/test")
async def test_email(req: EmailTestRequest):
    # If config is provided, we'd temporarily use it, but utils.send_email uses env
    # For MVP, we just use the configured SMTP from env
    success = send_email(
        subject="SMTP Test Connection",
        content="This is a test email from your Klipper Farm Control Plane. If you received this, your SMTP settings are working correctly.",
        to_email=req.email
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to send test email. Check server logs for SMTP errors.")

    return {"status": "success", "message": f"Test email sent to {req.email}"}

@router.post("/email/test") # Alias for compatibility
async def test_email_alias(req: EmailTestRequest):
    return await test_email(req)
