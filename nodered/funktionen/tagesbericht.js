// Tagesbericht (R5): um 7 Uhr für den Vortag
// Ein Knoten für alle drei Schritte, unterschieden nach msg.schritt:
//   (ohne)    → Abfrage 1 bauen: Netz, PV, Wallbox je Minute (Bucket geraete)
//   'geraete' → Antwort merken, Abfrage 2 bauen: Strompreise (Bucket markt)
//   'markt'   → Antwort merken, Abfrage 3 bauen: Netzladen der Strategie (Bucket ems)
//   'ems'     → Bericht rechnen
// ─ Ausgang 1: msg.query → "InfluxDB lesen" (dessen Antwort kommt wieder hierher)
// ─ Ausgang 2: msg.log mit melden 'tagesbericht' → Log
// ─ Umgebung: EINSPEISE_CT (8,0), ABGABEN_CT (nur als Rückfall, wenn kein Endpreis gespeichert ist)
// ─ Kontext: global.meldung_nacht (wird angehängt und geleert)

function mitternachtBerlin(t) {
    // UTC-Zeitpunkt von 0 Uhr deutscher Zeit am Tag von t
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]));
    const alsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const versatz = alsUtc - Math.floor(t / 1000) * 1000;
    return Date.UTC(+p.year, +p.month - 1, +p.day) - versatz;
}
const fmt = (x, n = 1) => x.toFixed(n).replace('.', ',');

if (!msg.schritt) {
    const stop = mitternachtBerlin(Date.now());
    const start = mitternachtBerlin(stop - 12 * 3600000);
    msg.bericht = { start, stop };
    msg.schritt = 'geraete';
    msg.query = `from(bucket: "geraete")
  |> range(start: ${new Date(start).toISOString()}, stop: ${new Date(stop).toISOString()})
  |> filter(fn: (r) => (r._measurement == "netz" and r._field == "bezug_W") or
                       (r._measurement == "pv" and r._field == "leistung_W") or
                       (r._measurement == "bkw" and r._field == "leistung_W") or
                       (r._measurement == "wallbox" and r._field == "leistung_W"))
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_value", "_measurement"])`;
    return [msg, null];
}

const b = msg.bericht;
if (msg.schritt === 'geraete') {
    b.geraete = Array.isArray(msg.payload) ? msg.payload : [];
    msg.schritt = 'markt';
    msg.query = `from(bucket: "markt")
  |> range(start: ${new Date(b.start - 3600000).toISOString()}, stop: ${new Date(b.stop).toISOString()})
  |> filter(fn: (r) => r._measurement == "strompreis" and r._field == "preis_ct")
  |> keep(columns: ["_time", "_value"])`;
    return [msg, null];
}
if (msg.schritt === 'markt') {
    b.preise = Array.isArray(msg.payload) ? msg.payload : [];
    msg.schritt = 'ems';
    msg.query = `from(bucket: "ems")
  |> range(start: ${new Date(b.start).toISOString()}, stop: ${new Date(b.stop).toISOString()})
  |> filter(fn: (r) => r._measurement == "ems_strategie" and r._field == "nl_laden")
  |> keep(columns: ["_time", "_value"])`;
    return [msg, null];
}

// Schritt 'ems': rechnen
const nl = Array.isArray(msg.payload) ? msg.payload : [];
const einspeiseCt = parseFloat(env.get('EINSPEISE_CT')) || 8.0;
const preise = b.preise.map(r => [new Date(r._time).getTime(), r._value]).sort((x, y) => x[0] - y[0]);
function preisZu(t) {
    // letzter bekannter Preis vor t (Viertelstunden)
    let p = null;
    for (const [tp, v] of preise) { if (tp <= t) p = v; else break; }
    return p;
}
let bezug = 0, einspeisung = 0, kosten = 0, pv = 0, bkw = 0, auto = 0, ohnePreis = 0;
for (const r of b.geraete) {
    const t = new Date(r._time).getTime() - 60000; // aggregateWindow stempelt das Ende der Minute
    const kWh = r._value / 60000;
    if (r._measurement === 'netz') {
        if (kWh > 0) {
            bezug += kWh;
            const p = preisZu(t);
            if (p === null) ohnePreis += kWh; else kosten += kWh * p / 100;
        } else {
            einspeisung -= kWh;
            kosten += kWh * einspeiseCt / 100;
        }
    } else if (r._measurement === 'pv') pv += Math.max(0, kWh);
    else if (r._measurement === 'bkw') bkw += Math.max(0, kWh);
    else if (r._measurement === 'wallbox') auto += Math.max(0, kWh);
}
const nlStunden = nl.filter(r => r._value >= 1).length * 0.25;
const datum = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit' }).format(b.start);
let text = `📊 Tagesbericht ${datum}.: Strom ${fmt(kosten, 2)} € (Bezug ${fmt(bezug)} kWh, Einspeisung ${fmt(einspeisung)} kWh)` +
    ` · PV ${fmt(pv + bkw)} kWh${bkw > 0.05 ? ` (davon Balkon ${fmt(bkw)})` : ''} · Auto ${fmt(auto)} kWh · Netzladen ${fmt(nlStunden, 2)} h`;
if (ohnePreis > 0.05) text += ` (${fmt(ohnePreis)} kWh ohne Preis)`;
const nacht = global.get('meldung_nacht') || [];
if (nacht.length) text += '\nNachts zurückgehalten:\n' + nacht.map(x => '· ' + x.text).join('\n');
global.set('meldung_nacht', []);
node.status({ fill: 'green', shape: 'dot', text: text.slice(0, 60) });
return [null, { log: { stufe: 'info', bereich: 'system', melden: 'tagesbericht', text,
    daten: { kosten_eur: +kosten.toFixed(2), bezug_kWh: +bezug.toFixed(2), einspeisung_kWh: +einspeisung.toFixed(2),
             pv_kWh: +(pv + bkw).toFixed(2), bkw_kWh: +bkw.toFixed(2), auto_kWh: +auto.toFixed(2), netzladen_h: nlStunden } } }];
