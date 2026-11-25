#!/usr/bin/env bash
# InfluxDB für Radler-EMS einrichten (wiederholbar). Auf dem Pi als pi ausführen:
#   bash ~/radler-ems/deploy/influx_einrichten.sh
# Legt an (falls noch nicht vorhanden):
#   Buckets   geraete (90 Tage), geraete_15m (unbegrenzt), ems (1 Jahr), markt (unbegrenzt)
#   Task      geraete_15m (15-Minuten-Mittel)
#   Tokens    "radler-ems nodered" (lesen + schreiben), "radler-ems grafana" (nur lesen)
# und trägt die Tokens in secrets.env ein (INFLUX_TOKEN_NODERED, INFLUX_TOKEN_GRAFANA).
# Voraussetzung: influx-CLI mit Admin-Konfiguration (legt "influx setup" an, siehe deploy/setup-basis.sh).
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
ORG="${INFLUX_ORG:-home}"
SECRETS="${SECRETS:-$HOME/radler-ems/secrets.env}"

bucket() {
  if influx bucket list --org "$ORG" --name "$1" >/dev/null 2>&1; then echo "Bucket $1 vorhanden"
  else influx bucket create --org "$ORG" --name "$1" --retention "$2" >/dev/null && echo "Bucket $1 angelegt ($2)"; fi
}
bid() { influx bucket list --org "$ORG" --name "$1" --json | jq -r '.[0].id'; }

bucket geraete 90d
bucket geraete_15m 0
bucket ems 365d
bucket markt 0

if influx task list --org "$ORG" --json | jq -e '.[] | select(.name == "geraete_15m")' >/dev/null; then
  echo "Task geraete_15m vorhanden"
else
  influx task create --org "$ORG" --file "$HIER/influxdb/geraete_15m.flux" >/dev/null && echo "Task geraete_15m angelegt"
fi

token() {  # Beschreibung, dann Rechte; vorhandenen Token wiederverwenden
  local desc="$1"; shift
  local t
  t=$(influx auth list --org "$ORG" --json | jq -r --arg d "$desc" '.[] | select(.description == $d) | .token' | head -1)
  if [ -z "$t" ]; then t=$(influx auth create --org "$ORG" --description "$desc" "$@" --json | jq -r '.token'); fi
  echo "$t"
}
G=$(bid geraete); G15=$(bid geraete_15m); E=$(bid ems); M=$(bid markt)
NR=$(token "radler-ems nodered" --read-bucket "$G" --write-bucket "$G" --read-bucket "$E" --write-bucket "$E" \
                               --read-bucket "$M" --write-bucket "$M" --read-bucket "$G15")
GF=$(token "radler-ems grafana" --read-bucket "$G" --read-bucket "$G15" --read-bucket "$E" --read-bucket "$M")

setze() {  # Schlüssel in secrets.env setzen oder ergänzen
  touch "$SECRETS"; chmod 600 "$SECRETS"
  if grep -q "^$1=" "$SECRETS"; then sed -i "s|^$1=.*|$1=$2|" "$SECRETS"; else echo "$1=$2" >> "$SECRETS"; fi
}
setze INFLUX_TOKEN_NODERED "$NR"
setze INFLUX_TOKEN_GRAFANA "$GF"
echo "Tokens in $SECRETS eingetragen"
