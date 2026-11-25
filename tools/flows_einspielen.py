#!/usr/bin/env python3
"""Spielt nodered/flows.json in Node-RED ein (vollständiges Deploy über die Admin-API).

Aufruf auf dem Pi:   python3 ~/radler-ems/tools/flows_einspielen.py
Optionen:            --url http://localhost:1880   --nur-sichern

- Sichert vorher den laufenden Stand nach ~/radler-ems/backup/flows-JJJJMMTT-HHMM.json.
- Ersetzt ALLE Flows durch nodered/flows.json (Änderungen im Editor gehen verloren, vorher übernehmen!).
- Setzt den InfluxDB-Token (INFLUX_TOKEN_NODERED aus secrets.env) in den Konfigurationsknoten ein;
  Node-RED speichert ihn verschlüsselt in flows_cred.json, in flows.json steht er nie.
- Anmeldung am Editor: NODERED_USER/NODERED_PASSWORD (Umgebung) oder NODERED_PW aus ~/.smarthome-secrets.
"""
import argparse
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def env_datei(pfad):
    werte = {}
    p = Path(pfad).expanduser()
    if p.exists():
        for zeile in p.read_text(encoding="utf-8").splitlines():
            zeile = zeile.strip()
            if zeile and not zeile.startswith("#") and "=" in zeile:
                k, v = zeile.split("=", 1)
                werte[k.strip()] = v.strip().strip("'\"")
    return werte


def anfrage(url, daten=None, kopf=None, methode=None):
    req = urllib.request.Request(url, data=daten, headers=kopf or {}, method=methode)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("NODERED_URL", "http://localhost:1880"))
    ap.add_argument("--secrets", default="~/radler-ems/secrets.env")
    ap.add_argument("--nur-sichern", action="store_true")
    a = ap.parse_args()

    secrets = env_datei(a.secrets)
    basis = env_datei("~/.smarthome-secrets")
    benutzer = os.environ.get("NODERED_USER", "admin")
    passwort = os.environ.get("NODERED_PASSWORD") or basis.get("NODERED_PW")
    if not passwort:
        sys.exit("Kein Passwort für den Node-RED-Editor (NODERED_PASSWORD oder ~/.smarthome-secrets)")

    tok = anfrage(f"{a.url}/auth/token", urllib.parse.urlencode({
        "client_id": "node-red-admin", "grant_type": "password", "scope": "*",
        "username": benutzer, "password": passwort}).encode())["access_token"]
    kopf = {"Authorization": f"Bearer {tok}", "Node-RED-API-Version": "v2"}

    alt = anfrage(f"{a.url}/flows", kopf=kopf)
    sicherung = Path("~/radler-ems/backup").expanduser()
    sicherung.mkdir(parents=True, exist_ok=True)
    datei = sicherung / f"flows-{datetime.datetime.now():%Y%m%d-%H%M}.json"
    datei.write_text(json.dumps(alt["flows"], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"gesichert: {datei} ({len(alt['flows'])} Knoten)")
    if a.nur_sichern:
        return

    neu = json.loads((REPO / "nodered" / "flows.json").read_text(encoding="utf-8"))
    token = secrets.get("INFLUX_TOKEN_NODERED")
    if not token:
        sys.exit("INFLUX_TOKEN_NODERED fehlt in secrets.env (deploy/influx_einrichten.sh ausführen)")
    for n in neu:
        if n.get("type") == "influxdb":
            n["credentials"] = {"token": token}
    body = json.dumps({"rev": alt["rev"], "flows": neu}).encode("utf-8")
    antwort = anfrage(f"{a.url}/flows", body,
                      dict(kopf, **{"Content-Type": "application/json", "Node-RED-Deployment-Type": "full"}), "POST")
    tabs = [n["label"] for n in neu if n.get("type") == "tab"]
    print(f"eingespielt: {len(neu)} Knoten, {len(tabs)} Tabs ({', '.join(tabs)}), rev {antwort['rev'][:8]}")


if __name__ == "__main__":
    main()
