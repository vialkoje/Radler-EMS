# Geräte-Adapter: echte Geräte anbinden

Jedes Gerät hängt über einen **Adapter** am EMS. Der Adapter ist das einzige Stück, das das Gerät kennt. Die
Regeln bleiben gleich, egal ob Fronius, SMA, Kostal, go-e, KEBA oder Vaillant dahinter steckt.

## Ablauf beim Anbinden

1. **Modell und Schnittstelle klären** (Checkliste unten): Modbus TCP, HTTP/JSON, MQTT, Cloud-API?
   Lokale Schnittstellen sind besser (kein Internet nötig, schneller, keine Sperren).
2. **Zugang** in `~/radler-ems/secrets.env` eintragen (`WECHSELRICHTER_HOST` …), Node-RED neu starten.
3. **Lesen:** Im Geräte-Tab vor den Knoten „Adapter …: lesen (Vorlage)“ einen Abfrage-Knoten setzen (HTTP-Request,
   `node-red-contrib-modbus`, MQTT-in), im Funktionsknoten die Antwort ins Format unten umrechnen.
4. `<GERÄT>_QUELLE=geraet` setzen, Node-RED neu starten. Der Simulator lässt dieses Gerät dann weg.
5. **Prüfen** (Grafana „Energie“): Stimmen die Vorzeichen? Speist die Anlage ein, muss `netz.bezug_W` negativ sein.
   Lädt der Akku, muss `batterie.leistung_W` negativ sein. Stimmt die Bilanz (`haus.verbrauch_W` plausibel, nie
   dauerhaft 0)?
6. **Schreiben:** Funktionsknoten „Adapter …: senden (Vorlage)“ ausfüllen, dahinter den Schreib-Knoten. Erst mit
   `…_MODUS=beobachten` einige Tage zusehen (Grafana „Entscheidungen“), dann einzelne Befehle von Hand testen, dann
   `aktiv`.
7. Im Generator nachziehen (`nodered/build.py`), damit es im Repository steht, und die Erkenntnisse hier ergänzen.

Wichtig: Änderungen nur im Editor gehen beim nächsten `flows_einspielen.py` verloren. Entweder vorher in den
Generator übernehmen oder die Flows im Editor exportieren und ins Repository legen.

## Schnittstelle: lesen

Ausgang des Adapters → Link „→ Messwerte“:

```js
{ geraet: 'batterie', quelle: 'geraet', payload: { soc_pct: 54.2, leistung_W: -1830 } }
```

| `geraet` | Felder | Vorzeichen / Werte | Takt |
|---|---|---|---|
| `pv` | `leistung_W` | ≥ 0 (AC-Leistung der PV; beim Hybrid-WR ohne Batterieanteil) | 10 s |
| `bkw` | `leistung_W`, optional `soc_pct` | ≥ 0, AC-Abgabe des Balkonkraftwerks | 10–60 s |
| `netz` | `bezug_W` | **> 0 Bezug, < 0 Einspeisung** (Zähler am Netzanschluss) | 10 s |
| `batterie` | `soc_pct`, `leistung_W` | **> 0 Entladen, < 0 Laden** | 10 s |
| `wallbox` | `leistung_W`, `status`, `ampere` | status: `getrennt`, `angesteckt`, `laedt`, `pausiert`, `stoerung` | 10–60 s |
| `auto` | `soc_pct` | 0–100 | 5–15 min |
| `wp` | `leistung_W`, `status`, optional `aussen_C`, `raum_C` | status: `aus`, `heizen`, `warmwasser`, `stoerung` | 60 s |

Zusätzliche Felder sind erlaubt (landen in der InfluxDB), z. B. `tagesertrag_kWh`, `temperatur_C`.

Den **Netzwert** zuletzt schicken: Mit ihm rechnet das Prozessabbild die Hausbilanz aus den anderen Werten.

## Schnittstelle: Befehle

Eingang des Adapters (nur mit `<GERÄT>_QUELLE=geraet`):

| Gerät | Befehl | Bedeutung |
|---|---|---|
| Batterie | `{ modus: 'eigenverbrauch' }` | Normalbetrieb des Geräts: auf 0 W am Netz regeln |
| | `{ modus: 'laden', leistung_W }` | aus dem Netz laden (Netzladen) |
| | `{ modus: 'begrenzt', max_laden_W, max_entladen_W }` | Eigenverbrauch mit Grenzen, `null` = keine, `0` = gesperrt |
| Wallbox | `{ modus: 'frei' }` / `{ modus: 'pause' }` | laden mit voller Leistung / nicht laden |
| | `{ modus: 'strom', ampere }` | laden mit diesem Strom je Phase (PV-Laden) |
| Wärmepumpe | `{ sgready, anhebung_K, ww_absenken }` | siehe [Wärmepumpe](waermepumpe.md) |

Batteriebefehle kommen alle 60 s, Wallbox und WP bei Änderung und alle 15 min. **Timeout am Gerät nutzen**, wo es geht:
Ohne neuen Befehl soll das Gerät nach einigen Minuten in den Normalbetrieb fallen.

Kann ein Gerät etwas nicht (z. B. keine Ladegrenze, nur „Netzladen an/aus“), setzt der Adapter das Nächstbeste um
und schreibt eine Warnung ins Log (`node.warn` reicht).

## Checkliste je Gerät (vor dem Hackathon einholen)

**PV-Wechselrichter und Zähler**
- Hersteller, Modell, Firmware; Hybrid-Wechselrichter (Batterie dran) ja/nein
- Smart Meter am Netzanschluss? Welcher (Modell, Einbauort)? Liefert er die Netzleistung über den Wechselrichter?
- Lokale Schnittstelle: Modbus TCP (SunSpec?) aktivierbar? Port, Unit-ID; oder HTTP/JSON-API
- Dachflächen: Neigung, Ausrichtung, kWp je Fläche → `PV_FLAECHEN`

**Balkonkraftwerk (falls vorhanden)**
- Wechselrichter (Hersteller, Modell), Einspeisegrenze (800 W) → `BKW_MAX_W`; Module: Neigung, Ausrichtung, Wp → `BKW_FLAECHEN`
- Lokale Schnittstelle? Viele Mikro-Wechselrichter haben keine; dann einen Messstecker (z. B. Shelly Plug S, lokal per HTTP oder MQTT) davor
- Mit eigenem Akku (z. B. Anker Solix, Zendure, Solakon ONE)? Dann regelt er oft selbst auf Nulleinspeisung, siehe [Simulator](simulator.md#grenzen) und Haus-EMS

**PV-Batterie**
- Hersteller, Modell, nutzbare Kapazität, max. Lade-/Entladeleistung → `BATTERIE_*`
- Lässt sich per Modbus/API laden/entladen begrenzen oder aus dem Netz laden? Gibt es einen Timeout?
- Notstrom-Reserve am Gerät eingestellt? (→ `BATTERIE_MIN_SOC`)

**Wallbox und Auto**
- Wallbox: Hersteller, Modell; Modbus TCP, HTTP-API (z. B. go-e, Warp, openWB), OCPP? Pausieren und Ladestrom setzen
  möglich? 1/3 Phasen, max. Strom → `WB_*`
- Ist die Wallbox an eine Cloud/App mit eigener Ladeplanung gebunden? (muss dann auf „sofort laden“ stehen)
- Auto: Akku (kWh netto), Ladeziel im Auto, Schnittstelle für den Ladestand (Hersteller-API, OBD-Dongle)? Sonst
  manuell.
- Abfahrtszeiten → `WB_ABFAHRT`, `WB_ABFAHRT_TAGE`

**Wärmepumpe**
- Hersteller, Modell, Regler; Fußbodenheizung oder Heizkörper; Pufferspeicher
- SG-Ready-Eingang vorhanden und belegt? Sonst Modbus/HTTP (Sollwertverschiebung, Warmwasser-Sollwert)?
- Stromzähler für die WP (eigener Zähler, Smart-Plug-Messung nicht möglich bei 400 V)? Sonst schätzen aus Status.
- Raumtemperatur: Fühler vorhanden (Thermostate, Zigbee)? → `wp.raum_C`

**Strom**
- Tarif: fester Preis oder dynamisch (Tibber, Rabot, …)? Bei festem Preis: Netzladen `NL_MODUS=aus`,
  `WB_STRATEGIE=sperre` und günstige WP-Fenster nutzen nichts; PV-Überschussregeln bleiben sinnvoll.
- Abgaben und Netzentgelt je kWh (brutto) → `ABGABEN_CT`; Einspeisevergütung → `EINSPEISE_CT`

## Nützliche Paletten

Im Editor „Palette verwalten“, oder auf dem Pi in `~/.node-red`: `npm install <paket>` und Node-RED neu starten.

| Paket | für |
|---|---|
| `node-red-contrib-modbus` | Modbus TCP (Wechselrichter, Wallbox, WP); eine Client-Verbindung je Gerät für alle Knoten |
| `node-red-contrib-ocpp` | Wallboxen mit OCPP (Node-RED als Zentrale) |
| eingebaut: `http request`, `mqtt in/out` | HTTP/JSON-Geräte, Shelly, Tasmota, evcc, Zigbee2MQTT |

Erfahrung aus Haus-EMS: **nur eine Modbus-Verbindung je Gerät** (sonst Lesefehler), Register einzeln und in fester
Reihenfolge schreiben, Vorzeichen am Gerät prüfen.
