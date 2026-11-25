// PV-Prognose auswerten
// ─ Eingang: msg.payload = [{ antwort, flaeche }, …] vom Join-Knoten, eine je Dachfläche
//            (der Knoten "Fläche anhängen" packt Open-Meteo-Antwort und Fläche mit kWp zusammen)
// ─ Ausgang 1: InfluxDB-Punkte (Bucket markt, Messreihe "pv_prognose": leistung_W je Stunde)
// ─ Ausgang 2: msg.log bei Fehlern
// ─ Umgebung: PV_PR (Performance Ratio, 0,85): Verluste durch Wechselrichter, Kabel, Wärme, Verschmutzung
//             BKW_MAX_W (800): Abgabe des Balkonkraftwerks ist gesetzlich begrenzt, die Prognose wird gekappt
// ─ Kontext: global.abbild['prognose.pv'] = [{ t (Beginn der Stunde), W }] gesamt (Anlage + Balkonkraftwerk),
//            dazu 'prognose.pv_anlage' und 'prognose.bkw' getrennt (für den Simulator und Grafana)
// Open-Meteo gibt Strahlung als Mittel der VORANGEGANGENEN Stunde an: der Wert mit Zeitstempel t gilt für t-1h … t.

const pr = parseFloat(env.get('PV_PR')) || 0.85;
const antworten = Array.isArray(msg.payload) ? msg.payload : [];
const summe = { anlage: {}, bkw: {} };
let ok = 0;
for (const a of antworten) {
    const h = a && a.antwort && a.antwort.hourly;
    if (!h || !Array.isArray(h.time)) continue;
    ok++;
    h.time.forEach((s, i) => {
        const gti = h.global_tilted_irradiance[i];
        if (typeof gti !== 'number') return;
        const t = (s - 3600) * 1000;
        const art = a.flaeche.art === 'bkw' ? 'bkw' : 'anlage';
        summe[art][t] = (summe[art][t] || 0) + gti * a.flaeche.kwp * pr; // W/m² × kWp = W bei 1000 W/m² Normstrahlung
    });
}
if (!ok) {
    node.status({ fill: 'red', shape: 'dot', text: 'keine Prognose' });
    return [null, { log: { stufe: 'warnung', bereich: 'prognose', text: 'PV-Prognose nicht abrufbar' } }];
}
const bkwMax = parseFloat(env.get('BKW_MAX_W')) || 800;
const zeiten = [...new Set([...Object.keys(summe.anlage), ...Object.keys(summe.bkw)])].map(Number).sort((a, b) => a - b);
const teile = zeiten.map(t => {
    const anlage = Math.round(summe.anlage[t] || 0), bkw = Math.round(Math.min(bkwMax, summe.bkw[t] || 0));
    return { t, anlage, bkw, W: anlage + bkw };
});
const liste = teile.map(x => ({ t: x.t, W: x.W }));
const abbild = global.get('abbild') || {};
const jetztMs = Date.now();
abbild['prognose.pv'] = { wert: liste, einheit: 'W', zeit: jetztMs, quelle: 'open-meteo' };
abbild['prognose.pv_anlage'] = { wert: teile.map(x => ({ t: x.t, W: x.anlage })), einheit: 'W', zeit: jetztMs, quelle: 'open-meteo' };
abbild['prognose.bkw'] = { wert: teile.map(x => ({ t: x.t, W: x.bkw })), einheit: 'W', zeit: jetztMs, quelle: 'open-meteo' };
global.set('abbild', abbild);

const ab = Math.floor(Date.now() / 3600000) * 3600000;
const heute = liste.filter(x => x.t >= ab && x.t < ab + 24 * 3600000).reduce((a, x) => a + x.W, 0);
node.status({ fill: 'green', shape: 'dot', text: `${ok} Fläche(n) · nächste 24 h ${(heute / 1000).toFixed(1)} kWh` });
return [{ payload: teile.map(x => ({ measurement: 'pv_prognose', tags: { quelle: 'open-meteo' },
    fields: { leistung_W: x.W, anlage_W: x.anlage, bkw_W: x.bkw }, timestamp: new Date(x.t) })) }, null];
