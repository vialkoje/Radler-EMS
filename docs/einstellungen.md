# Einstellungen (`secrets.env`)

Alle Einstellungen stehen in `~/radler-ems/secrets.env` auf dem Pi (Vorlage: `deploy/secrets.env.example`). Node-RED
liest die Datei beim Start; nach Änderungen `sudo systemctl restart nodered`. Fehlt ein Wert, gilt der Standard aus
dieser Tabelle. Im Code liest jede Regel ihre Werte mit `env.get('NAME')`.

## Standort und Quellen

| Variable | Standard | Bedeutung |
|---|---|---|
| `STANDORT_LAT`, `STANDORT_LON` | Mitte Deutschlands (51,16 / 10,45), mit Warnung beim Start | Koordinaten für Wetter und PV-Prognose |
| `STANDORT_HOEHE`, `STANDORT_NAME` | –, `Standort` | Höhe in m (genauere Temperatur), Name als Tag `ort` im Wetter |
| `PV_QUELLE`, `NETZ_QUELLE`, `BATTERIE_QUELLE`, `WALLBOX_QUELLE`, `WP_QUELLE` | `simulator` | `simulator`, `geraet` (Adapter), `aus` (Gerät fehlt, kein Wächter) |
| `BKW_QUELLE` | `aus` | Balkonkraftwerk: `aus` (nicht vorhanden), `simulator`, `geraet` |
| `AUTO_QUELLE` | `simulator` | zusätzlich `manuell` (Ladestand über `/radler/auto?soc=`) |
| `SIM_ZUFALL` | `an` | `aus`: Simulator ohne Zufall |

## Modi

| Variable | Standard | Werte |
|---|---|---|
| `EMS_MODUS` | `beobachten` | Ausführung: `aus`, `beobachten`, `aktiv` |
| `NL_MODUS` | `vorschau` | Netzladen: `aus`, `beobachten`, `vorschau` (lädt) |
| `WL_MODUS` | `beobachten` | Wasserlinie: `aus`, `beobachten`, `aktiv` |
| `HA_MODUS` | `aktiv` | Akku deckt beim Autoladen das Haus: `aus`, `aktiv` |
| `WB_MODUS` | `beobachten` | Ladeplanung: `aus`, `beobachten`, `aktiv` |
| `WB_PV_MODUS` | `aktiv` | PV-Laden: `aus`, `beobachten`, `aktiv` |
| `WP_MODUS` | `beobachten` | Wärmepumpe: `aus` (0 K), `beobachten`, `aktiv` |
| `WW_GUENSTIG` | `beobachten` | Warmwasser in günstigen Stunden, siehe unten |

## Anlage

| Variable | Standard | Bedeutung |
|---|---|---|
| `PV_FLAECHEN` | `30/0/8` | Dachflächen `Neigung/Azimut/kWp;…`, Azimut 0 = Süd, −90 = Ost, 90 = West |
| `BKW_FLAECHEN` | – | Flächen des Balkonkraftwerks wie `PV_FLAECHEN`, z. B. `90/0/0.8` (senkrecht, Süd, 800 Wp) |
| `BKW_MAX_W` | `800` | Einspeisegrenze des Balkonkraftwerks (Wechselrichter), kappt Prognose und Simulator |
| `PV_PR` | `0.85` | Performance Ratio (Verluste Wechselrichter, Wärme, Kabel) für die Prognose |
| `BATTERIE_KAPAZITAET_WH` | `10000` | nutzbare Kapazität |
| `BATTERIE_MAX_W` | `5000` | max. Lade-/Entladeleistung |
| `BATTERIE_MIN_SOC` | `10` | Untergrenze (Notstrom-Reserve des Geräts), unter der nicht gerechnet wird |
| `BATTERIE_VOLL_SOC` | `99` | ab hier nimmt der Akku keinen Überschuss mehr (Rest geht ans Auto) |
| `LAST_STANDARD_W` | `500` | Hausverbrauch je Stunde, bis das Lastprofil 2 Tage Daten hat |

## Strompreis und Kosten

| Variable | Standard | Bedeutung |
|---|---|---|
| `PREIS_ZONE` | `DE-LU` | Gebotszone bei Energy-Charts (`AT` für Österreich) |
| `ABGABEN_CT` | `18` | Aufschlag auf den Börsenpreis (Netzentgelt, Steuern, Umlagen, Marge) → Endpreis |
| `EINSPEISE_CT` | `8.0` | Einspeisevergütung, für den Tagesbericht |

## Netzladen (Vorschau)

| Variable | Standard | Bedeutung |
|---|---|---|
| `NL_WIRKUNGSGRAD` | `0.85` | Akku hin und zurück (am eigenen Gerät messen: kWh ab / kWh auf über einige Wochen) |
| `NL_AUFSCHLAG_CT` | `4` | spätere Stunde muss nach Verlusten um so viel teurer sein (Abstand, Verschleiß) |
| `NL_LAST_FAKTOR` | `1.2` | Zuschlag aufs Lastprofil |
| `NL_PV_FAKTOR` | `0.9` | Abschlag auf die PV-Prognose |
| `NL_MIN_KWH` | `1` | Mindestmenge und Mindestplatz |
| `NL_SOC_MAX` | `95` | bis hier wird aus dem Netz geladen |
| `NL_LEISTUNG_W` | min(`BATTERIE_MAX_W`, 3000) | Ladeleistung |

## Wasserlinie

| Variable | Standard | Bedeutung |
|---|---|---|
| `WL_RESERVE` | `1.0` | Faktor auf den Bedarf; größer = vorsichtiger, T kleiner |
| `WL_LETZTE_H` | `1` | so viele Stunden vor Ende des Überschusses wird voll geladen |
| `WL_PV_FAKTOR` | `1.0` | Kalibrierung der Prognose (echte PV / Prognose) |

## Wallbox und Auto

| Variable | Standard | Bedeutung |
|---|---|---|
| `WB_STRATEGIE` | `plan` | `plan` (Ladestand und Abfahrt) oder `sperre` (nur teuerste Stunden) |
| `WB_ABFAHRT`, `WB_ABFAHRT_TAGE` | `06:00`, `1,2,3,4,5` | Abfahrt (volle Stunde), Tage 1 = Montag |
| `WB_SOFORT_SOC`, `WB_PFLICHT_SOC`, `WB_ZIEL_SOC` | `25`, `50`, `80` | Stufen der Ladeplanung |
| `WB_AKKU_KWH`, `WB_WIRKUNGSGRAD` | `60`, `0.9` | Auto-Akku netto, Ladeverluste |
| `WB_PHASEN`, `WB_MIN_A`, `WB_MAX_A` | `3`, `6`, `16` | Ladeleistung = A × 230 V × Phasen |
| `WB_TEUER_ANTEIL` | `0.5` | Anteil der teuersten Stunden ohne Laden (Normalziel, Regel „sperre“) |
| `WB_SOC_MAX_ALTER_MIN` | `90` | älterer Ladestand gilt als unbekannt |
| `WB_PV_MIN_KW`, `WB_PV_HALT_KW` | `4.2`, `3.6` | PV-Laden Start/Ende (je 2 min) |
| `WB_MELDUNGEN` | `an` | Lademeldungen |

## Wärmepumpe

| Variable | Standard | Bedeutung |
|---|---|---|
| `WP_HEIZGRENZE_C` | `15` | Heizzeit, wenn die Außentemperatur Ø 24 h darunter liegt |
| `ANHEBUNG_PV_K`, `ANHEBUNG_GUENSTIG_K` | `2`, `2` | Anhebung bei PV-Überschuss / günstigem Strom |
| `PV_START_W`, `PV_HALTEN_W`, `PV_AUS_MIN` | `1500`, `1000`, `20` | PV-Fenster: öffnen, halten, schließen nach |
| `PV_AKKU_SOC` | `80` | ab diesem Akku-SoC zählt seine Ladung als Überschuss |
| `WP_GUENSTIG_ANTEIL` | `0.25` | günstig = billigste 25 % der bekannten Stunden |
| `WP_PV_PROGNOSE_WH` | `15000` | günstige Fenster nur, wenn PV in 12 h darunter |
| `RAUM_MAX_C` | `22` | darüber keine Anhebung |
| `NACHHEIZ_K`, `NACHHEIZ_MIN` | `0.5`, `3` | Heizlauf an Warmwasser anhängen |
| `WW_NACHT_VON`, `WW_NACHT_BIS` | `1`, `5` | Warmwasser nachts absenken |
| `WW_GUENSTIG` | `beobachten` | Warmwasser in günstigen Stunden: `aktiv` (sonst abgesenkt), `beobachten` (nur `ww_fenster` protokollieren), `aus` |
| `WW_GUENSTIG_ANTEIL` | `0.33` | günstig fürs Warmwasser = billigste 33 % der bekannten Stunden außerhalb der Nacht |

## System und Meldungen

| Variable | Standard | Bedeutung |
|---|---|---|
| `LOG_VERZEICHNIS` | `/home/pi/radler-ems/log` | Logdateien |
| `GERAET_OFFLINE_MIN` | `15` | Geräte-Wächter |
| `NTFY_TOPIC`, `NTFY_SERVER` | –, `https://ntfy.sh` | Push-Meldungen; leer = nur Log |
| `MELDUNG_RUHE_VON`, `MELDUNG_RUHE_BIS` | `22`, `7` | Nachtruhe |
| `INFLUX_TOKEN_NODERED`, `INFLUX_TOKEN_GRAFANA` | – | trägt `deploy/influx_einrichten.sh` ein |
