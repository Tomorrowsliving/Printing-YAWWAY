#!/bin/bash
# Klipper Farm Storage Initialisation Script

# This script creates the required directory structure for the NFS share.
# It should be run on the dashboard server.

STORAGE_DIR=${1:-./storage}

echo "Initialising storage in $STORAGE_DIR..."

mkdir -p "$STORAGE_DIR"/{printers,gcodes,configs,backups,uploads,logs}

# Ensure permissions allow NFS access (typically root for the container)
# chmod -R 777 "$STORAGE_DIR" # Use with caution, but often needed for easy Pi access

echo "Storage structure created:"
ls -F "$STORAGE_DIR"
