// Geräte-Wächter: meldet Geräte, die keine Werte mehr liefern, und ihre Rückkehr
// ─ Eingang: Inject jede Minute. Kontext: global.abbild
// ─ Ausgang 1: msg.log (fehler mit melden 'geraet' bzw. info bei Rückkehr) → Log
// ─ Umgebung: GERAET_OFFLINE_MIN (15), <GERÄT>_QUELLE (aus = nicht überwachen)

const SIGNALE = [
    // [Signal, Name, Umgebungsvariable der Quelle, Grenze in Minuten (null = GERAET_OFFLINE_MIN)]
    ['pv.leistung_W', 'PV-Wechselrichter', 'PV_QUELLE', null],
    ['netz.bezug_W', 'Netzzähler', 'NETZ_QUELLE', null],
    ['batterie.soc_pct', 'PV-Batterie', 'BATTERIE_QUELLE', null],
    ['wallbox.status', 'Wallbox', 'WALLBOX_QUELLE', null],
    ['wp.status', 'Wärmepumpe', 'WP_QUELLE', null],
    ['markt.preise', 'Strompreise', null, 180],
    ['prognose.pv', 'PV-Prognose', null, 180],
];

const jetzt = Date.now();
const abbild = global.get('abbild') || {};
const grenzeStd = parseFloat(env.get('GERAET_OFFLINE_MIN')) || 15;
const start = global.get('radler_start') || jetzt;
const offline = context.get('offline') || {};
const msgs = [];
const fehlt = [];

for (const [signal, name, quelleVar, grenzeMin] of SIGNALE) {
    if (quelleVar && (env.get(quelleVar) || 'simulator') === 'aus') continue;
    const grenze = (grenzeMin || grenzeStd) * 60000;
    const e = abbild[signal];
    const alter = e ? jetzt - e.zeit : jetzt - start;
    if (alter > grenze) {
        fehlt.push(name);
        if (!offline[signal]) {
            offline[signal] = jetzt;
            msgs.push({ log: { stufe: 'fehler', bereich: 'system', melden: 'geraet',
                text: `${name} liefert seit ${Math.round(alter / 60000)} min keine Werte` } });
        }
    } else if (offline[signal]) {
        msgs.push({ log: { stufe: 'info', bereich: 'system', melden: 'geraet',
            text: `${name} wieder online (nach ${Math.round((jetzt - offline[signal]) / 60000)} min)` } });
        delete offline[signal];
    }
}
context.set('offline', offline);
node.status(fehlt.length
    ? { fill: 'red', shape: 'dot', text: 'fehlt: ' + fehlt.join(', ') }
    : { fill: 'green', shape: 'dot', text: 'alle Geräte liefern' });
return msgs.length ? [msgs] : null;
