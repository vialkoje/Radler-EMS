# EMS-Hackathon

Ziel: an einem Tag (oder Wochenende) aus dem simulierten Haus ein echtes machen und dabei verstehen, wie ein
Energiemanagement entscheidet. Danach läuft das EMS beim Gastgeber weiter, und der Pi kann dort bleiben.

## Vorher

- **Gastgeber:** Checkliste in [Geräte-Adapter](geraete-adapter.md#checkliste-je-gerät-vor-dem-hackathon-einholen)
  ausfüllen: Modelle, Schnittstellen, Zugangsdaten, Tarif, Abfahrtszeiten. Modbus/API an den Geräten freischalten
  (oft in der App oder im Installateur-Menü), feste IP-Adressen im Router vergeben.
- **Pi:** läuft mit dem Simulator; im Netz des Gastgebers anschließen und `secrets.env` auf Standort, PV-Flächen,
  Akku und Auto einstellen. Ein bis zwei Tage laufen lassen, dann gibt es schon ein Lastprofil (aus dem Simulator).
- **Alle:** Repository klonen, `node --test tests/` läuft, README und [Architektur](architektur.md) gelesen.

## Ablauf (Vorschlag)

| Zeit | Was |
|---|---|
| 30 min | Rundgang: Grafana „Entscheidungen“ zeigt, was das EMS mit dem Simulator tut. Wer erklärt die letzte Netzlade-Entscheidung? |
| 2–3 h | **Teams je Gerät:** Adapter lesen (Vorzeichen prüfen!), `…_QUELLE=geraet`. Rest bleibt simuliert |
| 1 h | Gemeinsam: Bilanz prüfen (Haus-Verbrauch plausibel?), Grafana gegen die Hersteller-App |
| 2 h | Adapter schreiben, Befehle einzeln von Hand testen (Inject mit festem `msg.befehl`), Timeout am Gerät |
| Rest | Modi auf `beobachten`, später `aktiv`; Ideen unten |

Regel für den Tag: **erst lesen, dann beobachten, dann schreiben.** Kein Gerät geht ohne Test von Hand auf `aktiv`.

## Aufgaben und Ideen

**Geräte**
- Adapter für die vier Geräte (die Pflicht).
- Ladestand des Autos über die Hersteller-API.
- Balkonkraftwerk mit eigenem Akku: Nulleinspeisung, ohne dass sich die beiden Akkus gegenseitig laden (Haus-EMS hat das für den Solakon ONE gelöst).
- Wärmepumpe: echten Stromzähler einbinden; Raumtemperatur aus vorhandenen Thermostaten.

**Regeln verbessern**
- PV-Prognose kalibrieren: Faktor je halbe Stunde = echte PV / Prognose der letzten 10 Tage (in Haus-EMS lag die
  Prognose mittags 30 % zu niedrig), ersetzt `WL_PV_FAKTOR`.
- Netzladen mit 15-Minuten-Preisen statt Stundenmitteln (`markt.preise_15` ist schon im Abbild).
- Wallbox: Umschalten 1/3 Phasen, damit PV-Laden schon ab 1,4 kW geht.
- Wärmepumpe: SG-Ready 1 (Sperre) in den teuersten Stunden, wenn das Haus warm genug ist.
- Zusage „Akku-Grenze“: Was soll gemeldet werden?

**Auswerten**
- Simulation über ein Jahr (Haus-EMS hat `tools/jahressimulation.py`): Was bringt welche Regel mit dem Tarif des
  Gastgebers? Daten aus `geraete_15m`.
- Grafana: Autarkie und Eigenverbrauchsquote je Tag, Kosten je Tag nach Börsenpreis.
- Wirkungsgrad des Akkus messen (kWh ab / kWh auf) und `NL_WIRKUNGSGRAD` setzen.

**Bedienung**
- Node-RED-Dashboard oder Grafana-Panel für Abfahrtszeit und „jetzt voll laden“.
- Meldungen über Telegram oder Signal statt ntfy.

## Danach

- Was angepasst wurde, in den Generator übernehmen (`nodered/funktionen/`, `nodered/build.py`), Tests ergänzen,
  Pull Request.
- Erkenntnisse zu den Geräten in [Geräte-Adapter](geraete-adapter.md) eintragen (Register, Eigenheiten), damit der
  nächste Hackathon schneller ist.
- Vor der Übergabe des Pi: [Betrieb → Übergabe](betrieb.md#übergabe-des-pi-an-freunde).
