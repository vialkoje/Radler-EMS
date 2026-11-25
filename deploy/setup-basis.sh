#!/usr/bin/env bash
# Einrichtung Smart-Home-Basis: InfluxDB 2, Grafana OSS, Node-RED
# Aufruf auf dem Pi als Benutzer pi:  bash ~/radler-ems/deploy/setup-basis.sh
set -euo pipefail

CRED_FILE="$HOME/zugangsdaten-smarthome.txt"
ORG="home"
BUCKET="home"
LOG="$HOME/setup-smarthome.log"
exec > >(tee -a "$LOG") 2>&1

step() { echo; echo "=== $* ==="; }
rand() { openssl rand -hex "${1:-12}"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als Benutzer pi starten, nicht mit sudo."; exit 1
fi

step "sudo-Passwort abfragen (Passwort des Pi)"
sudo -v
# sudo-Sitzung waehrend der Installation aktiv halten
( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
KEEPALIVE=$!
trap 'kill $KEEPALIVE 2>/dev/null || true' EXIT

# Zugangsdaten nur einmal erzeugen (Skript ist wiederholbar)
if [ -f "$HOME/.smarthome-secrets" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.smarthome-secrets"
else
  INFLUX_PW="$(rand 12)"; INFLUX_TOKEN="$(rand 32)"
  GRAFANA_PW="$(rand 12)"; NODERED_PW="$(rand 12)"; NODERED_SECRET="$(rand 24)"
  umask 077
  cat > "$HOME/.smarthome-secrets" <<EOF
INFLUX_PW=$INFLUX_PW
INFLUX_TOKEN=$INFLUX_TOKEN
GRAFANA_PW=$GRAFANA_PW
NODERED_PW=$NODERED_PW
NODERED_SECRET=$NODERED_SECRET
EOF
  umask 022
fi

step "System aktualisieren"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install \
  curl gnupg ca-certificates apt-transport-https jq openssl unattended-upgrades build-essential git
sudo install -d -m 0755 /etc/apt/keyrings

step "Automatische Sicherheitsupdates aktivieren"
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive dpkg-reconfigure -f noninteractive unattended-upgrades

# ---------------------------------------------------------------- InfluxDB 2
step "InfluxDB 2 installieren"
curl -fsSL https://repos.influxdata.com/influxdata-archive.key | gpg --dearmor | sudo tee /etc/apt/keyrings/influxdata-archive.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/influxdata-archive.gpg] https://repos.influxdata.com/debian stable main" | sudo tee /etc/apt/sources.list.d/influxdata.list >/dev/null
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install influxdb2 influxdb2-cli
sudo systemctl enable --now influxdb
for i in $(seq 1 30); do influx ping >/dev/null 2>&1 && break; sleep 2; done
if influx setup --skip-verify --force --host http://localhost:8086 \
     --username admin --password "$INFLUX_PW" --org "$ORG" --bucket "$BUCKET" \
     --retention 0 --token "$INFLUX_TOKEN" >/dev/null 2>&1; then
  echo "InfluxDB eingerichtet (Org $ORG, Bucket $BUCKET)."
else
  echo "InfluxDB war bereits eingerichtet - Setup uebersprungen."
fi

# ---------------------------------------------------------------- Grafana
step "Grafana OSS installieren"
curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list >/dev/null
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install grafana

# Keine Datenquelle mit dem Admin-Token: Grafana bekommt die Datenquelle „Radler-EMS“ mit einem nur-lesenden
# Token später über tools/grafana_einspielen.py (nach deploy/influx_einrichten.sh).

sudo systemctl daemon-reload
sudo systemctl enable grafana-server
sudo systemctl restart grafana-server
for i in $(seq 1 60); do curl -fs http://localhost:3000/api/health >/dev/null && break; sleep 2; done
# Standardpasswort admin/admin ersetzen (nur wenn noch aktiv)
if curl -fs -u admin:admin http://localhost:3000/api/user >/dev/null; then
  curl -fs -u admin:admin -X PUT -H 'Content-Type: application/json' \
    -d "{\"oldPassword\":\"admin\",\"newPassword\":\"$GRAFANA_PW\",\"confirmNew\":\"$GRAFANA_PW\"}" \
    http://localhost:3000/api/user/password >/dev/null && echo "Grafana-Adminpasswort gesetzt."
fi

# ---------------------------------------------------------------- Node-RED
step "Node.js und Node-RED installieren (offizielles Skript)"
curl -fsSL -o /tmp/nodered-install.sh https://github.com/node-red/linux-installers/releases/latest/download/install-update-nodered-deb
bash /tmp/nodered-install.sh --confirm-install --confirm-pi --no-init </dev/null
sudo systemctl enable nodered.service
sudo systemctl start nodered.service
for i in $(seq 1 60); do [ -f "$HOME/.node-red/settings.js" ] && break; sleep 2; done
sudo systemctl stop nodered.service

step "Node-RED absichern und InfluxDB-Nodes installieren"
NR_HASH="$(cd /usr/lib/node_modules/node-red && node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 8))" "$NODERED_PW")"
if ! grep -q 'SMARTHOME-SETUP' "$HOME/.node-red/settings.js"; then
  cat >> "$HOME/.node-red/settings.js" <<EOF

// SMARTHOME-SETUP: Login fuer den Editor und Schluessel fuer gespeicherte Zugangsdaten
module.exports.adminAuth = {
    type: "credentials",
    users: [{ username: "admin", password: "$NR_HASH", permissions: "*" }]
};
module.exports.credentialSecret = "$NODERED_SECRET";
EOF
fi
(cd "$HOME/.node-red" && npm install --no-fund --no-audit --omit=dev @node-red/node-red-contrib-influxdb 2>/dev/null \
   || npm install --no-fund --no-audit --omit=dev node-red-contrib-influxdb)
sudo systemctl start nodered.service

# ---------------------------------------------------------------- Abschluss
IP="$(hostname -I | awk '{print $1}')"
umask 077
cat > "$CRED_FILE" <<EOF
Smart-Home-Basis auf $(hostname) ($IP) - erstellt $(date '+%Y-%m-%d %H:%M')

InfluxDB 2      http://$IP:8086
  Benutzer:     admin
  Passwort:     $INFLUX_PW
  Organisation: $ORG
  Bucket:       $BUCKET
  Admin-Token:  $INFLUX_TOKEN  (darf alles: nicht in Grafana oder Node-RED eintragen)

Grafana         http://$IP:3000
  Benutzer:     admin
  Passwort:     $GRAFANA_PW
  Datenquelle: folgt mit tools/grafana_einspielen.py (nur-lesender Token).

Node-RED        http://$IP:1880
  Benutzer:     admin
  Passwort:     $NODERED_PW
  InfluxDB-Nodes installiert: URL http://localhost:8086, Org $ORG, Bucket $BUCKET, Token wie oben.
EOF

step "Status"
for s in influxdb grafana-server nodered; do printf '%-16s %s\n' "$s" "$(systemctl is-active $s)"; done
echo
echo "FERTIG. Zugangsdaten: $CRED_FILE"
