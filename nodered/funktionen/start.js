// Start: nach jedem Neustart von Node-RED
// ─ Zweck: Startzeit merken, Einstellungen prüfen, Neustart ins Log schreiben.
// ─ Eingang: Inject einmal 2 s nach dem Start
// ─ Ausgang 1: msg.log (info, bei fehlenden Pflichtwerten zusätzlich eine Warnung mit melden 'konfig')
// ─ Kontext: global.radler_start

global.set('radler_start', Date.now());

const MODI = ['EMS_MODUS', 'WB_MODUS', 'WP_MODUS', 'WL_MODUS', 'HA_MODUS', 'WB_PV_MODUS'];
const QUELLEN = ['PV_QUELLE', 'BKW_QUELLE', 'NETZ_QUELLE', 'BATTERIE_QUELLE', 'WALLBOX_QUELLE', 'AUTO_QUELLE', 'WP_QUELLE'];
const modi = MODI.map(n => `${n}=${env.get(n) || '(Standard)'}`).join(', ');
const quellen = QUELLEN.map(n => `${n}=${env.get(n) || (n === 'BKW_QUELLE' ? 'aus' : 'simulator')}`).join(', ');

const msgs = [{ log: { stufe: 'info', bereich: 'system', text: 'Node-RED gestartet', daten: { modi, quellen } } }];

// Ohne Standort gibt es weder Wetter noch PV-Prognose für den richtigen Ort
const fehlend = ['STANDORT_LAT', 'STANDORT_LON', 'PV_FLAECHEN'].filter(n => !env.get(n));
if (fehlend.length) {
    msgs.push({ log: { stufe: 'warnung', bereich: 'system', melden: 'konfig',
        text: 'Einstellungen fehlen in secrets.env (Standardwerte aktiv): ' + fehlend.join(', ') } });
}
const echte = QUELLEN.filter(n => env.get(n) === 'geraet');
node.status({ fill: 'green', shape: 'dot',
    text: echte.length ? 'echte Geräte: ' + echte.join(', ') : 'alle Geräte im Simulator' });
return [msgs];
