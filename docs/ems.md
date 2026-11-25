# EMS: Strategie und Ausführung

Tab „⚡ EMS“. Zwei Ebenen wie in Haus-EMS:

| Ebene | Takt | Aufgabe | Code |
|---|---|---|---|
| **Strategie** | 15 min | Netzladen ja/nein (Vorschau), Schwelle der Wasserlinie, Preise für Wallbox und WP | `strategie.js` |
| **Ausführung** | 10 s | Befehl an die PV-Batterie, Überschuss für WP und Auto. **Einziger Schreiber an die Batterie** | `ausfuehrung.js` |

Die Batterie regelt im Modus „eigenverbrauch“ selbst auf 0 W am Netz (so tut es praktisch jeder Hybrid-
Wechselrichter). Das EMS greift nur ein, wenn es etwas Besseres weiß: Netzladen, Auto, Wasserlinie.

## Ziele und Rangfolge

1. **Feste Zusagen:** Auto bis 25 % sofort und 50 % sicher zur Abfahrt, kein Heizlauf wird abgebrochen,
   Akku-Untergrenzen.
2. **Kosten:** im Rahmen der Zusagen kostenoptimal.
3. **Bei kleinem Kostenvorteil schonend und netzdienlich:** weniger Stunden bei 100 %, weniger Zyklen und Starts,
   keine unnötigen Spitzen. „Klein“ legt jede Regel als Schwelle fest (z. B. `NL_AUFSCHLAG_CT`).

## Grundsätze

1. **Ein Gehirn:** Alle Entscheidungen fallen in Node-RED. Am Gerät (App des Wechselrichters) sind keine eigenen
   Lade- und Entladepläne aktiv.
2. **Ein Schreiber:** Nur die Ausführung schreibt an die Batterie.
3. **Akku-Strom wird nicht eingespeist und nicht ins Auto geladen:** Im Haus ist er mehr wert.
4. **Überschuss:** Haus → Batterie → Auto → Netz (die Wärmepumpe hebt ab 1,5 kW Überschuss an).

## Netzladen (Vorschau)

Die Strategie fragt nicht „Ist der Strom jetzt günstig?“, sondern **„Fehlt dem Akku Energie, bevor der Strom wieder
billiger wird?“** (in Haus-EMS seit 9.11.2026, dort in einer Jahressimulation 10 € im Jahr besser als die Schwellenregel).

1. Akkuinhalt über `BATTERIE_MIN_SOC` Stunde für Stunde 24 h fortschreiben: PV-Prognose (Anlage + Balkonkraftwerk) × `NL_PV_FAKTOR` (0,9) minus
   Lastprofil × `NL_LAST_FAKTOR` (1,2), Wirkungsgrad `NL_WIRKUNGSGRAD` (0,85 hin und zurück), höchstens
   `BATTERIE_MAX_W` Entladung.
2. Fehlt dem Haus in einer Stunde Energie und kostet diese Stunde mindestens
   `Preis jetzt / NL_WIRKUNGSGRAD + NL_AUFSCHLAG_CT`, zählt die Fehlmenge (bei 30 ct, 0,85 und 4 ct: 39,3 ct).
3. Schluss, sobald eine Stunde mehr als 0,5 ct billiger ist als jetzt (dort kann man immer noch laden) oder die Sonne
   den Akku füllt. Hinter den bekannten Preisen gilt deren Mittel.
4. Fehlen mindestens `NL_MIN_KWH` (1 kWh) **und** ist so viel Platz frei (bis `NL_SOC_MAX`, 95 %), lädt der Akku mit
   `NL_LEISTUNG_W`. Jeder Lauf rechnet neu; fehlt nichts mehr, endet das Laden von selbst. Ein Befehl gilt 20 min.
5. **Auto lädt** (> 5 kW): Gibt es vor der ersten Fehlstunde genug Stunden, die höchstens 1 ct teurer sind als jetzt,
   wartet der Akku (keine 15-kW-Spitzen aus Auto und Akku in derselben Stunde).
6. Bei PV-Überschuss ≥ 150 W wird nie aus dem Netz geladen.

Begründung im Protokoll (`ems_strategie.nl_grund`), z. B. „Vorschau: es fehlen 3,1 kWh in Stunden ≥ 39,3 ct, fehlt ab
19 Uhr, dann billiger in 6 h (22,0 ct)“, „billiger in 2 h (27,5 ct)“, „Sonne füllt den Akku in 9 h“,
„fehlt, lohnt nicht (höchstens 35,0 < 39,3 ct)“.

**Warum ein Aufschlag:** Er deckt Sicherheitsabstand und Verschleiß. In Haus-EMS brachte Netzladen insgesamt nur
5–17 € im Jahr (kleine Preisspanne im Winter, im Sommer füllt die Sonne den Akku); ohne Aufschlag verlor es Geld.
Bei dynamischen Tarifen mit größerer Spanne lohnt es mehr. Mit Daten des eigenen Hauses nachrechnen (Hackathon-Idee).

`NL_MODUS`: `vorschau` (lädt), `beobachten` (rechnet, `nl_berechnet` im Protokoll, lädt nicht), `aus`.

## Wasserlinie (Spitzenkappung)

Ziel: dieselbe Energie in den Akku, aber aus der Mittagsspitze statt am Vormittag. Der Akku ist abends trotzdem voll,
die Einspeisespitze sinkt, und er steht weniger Stunden bei 100 %. (Haus-EMS, Sommer 2026: Einspeisespitze Ø 6,4 →
5,2 kW, Stunden mit vollen Akkus 1.300 → 790, Mehrkosten ≈ 4 € im Sommer.)

**Strategie:**

1. Erwarteter Überschuss je Stunde, 12 h voraus = PV-Prognose × `WL_PV_FAKTOR` − Lastprofil.
2. **Tageskorrektur:** Liegt der echte Überschuss (Ø 5 min) unter der Erwartung dieser Stunde, wird der Rest im selben
   Verhältnis kleiner angesetzt (bis 0,3).
3. Bedarf = freier Platz bis 100 % / 0,95 × `WL_RESERVE`.
4. **Schwelle T** = höchster Wert, bei dem der Überschuss oberhalb von T (höchstens `BATTERIE_MAX_W` je Stunde) den
   Bedarf noch deckt, auf 50 W abgerundet.
5. **T = 0** (laden wie ohne Wasserlinie): Akku voll, kein Überschuss erwartet, nur noch `WL_LETZTE_H` Stunden mit
   Überschuss, zu wenig Sonne erwartet, keine Prognose, Ladestand unbekannt.

**Ausführung:** Mit `WL_MODUS` = `aktiv` und T > 0 darf der Akku nur `Überschuss − T` laden (`begrenzt`,
`max_laden_W`). Was darüber hinaus geht, steht dem Auto zur Verfügung, dann dem Netz.

**Grenze dieser Fassung:** Haus-EMS kalibriert die Prognose zusätzlich mit der echten PV der letzten 10 Tage (Solcast
glättete die Mittagsspitze). Hier steht dafür `WL_PV_FAKTOR`; die Kalibrierung ist eine Aufgabe für den Hackathon.

## Ausführung (alle 10 s)

Überschuss **S** = Einspeisung + Ladung der Batterie (+ Leistung des Autos, wenn es per PV lädt).

Befehl an die Batterie, in dieser Rangfolge:

| | Bedingung | Befehl |
|---|---|---|
| 1 | `EMS_MODUS` = `aus` | eigenverbrauch |
| 2 | Netz- oder Batteriewert fehlt (> 60 s) | eigenverbrauch, **Fail-Safe** (Fehler im Log) |
| 3 | Netzladen der Strategie (20 min gültig) | `laden`, `NL_LEISTUNG_W` |
| 4 | Auto lädt (> 1 kW), `HA_MODUS` = `aktiv` und (PV-Laden oder Strom teurer als bis zur nächsten Sonne) | `begrenzt`, `max_entladen_W` = Haus ohne Auto − PV − 150 W |
| 5 | Auto lädt (> 1 kW) sonst | `begrenzt`, `max_entladen_W` = 0: **Auto lädt aus dem Netz, nicht aus dem Akku** |
| 6 | Wasserlinie aktiv, T > 0, S ≥ 100 W | `begrenzt`, `max_laden_W` = S − T |
| 7 | sonst | eigenverbrauch |

Gesendet wird bei Änderung (Grenzen ab 100 W Unterschied) und sonst alle 60 s, damit der Timeout am Gerät nicht greift.
Mit `EMS_MODUS` = `beobachten` rechnet die Ausführung und protokolliert, sendet aber nichts.

Außerdem legt sie an:

- `global.ems_live`: Überschuss (Ø 5 min), „frei“ (Einspeisung minus Akku-Entladung), Ladeleistung, SoC → Wärmepumpe.
- `global.ems_ueberschuss.car_W`: was nach dem Anteil der Batterie fürs Auto bleibt, minus 300 W (Ø 1 min) →
  PV-Laden. Anteil der Batterie: bis `BATTERIE_VOLL_SOC` alles bis `BATTERIE_MAX_W` (mit Wasserlinie nur S − T).

Protokoll `ems_ausfuehrung` (alle 30 s und bei Änderung): `modus`, `grund`, `max_laden_W`, `max_entladen_W`,
`leistung_W`, `ueberschuss_W`, `frei_W`, `auto_ueberschuss_W`, `gesendet`.

## Lastprofil

Stündlich: mittlerer Hausverbrauch **ohne Auto** je Uhrzeit (deutsche Zeit) aus `geraete`/`haus.ohne_auto_W` der
letzten 14 Tage. Mittelwert statt Median, weil der Median die Blöcke der Wärmepumpe übersieht (in Haus-EMS über 60
Tage rückgerechnet: Mittelwert 14 Tage war am besten). Mit weniger als 2 Tagen Daten gilt `LAST_STANDARD_W` (500 W).
Ist die InfluxDB nicht erreichbar, bleibt das letzte Profil stehen.

## Protokoll `ems_strategie`

`preis_ct`, `mittel_ct`, `soc`, `nl_laden`, `nl_berechnet`, `nl_bedarf_Wh`, `nl_grund`, `nl_modus`, `wl_T_W`,
`wl_bedarf_Wh`, `wl_erwartet_Wh`, `wl_korrektur`, `wl_grund`, `wl_modus`, `haus_teuer`, `pv12h_Wh`,
`lastprofil_tage`. Ins Log kommt nur, wenn sich die Entscheidung ändert.
