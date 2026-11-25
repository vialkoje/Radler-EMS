// PV-Prognose auswerten
// ─ Eingang: msg.payload = [{ antwort, flaeche }, …] vom Join-Knoten, eine je Dachfläche
//            (der Knoten "Fläche anhängen" packt Open-Meteo-Antwort und Fläche mit kWp zusammen)
// ─ Ausgang 1: InfluxDB-Punkte (Bucket markt, Messreihe "pv_prognose": leistung_W je Stunde)
// ─ Ausgang 2: msg.log bei Fehlern
// ─ Umgebung: PV_PR (Performance Ratio, 0,85): Verluste durch Wechselrichter, Kabel, Wärme, Verschmutzung
// ─ Kontext: global.abbild['prognose.pv'] = [{ t (Beginn der Stunde), W }]
// Open-Meteo gibt Strahlung als Mittel der VORANGEGANGENEN Stunde an: der Wert mit Zeitstempel t gilt für t-1h … t.

const pr = parseFloat(env.get('PV_PR')) || 0.85;
const antworten = Array.isArray(msg.payload) ? msg.payload : [];
const summe = {};
let ok = 0;
for (const a of antworten) {
    const h = a && a.antwort && a.antwort.hourly;
    if (!h || !Array.isArray(h.time)) continue;
    ok++;
    h.time.forEach((s, i) => {
        const gti = h.global_tilted_irradiance[i];
        if (typeof gti !== 'number') return;
        const t = (s - 3600) * 1000;
        summe[t] = (summe[t] || 0) + gti * a.flaeche.kwp * pr; // W/m² × kWp = W bei 1000 W/m² Normstrahlung
    });
}
if (!ok) {
    node.status({ fill: 'red', shape: 'dot', text: 'keine Prognose' });
    return [null, { log: { stufe: 'warnung', bereich: 'prognose', text: 'PV-Prognose nicht abrufbar' } }];
}
const liste = Object.keys(summe).map(Number).sort((a, b) => a - b).map(t => ({ t, W: Math.round(summe[t]) }));
const abbild = global.get('abbild') || {};
abbild['prognose.pv'] = { wert: liste, einheit: 'W', zeit: Date.now(), quelle: 'open-meteo' };
global.set('abbild', abbild);

const ab = Math.floor(Date.now() / 3600000) * 3600000;
const heute = liste.filter(x => x.t >= ab && x.t < ab + 24 * 3600000).reduce((a, x) => a + x.W, 0);
node.status({ fill: 'green', shape: 'dot', text: `${ok} Fläche(n) · nächste 24 h ${(heute / 1000).toFixed(1)} kWh` });
return [{ payload: liste.map(x => ({ measurement: 'pv_prognose', tags: { quelle: 'open-meteo' },
    fields: { leistung_W: x.W }, timestamp: new Date(x.t) })) }, null];
