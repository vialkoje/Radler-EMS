# Hinweise für Claude

## Arbeitsweise

- Doku und Antworten auf Deutsch; Doku bei jeder Änderung der Regelung mitziehen (`docs/`, `README.md`).
- Funktionsknoten nur in `nodered/funktionen/*.js` ändern, danach `python3 nodered/build.py`. Nie `flows.json` von Hand.
- Dashboards nur über `grafana/build_dashboards.py`.
- Tests: `node --test tests/`. Neue Regeln bekommen einen Test.
- Jede Änderung bekommt eine Zeile in `docs/aenderungen.md`; was aus Haus-EMS kommt, mit dessen Flow-Stand.
- Neue Regeln aus Haus-EMS übernehmen: dort nachlesen (`docs/`), hier geräteunabhängig umsetzen (Befehl und Messwerte
  über die Adapter-Schnittstelle), Standard `beobachten`, Test und Simulator so erweitern, dass die Wirkung sichtbar ist.
- Keine Zugangsdaten, Adressen, Standorte oder Namen von Personen in Flows, Code oder Doku. Werte gehören in
  `secrets.env` (Vorlage `deploy/secrets.env.example`), im Code nur der Name mit `env.get()`.

## Grundsätze (aus Haus-EMS)

1. **Ein Prozessabbild:** Jedes Signal wird an genau einer Stelle gelesen und über „→ Messwerte“ ins Abbild und in
   die InfluxDB geschrieben. Regeln lesen nur aus dem Abbild, die InfluxDB nur für Verläufe (Lastprofil).
2. **Ein Schreiber je Gerät:** Batterie nur über die EMS-Ausführung, Wallbox nur über die Ladeplanung, Wärmepumpe nur
   über die WP-Steuerung.
3. **Ein Log:** alles über den Link „→ Log“; Meldungen entstehen nur aus Logeinträgen mit `melden`.
4. **Modi:** `aus | beobachten | aktiv`. Neue Regeln und neue Geräte laufen zuerst in `beobachten`.

## Ziele der Regelung (Rangfolge)

1. Feste Zusagen (Auto 25/50 %, Heizlauf nicht unterbrechen, Akku-Grenzen).
2. Kostenoptimal.
3. Bei geringem Kostenvorteil: komponentenschonend und netzdienlich.
