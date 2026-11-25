#!/usr/bin/env python3
"""Baut nodered/flows.json aus den Funktionsdateien in nodered/funktionen/.

Aufruf:  python3 nodered/build.py            (schreibt nodered/flows.json)
         python3 nodered/build.py --pruefen  (meldet nur, ob flows.json aktuell ist)

Regeln (wie in Haus-EMS, docs/architektur.md):
- Tabs nach Fachbereich, Teilabläufe als beschriftete Gruppen, oben in jeder Gruppe ein Kommentar.
- Verbindungen zwischen Tabs nur über Link-Knoten.
- Keine Zugangsdaten in flows.json: der InfluxDB-Token kommt beim Einspielen dazu (tools/flows_einspielen.py).
- Funktionscode nur in nodered/funktionen/*.js ändern, nie in flows.json.
"""
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
FUNKTIONEN = HIER / "funktionen"
ZIEL = HIER / "flows.json"
INFLUX_ORG = "home"
SPALTE, ZEILE = 230, 60


def code(datei, geraet=None):
    text = (FUNKTIONEN / datei).read_text(encoding="utf-8")
    return (f"const GERAET = '{geraet}';\n" if geraet else "") + text


class Flows:
    def __init__(self):
        self.tabs = []           # [(tab_node, [gruppen])]
        self.nodes = []
        self.link_in = {}        # name -> link-in-Knoten
        self.config = []

    def tab(self, tid, label, info):
        t = Tab(self, {"id": tid, "type": "tab", "label": label, "disabled": False, "info": info})
        self.tabs.append(t)
        return t

    def json(self):
        alle = []
        for t in self.tabs:
            alle.append(t.knoten)
            alle.extend(t.layout())
        alle.extend(self.config)
        return alle


class Tab:
    def __init__(self, flows, knoten):
        self.flows, self.knoten, self.gruppen = flows, knoten, []

    def gruppe(self, gid, name, kommentar, info=""):
        g = Gruppe(self, gid, name, kommentar, info)
        self.gruppen.append(g)
        return g

    def layout(self):
        """Gruppen untereinander, Knoten im Raster (Spalte, Zeile) innerhalb der Gruppe."""
        out, y0 = [], 40
        for g in self.gruppen:
            zeilen = max([n["_z"] for n in g.knoten] + [0])
            spalten = max([n["_s"] for n in g.knoten] + [0])
            for n in g.knoten:
                n["x"] = 120 + n.pop("_s") * SPALTE
                n["y"] = y0 + 40 + n.pop("_z") * ZEILE
                n["z"] = self.knoten["id"]
                n["g"] = g.gid
            breite = max(spalten * SPALTE + 260, 620)
            out.append({"id": g.gid, "type": "group", "z": self.knoten["id"], "name": g.name, "info": g.info,
                        "style": {"label": True, "stroke": "#7d8b86", "fill": "#f4f6f5", "fill-opacity": "0.6"},
                        "nodes": [n["id"] for n in g.knoten],
                        "x": 14, "y": y0, "w": breite, "h": (zeilen + 1) * ZEILE + 50})
            out.extend(g.knoten)
            y0 += (zeilen + 1) * ZEILE + 90
        return out


class Gruppe:
    def __init__(self, tab, gid, name, kommentar, info):
        self.tab, self.gid, self.name, self.info, self.knoten = tab, gid, name, info, []
        self.knoten_hinzu({"id": gid + "-kom", "type": "comment", "name": kommentar, "info": info, "wires": []}, 0, 0)

    def knoten_hinzu(self, n, s, z):
        n["_s"], n["_z"] = s, z
        n.setdefault("wires", [])
        self.knoten.append(n)
        return n

    # ── Knotenarten ──
    def inject(self, nid, name, s, z, nach, wiederholen="", einmal=True, verzoegerung="5", topic="", cron=""):
        return self.knoten_hinzu({"id": nid, "type": "inject", "name": name,
                                  "props": [{"p": "topic", "vt": "str"}], "repeat": str(wiederholen), "crontab": cron,
                                  "once": einmal, "onceDelay": str(verzoegerung), "topic": topic,
                                  "wires": [[x for x in nach]]}, s, z)

    def funktion(self, nid, name, s, z, func, ausgaenge=1, nach=None):
        return self.knoten_hinzu({"id": nid, "type": "function", "name": name, "func": func, "outputs": ausgaenge,
                                  "timeout": 0, "noerr": 0, "initialize": "", "finalize": "", "libs": [],
                                  "wires": nach or [[] for _ in range(ausgaenge)]}, s, z)

    def http(self, nid, name, s, z, nach, methode="GET"):
        return self.knoten_hinzu({"id": nid, "type": "http request", "name": name, "method": methode, "ret": "obj",
                                  "paytoqs": "ignore", "url": "", "tls": "", "persist": False, "proxy": "",
                                  "insecureHTTPParser": False, "authType": "", "senderr": False, "headers": [],
                                  "wires": [nach]}, s, z)

    def link_in(self, nid, name, s, z, nach):
        n = self.knoten_hinzu({"id": nid, "type": "link in", "name": name, "links": [], "wires": [nach]}, s, z)
        self.tab.flows.link_in[name] = n
        return n

    def link_out(self, nid, ziel_name, s, z):
        return self.knoten_hinzu({"id": nid, "type": "link out", "name": ziel_name, "mode": "link",
                                  "links": [ziel_name]}, s, z)   # Name wird in bauen() durch die ID ersetzt

    def influx_batch(self, nid, name, s, z, bucket):
        return self.knoten_hinzu({"id": nid, "type": "influxdb batch", "influxdb": "influx-radler", "precision": "",
                                  "retentionPolicy": "", "name": name, "database": "database",
                                  "precisionV18FluxV20": "ms", "retentionPolicyV18Flux": "", "org": INFLUX_ORG,
                                  "bucket": bucket}, s, z)

    def influx_lesen(self, nid, name, s, z, nach):
        return self.knoten_hinzu({"id": nid, "type": "influxdb in", "influxdb": "influx-radler", "name": name,
                                  "query": "", "rawOutput": False, "precision": "", "retentionPolicy": "",
                                  "org": INFLUX_ORG, "wires": [nach]}, s, z)


def bauen():
    f = Flows()
    f.config.append({"id": "influx-radler", "type": "influxdb", "hostname": "127.0.0.1", "port": "8086",
                     "protocol": "http", "database": "database", "name": "InfluxDB Radler-EMS", "usetls": False,
                     "tls": "", "influxdbVersion": "2.0", "url": "http://localhost:8086", "timeout": "10",
                     "rejectUnauthorized": True})

    # ═════════════ ⚙️ System ═════════════
    t = f.tab("tab-system", "⚙️ System",
              "Start, Prozessabbild, InfluxDB-Schreiber, Log, Meldungen, Geräte-Wächter, Tagesbericht.\n\n"
              "Alle anderen Tabs schicken Messwerte an „→ Messwerte“, Protokolle an „→ Influx …“ und Ereignisse an „→ Log“.")
    g = t.gruppe("grp-start", "Start", "Nach jedem Neustart: Startzeit merken, Einstellungen prüfen, Neustart ins Log")
    g.inject("sys-start-inj", "Start", 0, 1, ["sys-start"], einmal=True, verzoegerung="2")
    g.funktion("sys-start", "Start prüfen", 1, 1, code("start.js"), 1, [["sys-start-log"]])
    g.link_out("sys-start-log", "→ Log", 2, 1)

    g = t.gruppe("grp-abbild", "Messwerte → Prozessabbild",
                 "Einzige Stelle für Messwerte: global.abbild und InfluxDB „geraete“ (Bilanz: Messreihe „haus“)")
    g.link_in("sys-mw-in", "→ Messwerte", 0, 1, ["sys-mw"])
    g.funktion("sys-mw", "Prozessabbild + Bilanz", 1, 1, code("messwerte.js"), 1, [["sys-mw-db"]])
    g.link_out("sys-mw-db", "→ Influx geraete", 2, 1)

    g = t.gruppe("grp-influx", "InfluxDB schreiben", "Je Bucket ein Schreiber: geraete (Messwerte), ems (Entscheidungen, Log), markt (Preise, Prognose, Wetter)")
    for i, b in enumerate(["geraete", "ems", "markt"]):
        g.link_in(f"sys-db-{b}-in", f"→ Influx {b}", 0, 1 + i, [f"sys-db-{b}"])
        g.influx_batch(f"sys-db-{b}", f"InfluxDB {b}", 1, 1 + i, b)

    g = t.gruppe("grp-log", "Logeintrag erzeugen",
                 "Ein Log: Datei je Tag (LOG_VERZEICHNIS), Fehler/Warnungen nach InfluxDB „ems_log“, Einträge mit melden → Meldung",
                 "Warnungen und Fehler aller Knoten kommen über den Logger in settings.js dazu (deploy/settings-radler.js).")
    g.link_in("log-in", "→ Log", 0, 1, ["log-fn"])
    g.funktion("log-fn", "Logeintrag", 1, 1, code("log.js"), 3, [["log-datei"], ["log-db"], ["log-meldung"]])
    g.knoten_hinzu({"id": "log-datei", "type": "file", "name": "Logdatei", "filename": "filename",
                    "filenameType": "msg", "appendNewline": True, "createDir": True, "overwriteFile": "false",
                    "encoding": "utf8"}, 2, 1)
    g.link_out("log-db", "→ Influx ems", 2, 2)
    g.funktion("log-meldung", "Meldung prüfen", 2, 3, code("meldung.js"), 2, [["log-ntfy"], ["log-fn"]])
    g.http("log-ntfy", "ntfy senden", 3, 3, [], methode="POST")
    g.inject("log-puffer-inj", "alle 5 s", 0, 4, ["log-puffer"], wiederholen=5, verzoegerung="5")
    g.funktion("log-puffer", "Warnungen und Fehler (Node-RED-Log)", 1, 4, code("log_puffer.js"), 1, [["log-fn"]])
    g.inject("log-aufr-inj", "täglich 3:00", 0, 5, ["log-aufr"], einmal=False, cron="00 03 * * *")
    g.knoten_hinzu({"id": "log-aufr", "type": "exec", "name": "Logdateien > 30 Tage löschen",
                    "command": "find ${LOG_VERZEICHNIS:-/home/pi/radler-ems/log} -name 'radler-ems-*.log' -mtime +30 -delete",
                    "addpay": "", "append": "", "useSpawn": "false", "timer": "", "winHide": False, "oldrc": False,
                    "wires": [[], [], []]}, 1, 5)

    g = t.gruppe("grp-waechter", "Geräte-Wächter", "Jede Minute: liefert ein Gerät seit GERAET_OFFLINE_MIN keine Werte → Fehler mit Meldung, bei Rückkehr Entwarnung")
    g.inject("sys-w-inj", "jede Minute", 0, 1, ["sys-w"], wiederholen=60, verzoegerung="60")
    g.funktion("sys-w", "Geräte prüfen", 1, 1, code("waechter.js"), 1, [["sys-w-log"]])
    g.link_out("sys-w-log", "→ Log", 2, 1)

    g = t.gruppe("grp-bericht", "Tagesbericht", "Um 7 Uhr für den Vortag: Stromkosten, Bezug, Einspeisung, PV, Auto, Netzladen; dazu nachts zurückgehaltene Meldungen")
    g.inject("sys-tb-inj", "7:00", 0, 1, ["sys-tb"], einmal=False, cron="00 07 * * *")
    g.inject("sys-tb-hand", "Von Hand: jetzt", 0, 2, ["sys-tb"], einmal=False)
    g.funktion("sys-tb", "Tagesbericht", 1, 1, code("tagesbericht.js"), 2, [["sys-tb-db"], ["sys-tb-log"]])
    g.influx_lesen("sys-tb-db", "InfluxDB lesen", 2, 1, ["sys-tb"])
    g.link_out("sys-tb-log", "→ Log", 2, 2)

    # ═════════════ ⚡ EMS ═════════════
    t = f.tab("tab-ems", "⚡ EMS",
              "Strategie (15 min): Netzladen nach Vorschau, Wasserlinie, Plan für Wallbox und Wärmepumpe.\n"
              "Ausführung (10 s): einziger Schreiber an die PV-Batterie.\n\nSiehe docs/ems.md.")
    g = t.gruppe("grp-lastprofil", "Lastprofil", "Stündlich: Hausverbrauch ohne Auto je Uhrzeit, Mittel der letzten 14 Tage (InfluxDB)")
    g.inject("ems-lp-inj", "stündlich", 0, 1, ["ems-lp"], wiederholen=3600, verzoegerung="40")
    g.funktion("ems-lp", "Lastprofil", 1, 1, code("lastprofil.js"), 2, [["ems-lp-db"], []])
    g.influx_lesen("ems-lp-db", "InfluxDB lesen", 2, 1, ["ems-lp"])

    g = t.gruppe("grp-strategie", "Strategie", "Alle 15 min: Netzladen (Vorschau), Wasserlinie, Preise für Wallbox und Wärmepumpe → InfluxDB „ems_strategie“")
    g.inject("ems-st-inj", "alle 15 min", 0, 1, ["ems-st"], wiederholen=900, verzoegerung="60")
    g.funktion("ems-st", "Strategie", 1, 1, code("strategie.js"), 2, [["ems-st-db"], ["ems-st-log"]])
    g.link_out("ems-st-db", "→ Influx ems", 2, 1)
    g.link_out("ems-st-log", "→ Log", 2, 2)

    g = t.gruppe("grp-ausfuehrung", "Ausführung", "Alle 10 s: Befehl an die PV-Batterie (Netzladen → Auto lädt → Wasserlinie → Eigenverbrauch), Überschuss für WP und Auto")
    g.inject("ems-af-inj", "alle 10 s", 0, 1, ["ems-af"], wiederholen=10, verzoegerung="30")
    g.funktion("ems-af", "Ausführung", 1, 1, code("ausfuehrung.js"), 3, [["ems-af-bat"], ["ems-af-db"], ["ems-af-log"]])
    g.link_out("ems-af-bat", "Befehl Batterie", 2, 1)
    g.link_out("ems-af-db", "→ Influx ems", 2, 2)
    g.link_out("ems-af-log", "→ Log", 2, 3)

    # ═════════════ Geräte-Tabs ═════════════
    def adapter_lesen(g, pre, geraet, z, takt=10):
        g.inject(f"{pre}-lesen-inj", f"alle {takt} s", 0, z, [f"{pre}-lesen"], wiederholen=takt, verzoegerung="10")
        g.funktion(f"{pre}-lesen", f"Adapter {geraet}: lesen (Vorlage)", 1, z, code("adapter_lesen_vorlage.js", geraet), 1,
                   [[f"{pre}-lesen-mw"]])
        g.link_out(f"{pre}-lesen-mw", "→ Messwerte", 2, z)

    def befehl(g, pre, geraet, z, eingang_name=None):
        if eingang_name:
            g.link_in(f"{pre}-bef-in", eingang_name, 0, z, [f"{pre}-bef"])
        g.funktion(f"{pre}-bef", "Befehl verteilen", 1, z, code("befehl.js", geraet), 1, [[f"{pre}-bef-ad"]])
        g.funktion(f"{pre}-bef-ad", f"Adapter {geraet}: senden (Vorlage)", 2, z, code("adapter_befehl_vorlage.js", geraet))

    t = f.tab("tab-pv", "☀️ PV & Netz",
              "Adapter für PV-Wechselrichter, Balkonkraftwerk (falls vorhanden) und Netzzähler (oft im Wechselrichter). Solange PV_QUELLE/NETZ_QUELLE = simulator "
              "ist, liefert der Simulator die Werte. Siehe docs/geraete-adapter.md.")
    g = t.gruppe("grp-pv-ad", "Adapter PV-Wechselrichter", "Vorlage: Gerät abfragen (HTTP/Modbus-Knoten vor „lesen“ einsetzen) → { leistung_W }")
    adapter_lesen(g, "pv", "pv", 1)
    g = t.gruppe("grp-bkw-ad", "Adapter Balkonkraftwerk", "Vorlage, nur wenn vorhanden (BKW_QUELLE): { leistung_W } AC-Abgabe ≥ 0, optional soc_pct")
    adapter_lesen(g, "bkw", "bkw", 1)
    g = t.gruppe("grp-netz-ad", "Adapter Netzzähler", "Vorlage: { bezug_W } mit > 0 Bezug, < 0 Einspeisung")
    adapter_lesen(g, "netz", "netz", 1)

    t = f.tab("tab-batterie", "🔋 PV-Batterie",
              "Befehle vom EMS (einziger Schreiber) an die Batterie und Adapter zum Lesen von SoC und Leistung.")
    g = t.gruppe("grp-bat-bef", "Befehl Batterie", "Vom EMS: eigenverbrauch | laden (leistung_W) | begrenzt (max_laden_W, max_entladen_W)")
    befehl(g, "bat", "batterie", 1, "Befehl Batterie")
    g = t.gruppe("grp-bat-ad", "Adapter Batterie", "Vorlage: { soc_pct, leistung_W } mit leistung_W > 0 Entladen, < 0 Laden")
    adapter_lesen(g, "bat", "batterie", 1)

    t = f.tab("tab-auto", "🚗 Auto",
              "Ladeplanung (bis 25 % sofort, 50 % sicher zur Abfahrt, bis 80 % in günstigen Stunden, PV-Laden), "
              "Befehl an die Wallbox und Adapter. Siehe docs/wallbox.md.")
    g = t.gruppe("grp-wb-plan", "Ladeplanung", "Jede Minute: frei, Pause oder PV-Laden (Ampere) → InfluxDB „wallbox_plan“, Meldungen bei Start/Ende")
    g.inject("wb-plan-inj", "jede Minute", 0, 1, ["wb-plan"], wiederholen=60, verzoegerung="40")
    g.funktion("wb-plan", "Ladeplanung", 1, 1, code("wallbox_plan.js"), 3, [["wb-bef"], ["wb-plan-db"], ["wb-plan-log"]])
    g.link_out("wb-plan-db", "→ Influx ems", 2, 2)
    g.link_out("wb-plan-log", "→ Log", 2, 3)
    befehl(g, "wb", "wallbox", 1)
    # Knoten des Befehls stehen rechts neben der Planung
    for n in g.knoten:
        if n["id"] in ("wb-bef", "wb-bef-ad"):
            n["_s"] += 1
    g = t.gruppe("grp-wb-ad", "Adapter Wallbox", "Vorlage: { leistung_W, status, ampere }")
    adapter_lesen(g, "wb", "wallbox", 1)
    g = t.gruppe("grp-auto-ad", "Adapter Auto-Ladestand", "Vorlage: { soc_pct } aus der Hersteller-Schnittstelle des Autos (alle 5 min)")
    adapter_lesen(g, "auto", "auto", 1, takt=300)
    g = t.gruppe("grp-auto-hand", "Ladestand von Hand", "GET/POST /radler/auto?soc=55 setzt den Ladestand (für Autos ohne Schnittstelle)")
    for i, m in enumerate(["get", "post"]):
        g.knoten_hinzu({"id": f"auto-http-{m}", "type": "http in", "name": f"{m.upper()} /radler/auto",
                        "url": "/radler/auto", "method": m, "upload": False, "swaggerDoc": "",
                        "wires": [["auto-hand"]]}, 0, 1 + i)
    g.funktion("auto-hand", "Ladestand übernehmen", 1, 1, code("auto_manuell.js"), 2, [["auto-hand-mw"], ["auto-hand-res"]])
    g.link_out("auto-hand-mw", "→ Messwerte", 2, 1)
    g.knoten_hinzu({"id": "auto-hand-res", "type": "http response", "name": "Antwort", "statusCode": "", "headers": {}}, 2, 2)

    t = f.tab("tab-wp", "🌡️ Wärmepumpe",
              "Steuerung (Anhebung bei PV-Überschuss und günstigem Strom, nie mitten im Heizlauf), Befehl (SG-Ready und "
              "Sollwertanhebung) und Adapter. Siehe docs/waermepumpe.md.")
    g = t.gruppe("grp-wp-st", "Steuerung", "Jede Minute: Anhebung 0 … +2 K, SG-Ready 2/3, Warmwasser absenken → InfluxDB „wp_steuerung“")
    g.inject("wp-st-inj", "jede Minute", 0, 1, ["wp-st"], wiederholen=60, verzoegerung="45")
    g.funktion("wp-st", "Wärmepumpe steuern", 1, 1, code("wp_steuerung.js"), 3, [["wp-bef"], ["wp-st-db"], ["wp-st-log"]])
    g.link_out("wp-st-db", "→ Influx ems", 2, 2)
    g.link_out("wp-st-log", "→ Log", 2, 3)
    befehl(g, "wp", "wp", 1)
    for n in g.knoten:
        if n["id"] in ("wp-bef", "wp-bef-ad"):
            n["_s"] += 1
    g = t.gruppe("grp-wp-ad", "Adapter Wärmepumpe", "Vorlage: { leistung_W, status, aussen_C?, raum_C? }")
    adapter_lesen(g, "wp", "wp", 1, takt=60)

    # ═════════════ 💶 Preise & Prognose ═════════════
    t = f.tab("tab-markt", "💶 Preise & Prognose",
              "Strompreise (Energy-Charts, Viertelstunden), PV-Prognose (Open-Meteo, Einstrahlung je Dachfläche) und Wetter "
              "am Standort. Alles ohne Anmeldung. Bucket „markt“.")
    g = t.gruppe("grp-preise", "Strompreise", "Alle 15 min (erster Abruf 30 s nach dem Start, Netz und DNS brauchen nach dem Booten etwas): Day-Ahead DE-LU + ABGABEN_CT → „strompreis“, Stundenpreise ins Prozessabbild")
    g.inject("mk-pr-inj", "alle 15 min", 0, 1, ["mk-pr-q"], wiederholen=900, verzoegerung="30")
    g.funktion("mk-pr-q", "Abfrage bauen", 1, 1, code("preise_abfrage.js"), 1, [["mk-pr-http"]])
    g.http("mk-pr-http", "Energy-Charts", 2, 1, ["mk-pr"])
    g.funktion("mk-pr", "Preise auswerten", 3, 1, code("preise.js"), 2, [["mk-pr-db"], ["mk-pr-log"]])
    g.link_out("mk-pr-db", "→ Influx markt", 4, 1)
    g.link_out("mk-pr-log", "→ Log", 4, 2)

    g = t.gruppe("grp-prognose", "PV-Prognose", "Alle 30 min: Einstrahlung je Dachfläche (PV_FLAECHEN) × kWp × PV_PR → „pv_prognose“, ins Prozessabbild")
    g.inject("mk-pg-inj", "alle 30 min", 0, 1, ["mk-pg-q"], wiederholen=1800, verzoegerung="35")
    g.funktion("mk-pg-q", "Abfrage je Fläche", 1, 1, code("prognose_abfrage.js"), 1, [["mk-pg-http"]])
    g.http("mk-pg-http", "Open-Meteo", 2, 1, ["mk-pg-fl"])
    g.funktion("mk-pg-fl", "Fläche anhängen", 3, 1,
               "// Antwort und Dachfläche zusammenpacken, damit „Prognose auswerten“ die kWp kennt\n"
               "msg.payload = { antwort: msg.payload, flaeche: msg.flaeche };\nreturn msg;\n", 1, [["mk-pg-join"]])
    g.knoten_hinzu({"id": "mk-pg-join", "type": "join", "name": "alle Flächen", "mode": "auto", "build": "array",
                    "property": "payload", "propertyType": "msg", "key": "topic", "joiner": "\\n",
                    "joinerType": "str", "useparts": True, "accumulate": False, "timeout": "60", "count": "",
                    "reduceRight": False, "reduceExp": "", "reduceInit": "", "reduceInitType": "",
                    "reduceFixup": "", "wires": [["mk-pg"]]}, 4, 1)
    g.funktion("mk-pg", "Prognose auswerten", 5, 1, code("prognose.js"), 2, [["mk-pg-db"], ["mk-pg-log"]])
    g.link_out("mk-pg-db", "→ Influx markt", 6, 1)
    g.link_out("mk-pg-log", "→ Log", 6, 2)

    g = t.gruppe("grp-wetter", "Wetter", "Alle 10 min aktuelles Wetter, beim Start die letzten 48 h → „wetter“")
    g.inject("mk-we-inj", "alle 10 min", 0, 1, ["mk-we-q"], wiederholen=600, verzoegerung="30", topic="aktuell")
    g.inject("mk-we-verlauf", "Verlauf 48 h (Start)", 0, 2, ["mk-we-q"], verzoegerung="45", topic="verlauf")
    g.funktion("mk-we-q", "Abfrage bauen", 1, 1, code("wetter_abfrage.js"), 1, [["mk-we-http"]])
    g.http("mk-we-http", "Open-Meteo", 2, 1, ["mk-we"])
    g.funktion("mk-we", "Wetter auswerten", 3, 1, code("wetter.js"), 1, [["mk-we-db"]])
    g.link_out("mk-we-db", "→ Influx markt", 4, 1)

    # ═════════════ 🧪 Simulator ═════════════
    t = f.tab("tab-sim", "🧪 Simulator",
              "Bildet PV, Netz, Batterie, Wallbox mit Auto und Wärmepumpe nach, solange die echten Geräte fehlen. "
              "Je Gerät abschalten mit <GERÄT>_QUELLE = geraet (oder aus). Siehe docs/simulator.md.")
    g = t.gruppe("grp-sim", "Simulator", "Alle 10 s: folgt den Befehlen des EMS wie ein echtes Gerät, Messwerte mit Quelle „simulator“")
    g.inject("sim-inj", "alle 10 s", 0, 1, ["sim"], wiederholen=10, verzoegerung="8")
    g.funktion("sim", "Simulator", 1, 1, code("simulator.js"), 1, [["sim-mw"]])
    g.link_out("sim-mw", "→ Messwerte", 2, 1)

    alle = f.json()
    # Link-Namen in IDs übersetzen
    namen = {n["name"]: n["id"] for n in alle if n["type"] == "link in"}
    for n in alle:
        if n["type"] == "link out":
            n["links"] = [namen[x] if x in namen else x for x in n["links"]]
    nach_id = {n["id"]: n for n in alle}
    for n in alle:
        if n["type"] == "link in":
            n["links"] = []
    for n in alle:
        if n["type"] == "link out":
            for z in n["links"]:
                nach_id[z]["links"].append(n["id"])
    # Prüfen: alle Verbindungen zeigen auf vorhandene Knoten
    for n in alle:
        for ausgang in n.get("wires", []):
            for z in ausgang:
                assert z in nach_id, f"{n['id']} → {z} fehlt"
        for z in n.get("links", []):
            assert z in nach_id, f"Link {n['id']} → {z} fehlt"
    return alle


def main():
    text = json.dumps(bauen(), ensure_ascii=False, indent=1) + "\n"
    if "--pruefen" in sys.argv:
        aktuell = ZIEL.exists() and ZIEL.read_text(encoding="utf-8") == text
        print("flows.json ist aktuell" if aktuell else "flows.json ist NICHT aktuell: python3 nodered/build.py")
        sys.exit(0 if aktuell else 1)
    ZIEL.write_text(text, encoding="utf-8")
    print(f"{ZIEL.relative_to(HIER.parent)}: {len(json.loads(text))} Knoten")


if __name__ == "__main__":
    main()
