# Betrieb auf dem Raspberry Pi

## Neu aufsetzen

Raspberry Pi 4/5 mit Raspberry Pi OS 64-bit (Lite reicht), am besten von SSD. Mit dem Raspberry Pi Imager gleich
Hostname, Benutzer `pi`, eigenes Passwort und SSH-Schlüssel setzen.

```bash
git clone https://github.com/<konto>/Radler-EMS.git ~/radler-ems
bash ~/radler-ems/deploy/setup-basis.sh
```

`setup-basis.sh` aktualisiert das System, schaltet automatische Sicherheitsupdates ein, installiert InfluxDB 2,
Grafana OSS und Node-RED aus den offiziellen Quellen, setzt zufällige Passwörter und legt sie in
`~/zugangsdaten-smarthome.txt` ab. Dann:

```bash
bash ~/radler-ems/deploy/nodered_einrichten.sh   # Logger in settings.js, secrets.env, Log-Verzeichnis
nano ~/radler-ems/secrets.env                    # Standort, PV-Flächen, Akku, Modi
bash ~/radler-ems/deploy/influx_einrichten.sh    # Buckets, Task, Tokens
sudo systemctl restart nodered
python3 ~/radler-ems/tools/flows_einspielen.py
python3 ~/radler-ems/tools/grafana_einspielen.py
```

| Dienst | Adresse |
|---|---|
| Node-RED | `http://<pi>:1880` |
| Grafana | `http://<pi>:3000` → Dashboards → Radler-EMS |
| InfluxDB | `http://<pi>:8086` |

## Änderungen einspielen

```bash
cd ~/radler-ems && git pull
python3 tools/flows_einspielen.py      # sichert vorher nach ~/radler-ems/backup/
python3 tools/grafana_einspielen.py
```

`flows_einspielen.py` ersetzt **alle** Flows. Was nur im Editor geändert wurde, geht verloren, außer es wurde vorher in
`nodered/funktionen/` bzw. `nodered/build.py` übernommen. Die letzte Sicherung zurückholen: im Editor Menü → Import
→ Datei aus `~/radler-ems/backup/`, oder `cp` nach `~/.node-red/flows.json` und Node-RED neu starten.

## Einstellungen ändern

`~/radler-ems/secrets.env` bearbeiten, dann `sudo systemctl restart nodered`. Die Startmeldung im Log nennt die aktiven
Modi und Quellen. Alle Variablen: [Einstellungen](einstellungen.md).

## Zugangsdaten: wo sie liegen und wer sie lesen kann

Adressen, Benutzer, Passwörter und Tokens der Geräte stehen **nur** in `~/radler-ems/secrets.env`:

| Ort | Inhalt | Schutz |
|---|---|---|
| `~/radler-ems/secrets.env` | Geräte (`…_HOST`, `…_USER`, `…_PASSWORD`), InfluxDB-Tokens, Einstellungen | nicht im Repository (`.gitignore`), `chmod 600` (nur pi) |
| Repository, `nodered/flows.json` | nur **Namen** wie `env.get('WP_PASSWORD')` oder `${WALLBOX_HOST}` | keine Werte |
| `~/.node-red/flows_cred.json` | InfluxDB-Token des Konfigurationsknotens (beim Einspielen eingesetzt) | verschlüsselt mit `credentialSecret` aus `settings.js`, beide `chmod 600` |
| `~/.smarthome-secrets`, `~/zugangsdaten-smarthome.txt` | Admin-Passwörter von Node-RED, Grafana, InfluxDB | `chmod 600` |

**Was das nicht verhindert:** Node-RED braucht die Werte zur Laufzeit. Jeder Funktionsknoten kann sie mit
`env.get()` lesen, und wer sich im Node-RED-Editor anmeldet, könnte einen Knoten bauen, der sie ausgibt. Der Editor
ist deshalb mit Passwort geschützt; wer ihn bedienen darf, darf auch die Geräte steuern. Die HTTP-Endpunkte (`/radler/…`)
und Grafana geben keine Zugangsdaten heraus. Regeln für den Code:

- Zugangsdaten nie in `node.status`, `node.warn`, das Log oder die InfluxDB schreiben, nie in Kommentare.
- In Knoteneigenschaften nur `${NAME}` eintragen (HTTP-URL, Modbus-Host); Node-RED setzt den Wert beim Start ein,
  im Export steht weiter `${NAME}`.
- Wer `secrets.env` weitergibt (z. B. bei der Übergabe), gibt alle Zugänge weiter. Nach der Übergabe Passwörter ändern.

## Woran man sieht, dass alles läuft

- Grafana „Radler-EMS: Entscheidungen“: oben drei Zeilen (Batterie, Wallbox, Wärmepumpe) laufen mit.
- Node-RED: Statuszeilen unter „Ausführung“, „Strategie“, „Ladeplanung“, „Wärmepumpe steuern“, „Geräte prüfen“ (grün
  „alle Geräte liefern“).
- Log: `tail -f ~/radler-ems/log/radler-ems-$(date +%F).log`
- Node-RED-Protokoll: `journalctl -u nodered -f`

## Sicherung

| Was | Wo | wie |
|---|---|---|
| Flows | `~/.node-red/flows.json`, `flows_cred.json` | `tools/flows_einspielen.py --nur-sichern` |
| Einstellungen | `~/radler-ems/secrets.env` | kopieren (enthält Zugangsdaten!) |
| InfluxDB | `/var/lib/influxdb` | `influx backup ~/influx-backup-$(date +%F)` |
| Grafana | Dashboards im Repository | `tools/grafana_einspielen.py` stellt sie wieder her |

## Aktualisieren

- Betriebssystem, InfluxDB und Grafana: automatische Sicherheitsupdates; sonst `sudo apt update && sudo apt full-upgrade`.
- Node-RED und Node.js: offizielles Skript erneut ausführen
  (`bash <(curl -sL https://github.com/node-red/linux-installers/releases/latest/download/install-update-nodered-deb)`).
- Vorher bei echten Geräten die Modi auf `beobachten` setzen; was die Geräte beim Ausfall von Node-RED tun, steht in
  [Architektur](architektur.md#sicherheitsnetz).

## Übergabe des Pi an Freunde

1. Neue Passwörter: `passwd` (Benutzer pi), Grafana (Profil → Passwort), Node-RED (`node-red admin hash-pw`, in
   `~/.node-red/settings.js` bei `adminAuth` eintragen), InfluxDB (`influx user password -n admin`).
2. Eigene SSH-Schlüssel entfernen: `~/.ssh/authorized_keys`.
3. `~/radler-ems/secrets.env` auf die neue Anlage einstellen (Standort, Geräte, Tarif), `NTFY_TOPIC` neu.
4. Alte Messwerte löschen, wenn gewünscht: `influx bucket delete -n geraete` usw., dann
   `deploy/influx_einrichten.sh` erneut (legt Buckets und Tokens neu an; danach Flows und Grafana neu einspielen).
5. `~/zugangsdaten-smarthome.txt` mit den neuen Passwörtern übergeben, danach vom Pi löschen.
