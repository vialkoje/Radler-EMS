#!/usr/bin/env python3
"""Richtet Grafana für Radler-EMS ein (wiederholbar): Datenquelle, Ordner, Dashboards.

Aufruf auf dem Pi:  python3 ~/radler-ems/tools/grafana_einspielen.py
- Datenquelle „Radler-EMS“ (uid radler-influx, Flux, Organisation home) mit INFLUX_TOKEN_GRAFANA aus secrets.env
  (nur lesend).
- Ordner „Radler-EMS“ und alle Dashboards aus grafana/dashboards/*.json (überschreibt gleiche uid).
- Anmeldung: GRAFANA_USER/GRAFANA_PASSWORD (Umgebung) oder GRAFANA_PW aus ~/.smarthome-secrets.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools"))
from flows_einspielen import env_datei  # noqa: E402


def main():
    url = os.environ.get("GRAFANA_URL", "http://localhost:3000")
    secrets = env_datei("~/radler-ems/secrets.env")
    basis = env_datei("~/.smarthome-secrets")
    pw = os.environ.get("GRAFANA_PASSWORD") or basis.get("GRAFANA_PW")
    token = secrets.get("INFLUX_TOKEN_GRAFANA")
    if not pw or not token:
        sys.exit("GRAFANA_PW (~/.smarthome-secrets) oder INFLUX_TOKEN_GRAFANA (secrets.env) fehlt")
    auth = "Basic " + base64.b64encode(f"{os.environ.get('GRAFANA_USER', 'admin')}:{pw}".encode()).decode()

    def api(methode, pfad, daten=None):
        req = urllib.request.Request(url + pfad, method=methode,
                                     data=json.dumps(daten).encode() if daten is not None else None,
                                     headers={"Authorization": auth, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    ds = {"name": "Radler-EMS", "uid": "radler-influx", "type": "influxdb", "access": "proxy",
          "url": "http://localhost:8086", "isDefault": False,
          "jsonData": {"version": "Flux", "organization": os.environ.get("INFLUX_ORG", "home"), "defaultBucket": "geraete"},
          "secureJsonData": {"token": token}}
    code, _ = api("GET", "/api/datasources/uid/radler-influx")
    code, antwort = api("PUT", "/api/datasources/uid/radler-influx", ds) if code == 200 else api("POST", "/api/datasources", ds)
    print(f"Datenquelle Radler-EMS: HTTP {code}")
    code, h = api("GET", "/api/datasources/uid/radler-influx/health")
    print(f"  Verbindung: {h.get('status')} {h.get('message')}")

    code, _ = api("GET", "/api/folders/radler-ems")
    if code != 200:
        code, _ = api("POST", "/api/folders", {"uid": "radler-ems", "title": "Radler-EMS"})
    print(f"Ordner Radler-EMS: HTTP {code}")

    for datei in sorted((REPO / "grafana" / "dashboards").glob("*.json")):
        d = json.loads(datei.read_text(encoding="utf-8"))
        code, a = api("POST", "/api/dashboards/db", {"dashboard": d, "folderUid": "radler-ems", "overwrite": True,
                                                       "message": "Radler-EMS eingespielt"})
        print(f"Dashboard {d['title']}: HTTP {code} {a.get('url', a.get('message', ''))}")


if __name__ == "__main__":
    main()
