from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class Node(Base):
    __tablename__ = "nodes"

    id = Column(Integer, primary_key=True, index=True)
    node_uuid = Column(String, unique=True, index=True)
    hostname = Column(String, index=True)
    name = Column(String) # User-defined display name
    ip_address = Column(String)
    agent_port = Column(Integer, default=8001)
    cpu_usage = Column(Float, default=0.0)
    ram_usage = Column(Float, default=0.0)
    temperature = Column(Float, default=0.0)
    uptime = Column(String)
    online = Column(Boolean, default=False)
    approved = Column(Boolean, default=False)
    last_seen = Column(DateTime(timezone=True))
    model = Column(String)
    notes = Column(Text)

    # Versioning & Updates
    agent_version = Column(String, default="1.0.0")
    update_available = Column(Boolean, default=False)
    last_update_check = Column(DateTime(timezone=True))
    last_update_status = Column(String)
    last_update_message = Column(Text)
    last_update_at = Column(DateTime(timezone=True))
    status = Column(String, default="discovered") # discovered, approved, online, offline, updating, error

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    printers = relationship("Printer", back_populates="node")
    usb_devices = relationship("UsbDevice", back_populates="node", cascade="all, delete-orphan")
    service_instances = relationship("ServiceInstance", back_populates="node", cascade="all, delete-orphan")

class Printer(Base):
    __tablename__ = "printers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    slug = Column(String, unique=True, index=True)
    assigned_node_id = Column(Integer, ForeignKey("nodes.id"))
    mcu_serial = Column(String)
    expected_mcu_serial = Column(String)
    klipper_service_name = Column(String)
    moonraker_service_name = Column(String)
    moonraker_port = Column(Integer)
    config_path = Column(String)
    gcode_path = Column(String)
    webcam_url = Column(String)
    embedded_ui_url = Column(String)
    status = Column(String, default="offline")
    last_seen = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    node = relationship("Node", back_populates="printers", lazy="selectin")
    notes = relationship("PrinterNote", back_populates="printer", uselist=False)
    slicer_profiles = relationship("SlicerProfile", back_populates="printer")
    slicer_jobs = relationship("SlicerJob", back_populates="printer")

class UsbDevice(Base):
    __tablename__ = "usb_devices"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), index=True)
    device_id = Column(String)
    path = Column(String)
    last_seen = Column(DateTime(timezone=True), server_default=func.now())

    node = relationship("Node", back_populates="usb_devices")

class ServiceInstance(Base):
    __tablename__ = "service_instances"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), index=True)
    name = Column(String, index=True)
    status = Column(String)
    active = Column(String)
    service_type = Column(String)
    last_seen = Column(DateTime(timezone=True), server_default=func.now())

    node = relationship("Node", back_populates="service_instances")

class PrinterNote(Base):
    __tablename__ = "printer_notes"

    id = Column(Integer, primary_key=True, index=True)
    printer_id = Column(Integer, ForeignKey("printers.id"), unique=True)
    model = Column(String)
    bed_size = Column(String)
    nozzle_size = Column(String)
    hotend = Column(String)
    extruder = Column(String)
    probe_type = Column(String)
    board_type = Column(String)
    mcu_serial = Column(String)
    slicer_profile_notes = Column(Text)
    known_issues = Column(Text)
    maintenance_notes = Column(Text)
    last_serviced_date = Column(DateTime(timezone=True))

    printer = relationship("Printer", back_populates="notes")

class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    printer_id = Column(Integer, ForeignKey("printers.id"))
    node_id = Column(Integer, ForeignKey("nodes.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    printer_id = Column(Integer, ForeignKey("printers.id"), nullable=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=True)
    severity = Column(String)
    event_type = Column(String)
    message = Column(Text)
    details = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Backup(Base):
    __tablename__ = "backups"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    file_path = Column(String)
    backup_type = Column(String)
    status = Column(String)
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class NotificationSetting(Base):
    __tablename__ = "notification_settings"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, unique=True)
    email_enabled = Column(Boolean, default=False)
    webhook_enabled = Column(Boolean, default=False)
    webhook_url = Column(String)

class FileRecord(Base):
    __tablename__ = "file_records"

    id = Column(Integer, primary_key=True, index=True)
    printer_id = Column(Integer, ForeignKey("printers.id"))
    filename = Column(String)
    file_type = Column(String)
    file_path = Column(String)
    size = Column(Integer)
    last_modified = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SlicerProfile(Base):
    __tablename__ = "slicer_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    profile_type = Column(String, index=True)  # printer, filament, process
    engine = Column(String, default="orca")
    printer_id = Column(Integer, ForeignKey("printers.id"), nullable=True)
    data = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    printer = relationship("Printer", back_populates="slicer_profiles")

class SlicerModel(Base):
    __tablename__ = "slicer_models"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    file_path = Column(String)
    size = Column(Integer)
    source_format = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SlicerJob(Base):
    __tablename__ = "slicer_jobs"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("slicer_models.id"))
    printer_id = Column(Integer, ForeignKey("printers.id"))
    printer_profile_id = Column(Integer, ForeignKey("slicer_profiles.id"), nullable=True)
    filament_profile_id = Column(Integer, ForeignKey("slicer_profiles.id"), nullable=True)
    process_profile_id = Column(Integer, ForeignKey("slicer_profiles.id"), nullable=True)
    engine = Column(String, default="orca")
    status = Column(String, default="queued")  # queued, running, completed, failed, cancelled
    message = Column(Text)
    output_path = Column(String)
    estimated_time = Column(String)
    filament_used_mm = Column(Float)
    command = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    model = relationship("SlicerModel")
    printer = relationship("Printer", back_populates="slicer_jobs")
