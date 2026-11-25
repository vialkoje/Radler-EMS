// Logeintrag erzeugen (R2): ein Log für alles
// ─ Eingang: msg.log = { stufe: 'fehler'|'warnung'|'info', bereich, text, daten?, melden? }
//            melden: true oder eine Art aus dem Meldekatalog ('zusage', 'geraet', 'wallbox' …)
// ─ Ausgang 1: Zeile für die Logdatei (msg.filename, msg.payload = JSON)
// ─ Ausgang 2: Fehler und Warnungen → InfluxDB (Bucket "ems", Messreihe "ems_log")
// ─ Ausgang 3: Einträge mit melden → Meldung prüfen
// ─ Umgebung: LOG_VERZEICHNIS (Standard /home/pi/radler-ems/log)

const STUFEN = ['fehler', 'warnung', 'info'];
const l = msg.log || {};
const stufe = STUFEN.includes(l.stufe) ? l.stufe : 'info';
const jetzt = new Date();
const eintrag = { zeit: jetzt.toISOString(), stufe, bereich: l.bereich || 'system', text: String(l.text || '') };
if (l.daten !== undefined) eintrag.daten = l.daten;
if (l.melden) eintrag.melden = l.melden;

// Datum in deutscher Zeit, eine Datei je Tag
const tag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt);
const verzeichnis = (env.get('LOG_VERZEICHNIS') || '/home/pi/radler-ems/log').replace(/\/$/, '');
const datei = { filename: `${verzeichnis}/radler-ems-${tag}.log`, payload: JSON.stringify(eintrag) };

const influx = stufe === 'info' ? null : {
    payload: [{ measurement: 'ems_log', tags: { stufe, bereich: eintrag.bereich }, fields: { text: eintrag.text }, timestamp: jetzt }],
};
const meldung = l.melden ? { meldung: eintrag } : null;

const zaehler = context.get('zaehler') || { fehler: 0, warnung: 0, info: 0 };
zaehler[stufe]++;
context.set('zaehler', zaehler);
node.status({
    fill: stufe === 'fehler' ? 'red' : stufe === 'warnung' ? 'yellow' : 'green', shape: 'dot',
    text: `${zaehler.fehler} Fehler, ${zaehler.warnung} Warnungen, ${zaehler.info} Info · ${eintrag.text.slice(0, 50)}`,
});
return [datei, influx, meldung];
