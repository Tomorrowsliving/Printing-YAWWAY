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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    printers = relationship("Printer", back_populates="node")

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

    node = relationship("Node", back_populates="printers")
    notes = relationship("PrinterNote", back_populates="printer", uselist=False)

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
