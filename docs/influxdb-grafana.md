# InfluxDB und Grafana

## Buckets (Organisation `home`)

| Bucket | Aufbewahrung | Inhalt | schreibt |
|---|---|---|---|
| `geraete` | 90 Tage | Messwerte aller Geräte, 10-s-Raster, und die Hausbilanz | „InfluxDB geraete“ (nur über „→ Messwerte“) |
| `geraete_15m` | unbegrenzt | 15-Minuten-Mittel aller Zahlen aus `geraete` | Task `geraete_15m` (`influxdb/geraete_15m.flux`) |
| `ems` | 1 Jahr | Entscheidungen und Log | Strategie, Ausführung, Ladeplanung, WP-Steuerung, Log |
| `markt` | unbegrenzt | Strompreise, PV-Prognose, Wetter | Tab „💶 Preise & Prognose“ |

Der ältere Bucket `home` (erster Wetter-Flow) bekommt keine neuen Werte mehr und kann gelöscht werden, wenn sein
Verlauf nicht mehr gebraucht wird.

## Messreihen

| Bucket | Messreihe | Felder | Tags |
|---|---|---|---|
| geraete | `pv` | `leistung_W` | `quelle` (simulator, geraet) |
| geraete | `netz` | `bezug_W` (> 0 Bezug) | `quelle` |
| geraete | `batterie` | `soc_pct`, `leistung_W` (> 0 Entladen), beim Simulator `modus` | `quelle` |
| geraete | `wallbox` | `leistung_W`, `status`, `ampere` | `quelle` |
| geraete | `auto` | `soc_pct` | `quelle` (simulator, geraet, manuell) |
| geraete | `wp` | `leistung_W`, `status`, `raum_C`, `aussen_C` | `quelle` |
| geraete | `haus` | `verbrauch_W`, `ohne_auto_W`, `grundlast_W` | `quelle=bilanz` |
| ems | `ems_strategie` | siehe [EMS](ems.md#protokoll-ems_strategie) | |
| ems | `ems_ausfuehrung` | siehe [EMS](ems.md#ausführung-alle-10-s) | |
| ems | `wallbox_plan` | siehe [Wallbox](wallbox.md#protokoll-wallbox_plan) | |
| ems | `wp_steuerung` | siehe [Wärmepumpe](waermepumpe.md#protokoll-wp_steuerung) | |
| ems | `ems_log` | `text` | `stufe` (fehler, warnung), `bereich` |
| markt | `strompreis` | `boerse_ct`, `preis_ct` (Endpreis), je Viertelstunde | `quelle` |
| markt | `pv_prognose` | `leistung_W` je Stunde (Zeitstempel = Beginn) | `quelle` |
| markt | `wetter` | `temperatur`, `gefuehlt`, `taupunkt`, `luftfeuchte`, `niederschlag`, `regen`, `schnee`, `wettercode`, `bewoelkung`, `luftdruck`, `luftdruck_ort`, `wind`, `windrichtung`, `boeen`, `tag` | `ort`, `quelle` |

Beispiel (Flux, z. B. im Data Explorer unter `http://<pi>:8086`):

```flux
from(bucket: "ems")
  |> range(start: -1d)
  |> filter(fn: (r) => r._measurement == "ems_strategie" and r._field == "nl_grund")
```

## Tokens

| Token (Beschreibung) | Rechte | genutzt von |
|---|---|---|
| `radler-ems nodered` | lesen + schreiben `geraete`, `ems`, `markt`; lesen `geraete_15m` | Node-RED (Konfigurationsknoten, eingesetzt von `tools/flows_einspielen.py`) |
| `radler-ems grafana` | nur lesen, alle vier | Grafana-Datenquelle „Radler-EMS“ |

Der Admin-Token aus der Einrichtung bleibt beim `influx`-Kommando des Benutzers `pi` (`~/.influxdbv2/configs`).

## Grafana

Ordner **Radler-EMS**, Datenquelle **Radler-EMS** (uid `radler-influx`, Flux):

| Dashboard | Inhalt |
|---|---|
| Radler-EMS: Energie | aktuelle Leistungen, SoC, Strompreis; Verlauf aller Leistungen, Ladestände, PV Prognose/Ist, Strompreis, kWh im Zeitraum |
| Radler-EMS: Entscheidungen | was das EMS gerade tut (Zustandsverlauf), Netzladen, Wasserlinie, Grenzen der Batterie, Ladeplanung, WP-Anhebung, Fehler und Warnungen, letzte Begründung |
| Radler-EMS: Wetter | Wetter am Standort |

Dashboards ändern: `grafana/build_dashboards.py` bearbeiten, bauen, `tools/grafana_einspielen.py`. Änderungen nur in
der Oberfläche werden beim nächsten Einspielen überschrieben; wer im Editor baut, exportiert das JSON (Teilen →
Exportieren) und übernimmt es in den Generator.
