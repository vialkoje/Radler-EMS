// Messwerte → Prozessabbild und InfluxDB (Bucket "geraete")
// ─ Zweck: einzige Stelle, an der Messwerte ins Prozessabbild (global.abbild) und in die InfluxDB gehen (R1).
// ─ Eingang: msg.geraet ('pv', 'netz', 'batterie', 'wallbox', 'auto', 'wp' …),
//            msg.payload = { feld: wert, … } (Feldnamen mit Einheit als Endung: leistung_W, soc_pct, raum_C),
//            msg.quelle ('simulator', 'geraet', 'manuell' …), optional msg.zeit (ms).
// ─ Ausgang 1: msg.payload = InfluxDB-Punkte für den Batch-Knoten.
// ─ Kontext: global.abbild = { 'geraet.feld': { wert, einheit, zeit, quelle } }
// Kommt ein Netzwert, rechnet der Knoten die Hausbilanz (Messreihe "haus"):
//   verbrauch = Netzbezug + PV + Balkonkraftwerk + Batterie-Entladung (alle Vorzeichen siehe docs/architektur.md)

const EINHEITEN = [['_kWh', 'kWh'], ['_Wh', 'Wh'], ['_W', 'W'], ['_pct', '%'], ['_C', '°C'], ['_K', 'K'], ['_A', 'A']];
function einheit(feld) {
    for (const [endung, e] of EINHEITEN) if (feld.endsWith(endung)) return e;
    return '';
}

const geraet = msg.geraet;
if (!geraet || !msg.payload || typeof msg.payload !== 'object') {
    node.warn('Messwert ohne msg.geraet oder msg.payload verworfen');
    return null;
}
const zeit = msg.zeit || Date.now();
const quelle = msg.quelle || 'unbekannt';
const abbild = global.get('abbild') || {};

const fields = {};
for (const [feld, w] of Object.entries(msg.payload)) {
    if (w === null || w === undefined) continue;
    if (typeof w === 'number' && !isFinite(w)) continue;
    abbild[geraet + '.' + feld] = { wert: w, einheit: einheit(feld), zeit, quelle };
    if (typeof w === 'boolean') fields[feld] = w ? 1 : 0;
    else if (typeof w === 'number' || typeof w === 'string') fields[feld] = w;
}
if (!Object.keys(fields).length) return null;

const punkte = [{ measurement: geraet, tags: { quelle }, fields, timestamp: new Date(zeit) }];

if (geraet === 'netz' && typeof fields.bezug_W === 'number') {
    // Hausbilanz: Werte höchstens 60 s alt, fehlende Geräte zählen als 0
    const g = s => { const e = abbild[s]; return e && zeit - e.zeit <= 60000 && typeof e.wert === 'number' ? e.wert : 0; };
    const verbrauch = Math.max(0, fields.bezug_W + g('pv.leistung_W') + g('bkw.leistung_W') + g('batterie.leistung_W'));
    const ohneAuto = Math.max(0, verbrauch - g('wallbox.leistung_W'));
    const haus = {
        verbrauch_W: Math.round(verbrauch),
        ohne_auto_W: Math.round(ohneAuto),
        grundlast_W: Math.round(Math.max(0, ohneAuto - g('wp.leistung_W'))),
    };
    for (const [feld, w] of Object.entries(haus)) abbild['haus.' + feld] = { wert: w, einheit: 'W', zeit, quelle: 'bilanz' };
    punkte.push({ measurement: 'haus', tags: { quelle: 'bilanz' }, fields: haus, timestamp: new Date(zeit) });
}

global.set('abbild', abbild);
const n = (context.get('n') || 0) + 1;
context.set('n', n);
node.status({ fill: 'green', shape: 'dot', text: `${geraet} (${quelle}) · ${Object.keys(abbild).length} Signale · ${n} Meldungen` });
msg.payload = punkte;
return msg;
