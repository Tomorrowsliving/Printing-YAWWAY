from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Optional, List
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
    usb_devices: List[dict] = Field(default_factory=list)
    service_instances: List[dict] = Field(default_factory=list)
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
    active_gcode: Optional[str] = None
    progress: Optional[float] = None
    last_seen: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)

class PrinterDetail(Printer):
    node: Optional[Node] = None
    notes: Optional[dict] = None

class PrinterNoteBase(BaseModel):
    model: Optional[str] = None
    bed_size: Optional[str] = None
    nozzle_size: Optional[str] = None
    hotend: Optional[str] = None
    extruder: Optional[str] = None
    probe_type: Optional[str] = None
    board_type: Optional[str] = None
    mcu_serial: Optional[str] = None
    slicer_profile_notes: Optional[str] = None
    known_issues: Optional[str] = None
    maintenance_notes: Optional[str] = None
    last_serviced_date: Optional[datetime] = None

class PrinterNote(PrinterNoteBase):
    id: int
    printer_id: int

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
    backup_category: Optional[str] = None
    display_type: Optional[str] = None
    printer_slug: Optional[str] = None
    printer_name: Optional[str] = None

class Backup(BackupBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class SlicerSettings(BaseModel):
    orca_binary_path: Optional[str] = None

class SlicerProfileBase(BaseModel):
    name: str
    profile_type: str
    engine: str = "orca"
    printer_id: Optional[int] = None
    data: dict[str, Any] = Field(default_factory=dict)

class SlicerProfile(SlicerProfileBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class SlicerModel(BaseModel):
    id: int
    filename: str
    file_path: str
    size: Optional[int] = None
    source_format: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class SlicerJobCreate(BaseModel):
    model_id: int
    printer_id: int
    printer_profile_id: Optional[int] = None
    filament_profile_id: Optional[int] = None
    process_profile_id: Optional[int] = None
    centre_on_bed: bool = True

class SlicerBatchJobCreate(BaseModel):
    model_id: int
    printer_ids: List[int]
    printer_profile_id: Optional[int] = None
    filament_profile_id: Optional[int] = None
    process_profile_id: Optional[int] = None
    centre_on_bed: bool = True

class SlicerJob(BaseModel):
    id: int
    model_id: int
    printer_id: int
    printer_profile_id: Optional[int] = None
    filament_profile_id: Optional[int] = None
    process_profile_id: Optional[int] = None
    engine: str
    status: str
    message: Optional[str] = None
    output_path: Optional[str] = None
    estimated_time: Optional[str] = None
    filament_used_mm: Optional[float] = None
    command: Optional[list[str] | dict[str, Any]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
