#!/usr/bin/env bash
# Node-RED für Radler-EMS einrichten (wiederholbar). Auf dem Pi als pi ausführen:
#   bash ~/radler-ems/deploy/nodered_einrichten.sh
# 1. Logger-Zusatz an ~/.node-red/settings.js anhängen (einmal)
# 2. ~/.node-red/environment → ~/radler-ems/secrets.env verlinken: der Node-RED-Dienst liest die Datei beim Start
#    (EnvironmentFile im systemd-Dienst des offiziellen Installers)
# 3. Log-Verzeichnis anlegen
# Danach Node-RED neu starten: sudo systemctl restart nodered (oder den Pi neu starten).
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS="$HOME/.node-red/settings.js"
SECRETS="$HOME/radler-ems/secrets.env"

if grep -q 'RADLER-EMS' "$SETTINGS"; then echo "settings.js: Zusatz vorhanden"
else cat "$HIER/deploy/settings-radler.js" >> "$SETTINGS"; echo "settings.js: Zusatz angehängt"; fi
node -e "require('$SETTINGS')" && echo "settings.js: lädt fehlerfrei"

if [ ! -f "$SECRETS" ]; then
  cp "$HIER/deploy/secrets.env.example" "$SECRETS"; chmod 600 "$SECRETS"
  echo "secrets.env aus der Vorlage angelegt: bitte ausfüllen"
fi
ln -sfn "$SECRETS" "$HOME/.node-red/environment"
echo "~/.node-red/environment → $SECRETS"

mkdir -p "$HOME/radler-ems/log" "$HOME/radler-ems/backup"
# Nur pi darf Zugangsdaten lesen: settings.js enthält den Schlüssel für flows_cred.json
chmod 700 "$HOME/radler-ems/log" "$HOME/radler-ems/backup"
chmod 600 "$SECRETS" "$SETTINGS"; [ -f "$HOME/.node-red/flows_cred.json" ] && chmod 600 "$HOME/.node-red/flows_cred.json"
echo "Fertig. Node-RED neu starten, damit Einstellungen und Logger gelten: sudo systemctl restart nodered"
