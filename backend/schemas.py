from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime

class NodeBase(BaseModel):
    hostname: str
    ip_address: str
    agent_port: int = 8000
    model: Optional[str] = None
    notes: Optional[str] = None

class NodeCreate(NodeBase):
    pass

class Node(NodeBase):
    id: int
    cpu_usage: float
    ram_usage: float
    temperature: float
    uptime: Optional[str]
    online: bool
    last_seen: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)

class PrinterBase(BaseModel):
    name: str
    slug: str
    mcu_serial: Optional[str] = None
    expected_mcu_serial: Optional[str] = None
    klipper_service_name: Optional[str] = None
    moonraker_service_name: Optional[str] = None
    moonraker_port: Optional[int] = None
    config_path: Optional[str] = None
    gcode_path: Optional[str] = None
    webcam_url: Optional[str] = None
    embedded_ui_url: Optional[str] = None

class PrinterCreate(PrinterBase):
    assigned_node_id: Optional[int] = None

class Printer(PrinterBase):
    id: int
    assigned_node_id: Optional[int]
    status: str
    last_seen: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)

class EventBase(BaseModel):
    printer_id: Optional[int] = None
    node_id: Optional[int] = None
    severity: str
    event_type: str
    message: str
    details: Optional[dict] = None

class Event(EventBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class BackupBase(BaseModel):
    filename: str
    file_path: str
    backup_type: str
    status: str
    error_message: Optional[str] = None

class Backup(BackupBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
