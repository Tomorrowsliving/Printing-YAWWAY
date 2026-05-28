from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from datetime import datetime

class NodeBase(BaseModel):
    hostname: str
    name: Optional[str] = None
    ip_address: str
    agent_port: int = 8001
    model: Optional[str] = None
    notes: Optional[str] = None
    approved: bool = False

class NodeCreate(NodeBase):
    node_uuid: Optional[str] = None

class NodeHeartbeat(BaseModel):
    hostname: str
    ip_address: str
    agent_port: int
    node_uuid: Optional[str] = None
    model: Optional[str] = None
    pi_model: Optional[str] = None
    version: Optional[str] = None
    cpu_usage: Optional[float] = None
    ram_usage: Optional[float] = None
    temperature: Optional[float] = None
    uptime: Optional[str] = None
    usb_serial_count: Optional[int] = 0
    usb_device_count: Optional[int] = 0
    usb_devices: List[dict] = Field(default_factory=list)
    service_instances: List[dict] = Field(default_factory=list)

class Node(NodeBase):
    id: int
    node_uuid: Optional[str]
    cpu_usage: float
    ram_usage: float
    temperature: float
    uptime: Optional[str]
    online: bool
    status: str
    agent_version: Optional[str]
    update_available: bool
    last_update_status: Optional[str] = None
    last_update_message: Optional[str] = None
    last_update_at: Optional[datetime] = None
    active_operation: Optional[str] = None
    active_operation_message: Optional[str] = None
    active_operation_started_at: Optional[datetime] = None
    active_operation_expires_at: Optional[datetime] = None
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
    status_message: Optional[str] = None
    moonraker_warnings: List[str] = Field(default_factory=list)
    last_seen: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)

class PrinterDetail(Printer):
    node: Optional[Node] = None

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
    backup_category: Optional[str] = None
    display_type: Optional[str] = None
    printer_slug: Optional[str] = None
    printer_name: Optional[str] = None

class Backup(BackupBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
