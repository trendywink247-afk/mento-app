"""CORS preflight: the mobile app's X-App-Version header must survive the browser's
preflight OPTIONS check (app/main.py CORSMiddleware), or the gate in app_version.py
never gets to run for web clients.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_preflight_allows_x_app_version_header():
    client = TestClient(app)
    r = client.options(
        "/api/v1/me",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-app-version",
        },
    )
    assert r.status_code == 200
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "x-app-version" in allowed
