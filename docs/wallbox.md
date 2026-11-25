# Wallbox: Ladeplanung und PV-Laden

Tab „🚗 Auto“, Gruppe „Ladeplanung“ (`wallbox_plan.js`), jede Minute. Einziger Schreiber an die Wallbox.
Übernommen aus Haus-EMS; dort brachte die Planung gegenüber „sofort laden“ rund 90 € im Jahr, PV-Laden weitere
≈ 130 € (9,3 MWh im Jahr).

## Regel

| Ladestand | Wallbox |
|---|---|
| bis `WB_SOFORT_SOC` (25 %) | **frei**, sofort laden, auch in teuren Stunden |
| bis `WB_PFLICHT_SOC` (50 %) | **Pflicht** zur Abfahrt: in den billigsten Stunden bis zur Abfahrt; reicht die Zeit nicht, sofort |
| bis `WB_ZIEL_SOC` (80 %) | **Normalziel:** nur in Stunden, die nicht zu den teuersten `WB_TEUER_ANTEIL` (50 %) gehören, davon die billigsten. Reichen sie nicht, fährt das Auto mit weniger |
| ab `WB_ZIEL_SOC` | **frei:** das Ladeziel im Auto entscheidet |

- **Abfahrt:** `WB_ABFAHRT` (06:00, volle Stunde) an `WB_ABFAHRT_TAGE` (1–5 = Mo–Fr).
- **Stunden je Stufe** = Prozentpunkte × `WB_AKKU_KWH` / `WB_WIRKUNGSGRAD` / (`WB_MAX_A` × 230 V × `WB_PHASEN`),
  aufgerundet. Beispiel 60 kWh, 16 A, 3 Phasen (11 kW): 40 → 50 % = 1 h, 40 → 80 % = 3 h.
- **Ladestand unbekannt** (älter als `WB_SOC_MAX_ALTER_MIN`, 90 min) oder `WB_STRATEGIE` = `sperre`: Regel
  „teuerste Stunden“: in den teuersten `WB_TEUER_ANTEIL` der bekannten Stunden Pause, sonst frei.
- **Ohne Preise** (EMS-Plan älter als 20 min): frei. Lieber laden als stehen bleiben.

## PV-Laden

Würde das Auto nach Plan gerade **nicht** laden, ist angesteckt und unter dem Ziel, und bleibt nach dem Hausakku
genug Überschuss (`global.ems_ueberschuss.car_W`, Ø 1 min, schon ohne 300 W Abstand):

- **Start**, wenn der Überschuss 2 min lang ≥ `WB_PV_MIN_KW` (4,2 kW; 6 A × 3 Phasen = 4,1 kW) ist,
  **Ende**, wenn er 2 min lang < `WB_PV_HALT_KW` (3,6 kW) liegt.
- **Strom** in ganzen Ampere, `WB_MIN_A` … `WB_MAX_A`, höchstens alle 2 min geändert (schont Wallbox und Auto; ein
  großer Sprung lässt manche Autos kurz neu verhandeln).
- Während das Auto per PV lädt, zählt die Ausführung seine Leistung zum Überschuss, damit sich die Regel nicht selbst
  abschaltet. Der Hausakku deckt dabei nur das Haus.
- Einphasig ladende Autos: `WB_PHASEN` = 1, dann beginnt PV-Laden schon ab 1,4 kW (`WB_PV_MIN_KW` anpassen).
  Umschalten zwischen 1 und 3 Phasen ist eine Hackathon-Idee.

## Befehle an die Wallbox

`{ modus: 'frei' }`, `{ modus: 'pause' }`, `{ modus: 'strom', ampere }`, bei Änderung und alle 15 min erneut
(nur mit `WB_MODUS` = `aktiv`). Wie die Wallbox das umsetzt, steht im Adapter ([Geräte-Adapter](geraete-adapter.md)).
Erfahrung aus Haus-EMS (Etrel INCH): „Pause“ ließ sich setzen, „fortsetzen“ ging nur über eine neue Ladeleistung.
Jede Wallbox einmal von Hand testen.

## Meldungen

- `🔌 Wallbox: Laden gestartet – Regel: …`, wenn 3 min lang > 1 kW fließen
- `⏸ Wallbox: Laden pausiert – Regel: …`, wenn die Sperre greift, während das Auto steckt
- `✅ Wallbox: Laden beendet – vom Auto / abgesteckt · geladen 12,4 kWh in 2 h 5 min`
- **Zusage in Gefahr** (auch nachts): Auto steckt, unter `WB_PFLICHT_SOC`, Wallbox frei, aber 10 min fließt
  nachweislich kein Strom (z. B. Ladetimer im Auto). Entwarnung, sobald Strom fließt.

`WB_MELDUNGEN` = `aus` schaltet die Lademeldungen ab.

## Ladestand des Autos

Am besten über die Hersteller-Schnittstelle (Adapter „Auto-Ladestand“, `AUTO_QUELLE` = `geraet`). Viele Wallboxen
kennen den Ladestand nicht. Ohne Schnittstelle: `AUTO_QUELLE` = `manuell` und den Ladestand beim Anstecken setzen:

```bash
curl "http://<pi>:1880/radler/auto?soc=45"
```

(z. B. als Kurzbefehl auf dem Handy). Der Wert gilt `WB_SOC_MAX_ALTER_MIN` lang.

## Protokoll `wallbox_plan`

`regel` (sofort, pflicht, ziel, frei, sperre, pv, ohne_preise), `befehl`, `frei`, `grund`, `ampere`, `soc`,
`leistung_W`, `angesteckt`, `bedarf_kWh`, `stunden_noetig`, `bis_abfahrt_h`, `preis_ct`, `bekannte_stunden`,
`pv_moeglich`, `pv_ueberschuss_W`, `gesendet`.
