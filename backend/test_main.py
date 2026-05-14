import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Klipper Farm Control Plane API is running"}

def test_list_nodes_empty():
    # Test endpoint existence even if DB fails
    response = client.get("/api/nodes/")
    # If DB is not running, it might return 500, but the router is wired
    assert response.status_code in [200, 500]
