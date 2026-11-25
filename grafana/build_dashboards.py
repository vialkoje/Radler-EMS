#!/usr/bin/env python3
"""Baut die Grafana-Dashboards nach grafana/dashboards/*.json.

Aufruf: python3 grafana/build_dashboards.py
Einspielen: python3 tools/grafana_einspielen.py (auf dem Pi)

Alle Abfragen in Flux gegen die Datenquelle „Radler-EMS“ (uid radler-influx, nur-lesender Token).
"""
import json
from pathlib import Path

ZIEL = Path(__file__).resolve().parent / "dashboards"
DS = {"type": "influxdb", "uid": "radler-influx"}
_id = [0]


def q_reihen(bucket, messreihe, felder, fn="mean", every="v.windowPeriod"):
    """Mehrere Felder einer Messreihe als Zeitreihen mit sprechenden Namen."""
    namen = " or ".join(f'r._field == "{f}"' for f in felder)
    keep = ", ".join(f'"{f}"' for f in felder)
    rename = ", ".join(f'{f}: "{n}"' for f, n in felder.items())
    return (f'from(bucket: "{bucket}")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n'
            f'  |> filter(fn: (r) => r._measurement == "{messreihe}" and ({namen}))\n'
            f'  |> aggregateWindow(every: {every}, fn: {fn}, createEmpty: false)\n'
            '  |> group()\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n'
            f'  |> keep(columns: ["_time", {keep}])\n  |> rename(columns: {{{rename}}})')


def q_reihe(bucket, messreihe, feld, name, fn="mean", every="v.windowPeriod"):
    return q_reihen(bucket, messreihe, {feld: name}, fn, every)


def q_letzter(bucket, messreihe, feld, name, start="-15m"):
    return (f'from(bucket: "{bucket}")\n  |> range(start: {start})\n'
            f'  |> filter(fn: (r) => r._measurement == "{messreihe}" and r._field == "{feld}")\n'
            '  |> group()\n  |> last()\n  |> keep(columns: ["_time", "_value"])\n'
            f'  |> rename(columns: {{_value: "{name}"}})')


def q_text(bucket, messreihe, feld, name):
    """Textfeld als Zustandsverlauf (State timeline)."""
    return (f'from(bucket: "{bucket}")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n'
            f'  |> filter(fn: (r) => r._measurement == "{messreihe}" and r._field == "{feld}")\n'
            '  |> group()\n  |> keep(columns: ["_time", "_value"])\n'
            f'  |> rename(columns: {{_value: "{name}"}})')


def q_energie(teile):
    """kWh im gewählten Zeitraum: [(Name, Messreihe, Feld, Vorzeichen)] mit Vorzeichen +1 (nur > 0) / -1 (nur < 0) / 0."""
    zeilen = []
    for i, (name, m, f, vz) in enumerate(teile):
        abb = {1: "if r._value > 0.0 then r._value else 0.0", -1: "if r._value < 0.0 then -r._value else 0.0",
               0: "r._value"}[vz]
        zeilen.append(
            f't{i} = from(bucket: "geraete")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n'
            f'  |> filter(fn: (r) => r._measurement == "{m}" and r._field == "{f}")\n'
            '  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)\n'
            f'  |> map(fn: (r) => ({{r with _value: {abb}}}))\n'
            '  |> group()\n  |> sort(columns: ["_time"])\n  |> integral(unit: 1h)\n'
            '  |> map(fn: (r) => ({r with _value: r._value / 1000.0}))\n'
            f'  |> set(key: "_field", value: "{name}")\n  |> set(key: "x", value: "1")\n'
            '  |> keep(columns: ["x", "_field", "_value"])')
    namen = ", ".join(f"t{i}" for i in range(len(teile)))
    return "\n".join(zeilen) + (f"\nunion(tables: [{namen}])\n"
                                '  |> pivot(rowKey: ["x"], columnKey: ["_field"], valueColumn: "_value")\n  |> drop(columns: ["x"])')


def schwellen(*stufen):
    return {"mode": "absolute", "steps": [{"color": c, "value": v} for v, c in stufen]}


def panel(art, titel, x, y, w, h, abfragen, einheit=None, nachkomma=None, defaults=None, optionen=None,
          custom=None, overrides=None, beschreibung=""):
    _id[0] += 1
    d = {"color": {"mode": "palette-classic" if art in ("timeseries", "barchart") else "thresholds"}}
    if einheit:
        d["unit"] = einheit
    if nachkomma is not None:
        d["decimals"] = nachkomma
    if custom:
        d["custom"] = custom
    d.update(defaults or {})
    if isinstance(abfragen, str):
        abfragen = [abfragen]
    return {"id": _id[0], "type": art, "title": titel, "description": beschreibung, "datasource": DS,
            "gridPos": {"x": x, "y": y, "w": w, "h": h},
            "targets": [{"refId": chr(65 + i), "datasource": DS, "query": q} for i, q in enumerate(abfragen)],
            "fieldConfig": {"defaults": d, "overrides": overrides or []}, "options": optionen or {}}


STAT = {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "colorMode": "value",
        "graphMode": "area", "textMode": "value_and_name", "justifyMode": "center", "orientation": "auto"}
STAT_EINZEL = dict(STAT, textMode="value", graphMode="none")
TS = {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
      "tooltip": {"mode": "multi", "sort": "none"}}
LINIE = {"drawStyle": "line", "lineWidth": 2, "fillOpacity": 10, "showPoints": "never", "spanNulls": 120000,
         "lineInterpolation": "linear"}
STUFE = dict(LINIE, lineInterpolation="stepAfter", fillOpacity=0)


def farbe(name, c, **extra):
    props = [{"id": "color", "value": {"mode": "fixed", "fixedColor": c}}]
    props += [{"id": k, "value": v} for k, v in extra.items()]
    return {"matcher": {"id": "byName", "options": name}, "properties": props}


def dashboard(uid, titel, beschreibung, panels, zeit="now-24h", refresh="1m", tags=("radler-ems",)):
    return {"uid": uid, "title": titel, "description": beschreibung, "tags": list(tags), "timezone": "browser",
            "refresh": refresh, "time": {"from": zeit, "to": "now"}, "schemaVersion": 39, "editable": True,
            "graphTooltip": 1, "panels": panels}


# ═══════════════ Energie ═══════════════
def energie():
    _id[0] = 0
    p = []
    stat = [("PV", "pv", "leistung_W", "W", schwellen((None, "text"), (100, "yellow"))),
            ("Haus", "haus", "verbrauch_W", "W", schwellen((None, "text"))),
            ("Netz (+ Bezug)", "netz", "bezug_W", "W", schwellen((None, "green"), (50, "red"))),
            ("Batterie (+ Entladen)", "batterie", "leistung_W", "W", schwellen((None, "blue"), (0, "text"), (50, "orange"))),
            ("Wallbox", "wallbox", "leistung_W", "W", schwellen((None, "text"), (1000, "purple"))),
            ("Wärmepumpe", "wp", "leistung_W", "W", schwellen((None, "text"), (500, "orange")))]
    for i, (name, m, f, unit, th) in enumerate(stat):
        p.append(panel("stat", name, i * 3, 0, 3, 4, q_letzter("geraete", m, f, name), unit, 0,
                       {"thresholds": th}, STAT_EINZEL))
    p.append(panel("gauge", "Batterie", 18, 0, 3, 4, q_letzter("geraete", "batterie", "soc_pct", "Batterie"), "percent", 0,
                   {"min": 0, "max": 100, "thresholds": schwellen((None, "red"), (20, "orange"), (40, "green"))},
                   {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "showThresholdMarkers": False}))
    p.append(panel("stat", "Strompreis jetzt", 21, 0, 3, 4, q_letzter("markt", "strompreis", "preis_ct", "Preis", "-15m"),
                   "none", 1, {"thresholds": schwellen((None, "green"), (30, "orange"), (40, "red"))},
                   STAT_EINZEL, beschreibung="ct/kWh inkl. ABGABEN_CT, laufende Viertelstunde"))
    p[-1]["targets"][0]["query"] = (
        'from(bucket: "markt")\n  |> range(start: -1h, stop: 15m)\n'
        '  |> filter(fn: (r) => r._measurement == "strompreis" and r._field == "preis_ct")\n'
        '  |> filter(fn: (r) => r._time <= now())\n  |> group()\n  |> last()\n'
        '  |> keep(columns: ["_time", "_value"])\n  |> rename(columns: {_value: "ct/kWh"})')

    leist = {"pv": ("PV", "yellow"), "haus": ("Haus", "text"), "netz": ("Netz", "red"), "batterie": ("Batterie", "blue"),
             "wallbox": ("Wallbox", "purple"), "wp": ("Wärmepumpe", "orange")}
    abfragen = [q_reihe("geraete", "pv", "leistung_W", "PV"), q_reihe("geraete", "haus", "verbrauch_W", "Haus"),
                q_reihe("geraete", "netz", "bezug_W", "Netz"), q_reihe("geraete", "batterie", "leistung_W", "Batterie"),
                q_reihe("geraete", "wallbox", "leistung_W", "Wallbox"), q_reihe("geraete", "wp", "leistung_W", "Wärmepumpe")]
    p.append(panel("timeseries", "Leistungen (Netz + Bezug / − Einspeisung, Batterie + Entladen / − Laden)", 0, 4, 24, 10,
                   abfragen, "watt", 0, custom=LINIE, optionen=TS,
                   overrides=[farbe(n, c) for n, c in leist.values()] + [farbe("PV", "yellow", **{"custom.fillOpacity": 25})]))
    p.append(panel("timeseries", "Ladestände", 0, 14, 12, 8,
                   [q_reihe("geraete", "batterie", "soc_pct", "Batterie"), q_reihe("geraete", "auto", "soc_pct", "Auto")],
                   "percent", 0, {"min": 0, "max": 100}, TS, LINIE,
                   [farbe("Batterie", "blue"), farbe("Auto", "purple")]))
    p.append(panel("timeseries", "PV: Prognose und Ist", 12, 14, 12, 8,
                   [q_reihe("markt", "pv_prognose", "leistung_W", "Prognose", every="1h"),
                    q_reihe("geraete", "pv", "leistung_W", "Ist")],
                   "watt", 0, custom=LINIE, optionen=TS,
                   overrides=[farbe("Prognose", "yellow", **{"custom.lineStyle": {"fill": "dash", "dash": [10, 10]},
                                                             "custom.fillOpacity": 0}), farbe("Ist", "orange")]))
    p.append(panel("timeseries", "Strompreis (Endpreis, Viertelstunden)", 0, 22, 12, 8,
                   q_reihe("markt", "strompreis", "preis_ct", "Preis", fn="last", every="15m"),
                   "none", 1, custom=STUFE, optionen=TS, overrides=[farbe("Preis", "green")],
                   beschreibung="ct/kWh: Börse DE-LU (Energy-Charts) + ABGABEN_CT"))
    p.append(panel("stat", "Energie im Zeitraum (kWh)", 12, 22, 12, 8,
                   q_energie([("PV", "pv", "leistung_W", 0), ("Haus", "haus", "verbrauch_W", 0),
                              ("Bezug", "netz", "bezug_W", 1), ("Einspeisung", "netz", "bezug_W", -1),
                              ("Auto", "wallbox", "leistung_W", 0), ("Wärmepumpe", "wp", "leistung_W", 0)]),
                   "kwatth", 1, {"thresholds": schwellen((None, "text"))},
                   dict(STAT, graphMode="none"), beschreibung="Summe über den oben gewählten Zeitraum"))
    return dashboard("radler-energie", "Radler-EMS: Energie",
                     "Leistungen, Ladestände, Prognose und Preise. Quelle simulator oder geraet (Tag quelle).", p)


# ═══════════════ Entscheidungen ═══════════════
def entscheidungen():
    _id[0] = 0
    p = []
    p.append(panel("state-timeline", "Was das EMS gerade tut", 0, 0, 24, 7,
                   [q_text("ems", "ems_ausfuehrung", "grund", "Batterie"),
                    q_text("ems", "wallbox_plan", "grund", "Wallbox"),
                    q_text("ems", "wp_steuerung", "grund", "Wärmepumpe")],
                   optionen={"showValue": "auto", "mergeValues": True, "rowHeight": 0.8, "alignValue": "left",
                             "legend": {"showLegend": False}},
                   defaults={"color": {"mode": "palette-classic-by-name"}}))
    p.append(panel("timeseries", "Strategie: Preis und Netzladen", 0, 7, 12, 8,
                   [q_reihen("ems", "ems_strategie", {"preis_ct": "Preis jetzt", "mittel_ct": "Mittel 24 h"}),
                    q_reihen("ems", "ems_strategie", {"nl_laden": "Netzladen", "nl_berechnet": "Netzladen berechnet"})],
                   "none", 1, custom=STUFE, optionen=TS,
                   overrides=[farbe("Netzladen", "blue", **{"custom.axisPlacement": "right", "custom.fillOpacity": 30, "unit": "bool_on_off"}),
                              farbe("Netzladen berechnet", "light-blue", **{"custom.axisPlacement": "right", "unit": "bool_on_off"})]))
    p.append(panel("timeseries", "Strategie: Wasserlinie", 12, 7, 12, 8,
                   [q_reihen("ems", "ems_strategie", {"wl_T_W": "Schwelle T"}),
                    q_reihen("ems", "ems_strategie", {"wl_bedarf_Wh": "Akku braucht", "wl_erwartet_Wh": "Überschuss erwartet"})],
                   "watt", 0, custom=STUFE, optionen=TS,
                   overrides=[farbe("Akku braucht", "blue", **{"unit": "watth", "custom.axisPlacement": "right"}),
                              farbe("Überschuss erwartet", "yellow", **{"unit": "watth", "custom.axisPlacement": "right"})]))
    p.append(panel("timeseries", "Ausführung: Überschuss und Grenzen der Batterie", 0, 15, 12, 8,
                   q_reihen("ems", "ems_ausfuehrung", {"ueberschuss_W": "Überschuss", "auto_ueberschuss_W": "fürs Auto",
                                                        "max_laden_W": "max. Laden", "max_entladen_W": "max. Entladen",
                                                        "leistung_W": "Netzladen"}),
                   "watt", 0, custom=STUFE, optionen=TS))
    p.append(panel("timeseries", "Wallbox: Planung", 12, 15, 12, 8,
                   [q_reihen("ems", "wallbox_plan", {"soc": "Auto"}),
                    q_reihen("ems", "wallbox_plan", {"ampere": "Ampere (PV)", "frei": "frei"})],
                   "percent", 0, {"min": 0}, TS, STUFE,
                   [farbe("Ampere (PV)", "yellow", **{"unit": "amp", "custom.axisPlacement": "right"}),
                    farbe("frei", "green", **{"unit": "bool_on_off", "custom.axisPlacement": "right", "custom.fillOpacity": 20})]))
    p.append(panel("timeseries", "Wärmepumpe: Anhebung und Überschuss", 0, 23, 12, 8,
                   [q_reihen("ems", "wp_steuerung", {"anhebung_K": "Anhebung"}),
                    q_reihen("ems", "wp_steuerung", {"ueberschuss_W": "Überschuss"}),
                    q_reihe("geraete", "wp", "raum_C", "Raum")],
                   "kelvin", 1, custom=STUFE, optionen=TS,
                   overrides=[farbe("Überschuss", "yellow", **{"unit": "watt", "custom.axisPlacement": "right"}),
                              farbe("Raum", "orange", **{"unit": "celsius"})]))
    log_q = ('from(bucket: "ems")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n'
             '  |> filter(fn: (r) => r._measurement == "ems_log")\n  |> group()\n'
             '  |> keep(columns: ["_time", "stufe", "bereich", "_value"])\n'
             '  |> rename(columns: {_value: "Text", _time: "Zeit", stufe: "Stufe", bereich: "Bereich"})\n'
             '  |> sort(columns: ["Zeit"], desc: true)\n  |> limit(n: 200)')
    p.append(panel("table", "Fehler und Warnungen (Log)", 12, 23, 12, 8, log_q,
                   optionen={"showHeader": True, "cellHeight": "sm"},
                   overrides=[{"matcher": {"id": "byName", "options": "Zeit"}, "properties": [{"id": "custom.width", "value": 160}]},
                              {"matcher": {"id": "byName", "options": "Stufe"}, "properties": [{"id": "custom.width", "value": 80}]},
                              {"matcher": {"id": "byName", "options": "Bereich"}, "properties": [{"id": "custom.width", "value": 90}]}]))
    grund_q = ('from(bucket: "ems")\n  |> range(start: -1h)\n'
               '  |> filter(fn: (r) => r._measurement == "ems_strategie" and (r._field == "nl_grund" or r._field == "wl_grund"))\n'
               '  |> last()\n  |> group()\n  |> keep(columns: ["_field", "_value"])\n'
               '  |> map(fn: (r) => ({Regel: if r._field == "nl_grund" then "Netzladen" else "Wasserlinie", Begründung: r._value}))')
    p.append(panel("table", "Letzte Begründung der Strategie", 0, 31, 24, 4, grund_q, optionen={"showHeader": False}))
    return dashboard("radler-entscheidungen", "Radler-EMS: Entscheidungen",
                     "Was Strategie, Ausführung, Ladeplanung und Wärmepumpen-Steuerung entschieden haben und warum.", p)


# ═══════════════ Wetter ═══════════════
def wetter():
    _id[0] = 0
    WMO = {0: "Klar", 1: "Überwiegend klar", 2: "Teilweise bewölkt", 3: "Bedeckt", 45: "Nebel", 48: "Reifnebel",
           51: "Leichter Niesel", 53: "Niesel", 55: "Starker Niesel", 56: "Gefrierender Niesel", 57: "Gefrierender Niesel",
           61: "Leichter Regen", 63: "Regen", 65: "Starker Regen", 66: "Gefrierender Regen", 67: "Gefrierender Regen",
           71: "Leichter Schneefall", 73: "Schneefall", 75: "Starker Schneefall", 77: "Schneegriesel",
           80: "Leichte Regenschauer", 81: "Regenschauer", 82: "Heftige Regenschauer", 85: "Schneeschauer",
           86: "Starke Schneeschauer", 95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit Hagel"}
    wmo_map = [{"type": "value", "options": {str(k): {"text": v, "index": i} for i, (k, v) in enumerate(WMO.items())}}]
    richt = ["N", "NO", "O", "SO", "S", "SW", "W", "NW", "N"]
    dir_map = [{"type": "range", "options": {"from": i * 45 - 22.5, "to": i * 45 + 22.5, "result": {"text": richt[i], "index": i}}}
               for i in range(9)]
    temp_th = schwellen((None, "purple"), (-10, "blue"), (0, "light-blue"), (10, "green"), (20, "orange"), (30, "red"))
    p = []
    for i, (titel, f, unit, extra) in enumerate([
            ("Temperatur", "temperatur", "celsius", {"thresholds": temp_th}),
            ("Gefühlt", "gefuehlt", "celsius", {"thresholds": temp_th}),
            ("Wetterlage", "wettercode", None, {"mappings": wmo_map, "thresholds": schwellen((None, "text"))}),
            ("Luftfeuchte", "luftfeuchte", "percent", {"thresholds": schwellen((None, "orange"), (30, "green"), (80, "blue"))}),
            ("Luftdruck (NN)", "luftdruck", "pressurehpa", {"thresholds": schwellen((None, "text"))}),
            ("Windrichtung", "windrichtung", None, {"mappings": dir_map, "thresholds": schwellen((None, "text"))})]):
        p.append(panel("stat", titel, i * 4, 0, 4, 5, q_letzter("markt", "wetter", f, titel, "-1h"), unit,
                       1 if unit in ("celsius", "pressurehpa") else 0, extra, STAT_EINZEL))
    p.append(panel("timeseries", "Temperatur", 0, 5, 24, 9,
                   q_reihen("markt", "wetter", {"temperatur": "Temperatur", "gefuehlt": "Gefühlt", "taupunkt": "Taupunkt"}),
                   "celsius", 1, custom=dict(LINIE, spanNulls=3600000, lineInterpolation="smooth"), optionen=TS,
                   overrides=[farbe("Temperatur", "orange", **{"custom.lineWidth": 3}),
                              farbe("Gefühlt", "purple", **{"custom.fillOpacity": 0}), farbe("Taupunkt", "blue", **{"custom.fillOpacity": 0})]))
    p.append(panel("timeseries", "Luftfeuchte & Bewölkung", 0, 14, 12, 8,
                   q_reihen("markt", "wetter", {"luftfeuchte": "Luftfeuchte", "bewoelkung": "Bewölkung"}),
                   "percent", 0, {"min": 0, "max": 100}, TS, dict(LINIE, spanNulls=3600000)))
    p.append(panel("timeseries", "Luftdruck (auf Meereshöhe)", 12, 14, 12, 8, q_reihe("markt", "wetter", "luftdruck", "Luftdruck"),
                   "pressurehpa", 1, custom=dict(LINIE, spanNulls=3600000), optionen=TS))
    p.append(panel("timeseries", "Wind & Böen", 0, 22, 12, 8, q_reihen("markt", "wetter", {"wind": "Wind", "boeen": "Böen"}),
                   "velocitykmh", 1, {"min": 0}, TS, dict(LINIE, spanNulls=3600000)))
    p.append(panel("timeseries", "Niederschlag pro Stunde", 12, 22, 12, 8,
                   q_reihen("markt", "wetter", {"regen": "Regen", "schnee": "Schnee (cm)"}, fn="max", every="1h"),
                   "lengthmm", 1, {"min": 0}, TS, {"drawStyle": "bars", "fillOpacity": 70, "lineWidth": 1, "showPoints": "never"},
                   [farbe("Regen", "blue"), farbe("Schnee (cm)", "light-blue", unit="lengthcm")]))
    return dashboard("radler-wetter", "Radler-EMS: Wetter", "Wetter am Standort (Open-Meteo), Bucket markt.",
                     p, zeit="now-48h", refresh="5m", tags=("radler-ems", "wetter"))


def main():
    ZIEL.mkdir(exist_ok=True)
    for name, d in [("energie", energie()), ("entscheidungen", entscheidungen()), ("wetter", wetter())]:
        (ZIEL / f"{name}.json").write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"grafana/dashboards/{name}.json: {len(d['panels'])} Panels")


if __name__ == "__main__":
    main()
