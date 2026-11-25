// Strompreise auswerten
// ─ Eingang: Antwort von Energy-Charts { unix_seconds: [...], price: [...] (EUR/MWh) }
// ─ Ausgang 1: InfluxDB-Punkte (Bucket markt, Messreihe "strompreis": boerse_ct, preis_ct je Viertelstunde)
// ─ Ausgang 2: msg.log bei Fehlern
// ─ Umgebung: ABGABEN_CT (18): Netzentgelt, Steuern, Umlagen, Marge; der Endpreis ist Börse + ABGABEN_CT
// ─ Kontext: global.abbild['markt.preise'] = Stundenpreise ab der laufenden Stunde [{ t, ct }] (Endpreis),
//            global.abbild['markt.preise_15'] = Viertelstunden [{ t, ct }]

const p = msg.payload;
if (!p || !Array.isArray(p.unix_seconds) || !Array.isArray(p.price) || !p.unix_seconds.length) {
    node.status({ fill: 'red', shape: 'dot', text: 'keine Preise (HTTP ' + msg.statusCode + ')' });
    return [null, { log: { stufe: 'warnung', bereich: 'preise', text: 'Strompreise nicht abrufbar (HTTP ' + msg.statusCode + ')' } }];
}
const abgaben = parseFloat(env.get('ABGABEN_CT'));
const aufschlag = isNaN(abgaben) ? 18 : abgaben;

const viertel = [];
const punkte = [];
p.unix_seconds.forEach((s, i) => {
    const boerse = p.price[i];
    if (typeof boerse !== 'number') return;
    const t = s * 1000;
    const ct = +(boerse / 10 + aufschlag).toFixed(3);
    viertel.push({ t, ct });
    punkte.push({ measurement: 'strompreis', tags: { quelle: 'energy-charts' },
        fields: { boerse_ct: +(boerse / 10).toFixed(3), preis_ct: ct }, timestamp: new Date(t) });
});

// Stundenmittel ab der laufenden Stunde (die Regelung rechnet stündlich wie in Haus-EMS)
const stunden = {};
for (const v of viertel) {
    const h = Math.floor(v.t / 3600000) * 3600000;
    (stunden[h] = stunden[h] || []).push(v.ct);
}
const ab = Math.floor(Date.now() / 3600000) * 3600000;
const liste = Object.keys(stunden).map(Number).sort((a, b) => a - b).filter(h => h >= ab)
    .map(h => ({ t: h, ct: +(stunden[h].reduce((a, b) => a + b, 0) / stunden[h].length).toFixed(2) }));

const abbild = global.get('abbild') || {};
const jetzt = Date.now();
abbild['markt.preise'] = { wert: liste, einheit: 'ct/kWh', zeit: jetzt, quelle: 'energy-charts' };
abbild['markt.preise_15'] = { wert: viertel.filter(v => v.t >= ab), einheit: 'ct/kWh', zeit: jetzt, quelle: 'energy-charts' };
if (liste.length) abbild['markt.preis_jetzt_ct'] = { wert: liste[0].ct, einheit: 'ct/kWh', zeit: jetzt, quelle: 'energy-charts' };
global.set('abbild', abbild);

const bis = liste.length ? new Date(liste[liste.length - 1].t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit' }) : '–';
node.status({ fill: 'green', shape: 'dot', text: `${liste.length} h bekannt, bis ${bis} Uhr · jetzt ${liste.length ? liste[0].ct.toFixed(1) : '–'} ct` });
return [{ payload: punkte }, null];
