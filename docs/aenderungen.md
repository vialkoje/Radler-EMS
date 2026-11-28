# Änderungsverlauf

Neueste zuerst. Was aus Haus-EMS übernommen ist, steht mit dessen Flow-Stand dabei (Haus-EMS führt eine eigene Liste).

| Datum | Änderung | aus Haus-EMS | Doku |
|---|---|---|---|
| 28.11.2026 | **Warmwasser in günstigen Stunden** (`WW_GUENSTIG`, Standard `beobachten`); Simulator mit Warmwasserspeicher (`wp.ww_C`), Grafana-Kurve „Warmwasser“ | flows-34 | [Wärmepumpe](waermepumpe.md#warmwasser) |
| 28.11.2026 | Regeln für Adapter aus den Fehlern in Haus-EMS (Modbus-Timeout, Leistung in jedem Zustand, Antwort prüfen, Change-Knoten) | flows-28, flows-33 | [Geräte-Adapter](geraete-adapter.md#lehren-aus-haus-ems-fehler-die-dort-im-betrieb-aufgetreten-sind) |
| 25.11.2026 | Grundinstallation ohne Grafana-Datenquelle mit dem InfluxDB-Admin-Token | – | [InfluxDB und Grafana](influxdb-grafana.md#tokens) |
| 25.11.2026 | Ablage der Zugangsdaten dokumentiert, Dateirechte nur für pi | – | [Betrieb](betrieb.md#zugangsdaten-wo-sie-liegen-und-wer-sie-lesen-kann) |
| 25.11.2026 | Balkonkraftwerk (optional, `BKW_QUELLE`); erste Abrufe von Preisen, Prognose und Wetter 30–45 s nach dem Start, Preise alle 15 min, Prognose alle 30 min | – | [Einstellungen](einstellungen.md#anlage) |
| 25.11.2026 | **erste Fassung:** Prozessabbild, Log und Meldungen, Netzladen (Vorschau), Wasserlinie, Ausführung, Ladeplanung mit PV-Laden, Wärmepumpen-Steuerung, Simulator, InfluxDB-Buckets, Grafana, Einrichtungsskripte | Stand flows-32 | [Architektur](architektur.md) |

Schon beim Übernehmen berücksichtigt (in Haus-EMS erst später korrigiert): Zusage-Wächter ohne Alarm bei unbekannter
Ladeleistung (flows-28), Tagesbericht rechnet das Auto aus Minutenwerten (flows-32), Antworten von Preis-, Prognose- und
Wetterdienst werden vor dem Auswerten geprüft (vgl. flows-33, K4).

Nicht übernommen, weil es in Radler-EMS nicht vorkommt: Solcast-Abrufzähler (Radler-EMS nutzt Open-Meteo ohne Zähler),
zweiter Hausakku (Solakon-Nulleinspeisung), Waterkotte-spezifische Warmwasser-Sperre und Absenkungsausgleich (hier über
`ww_absenken` im Befehl, der Adapter setzt es um).
