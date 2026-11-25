# Simulator

Tab „🧪 Simulator“ (`simulator.js`), alle 10 s. Bildet jedes Gerät nach, dessen `<GERÄT>_QUELLE` auf `simulator`
steht (Standard). Er folgt den Befehlen des EMS so, wie es ein echtes Gerät tun sollte, und schreibt seine Werte mit
`quelle = simulator` über „→ Messwerte“. So lässt sich das ganze EMS ohne Hardware ausprobieren, und beim
Hackathon kann man Gerät für Gerät auf echt umstellen.

## Modell

| Teil | Annahme |
|---|---|
| PV | PV-Prognose der laufenden Stunde (Open-Meteo, `PV_FLAECHEN`), zwischen den Stunden interpoliert, × Wolkenfaktor (Zufallsweg 0,5–1,05) |
| Haus | Grundlast 250 W ± 50 W über den Tag, morgens 6:30–8:30 +400 W, mittags 11:30–13 +500 W, abends 17–22 +600 W, gelegentlich 1,5–3 kW für 1–5 min |
| Wärmepumpe | Gebäude 20 kWh/K, Verlust 0,15 kW/K; Heizlauf 1,8 kW elektrisch, COP 3,5, Raum 21 °C ± 0,3 K + Anhebung (SG-Ready 3 ohne `anhebung_K`: +1,5 K); Warmwasser 6:30 und 18:30 je 30 min mit 2,2 kW; keine Heizung ab 15 °C außen (aktuelle Außentemperatur aus dem Wetter) |
| Auto | werktags 7:00–17:30 unterwegs, kommt mit 15–25 % weniger zurück; lädt bis 80 % (Ladeziel im Auto); `WB_AKKU_KWH`, 90 % Ladewirkungsgrad |
| Wallbox | `frei`: `WB_MAX_A` × 230 V × `WB_PHASEN`; `strom`: angegebene Ampere; `pause`: 0 |
| Batterie | `BATTERIE_KAPAZITAET_WH`, `BATTERIE_MAX_W`, 95 % je Richtung, entlädt nicht unter `BATTERIE_MIN_SOC`; folgt `eigenverbrauch`, `laden`, `begrenzt`; **ohne neuen Befehl nach 5 min zurück in den Eigenverbrauch** (wie ein Gerät mit Timeout) |
| Netz | Haus + WP + Wallbox − PV − Batterie |

`SIM_ZUFALL=aus` schaltet den Zufall ab (für Tests und Vergleiche).

Der Zustand (SoC, Raumtemperatur, Auto) liegt im Speicher des Knotens und beginnt nach einem Neustart von Node-RED
neu (Batterie 50 %, Raum 21 °C, Auto 45 %).

## Grenzen

- Die PV folgt der Prognose; echte Abweichungen (ganztägig falsche Prognose, Schnee auf den Modulen) gibt es nicht.
  Für Tests der Wasserlinie und der Tageskorrektur reicht der Wolkenfaktor nur bedingt.
- Das Gebäude ist ein einziger Wärmespeicher ohne Estrich-Verzögerung; die WP taktet deshalb gleichmäßiger als echt.
- Die Batterie regelt sofort; echte Geräte brauchen einige Sekunden und haben eine Totzone.

Ideen zum Ausbauen stehen in [Hackathon](hackathon.md).
