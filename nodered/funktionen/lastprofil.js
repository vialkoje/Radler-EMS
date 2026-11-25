// Lastprofil: mittlerer Hausverbrauch ohne Auto je Uhrzeit (deutsche Zeit), letzte 14 Tage
// Zwei Schritte in einem Knoten:
//   msg.schritt fehlt  → Abfrage bauen (Ausgang 1 → "InfluxDB lesen", die Antwort kommt mit msg.schritt = 'antwort' zurück)
//   msg.schritt = 'antwort' → auswerten
// ─ Kontext: global.ems_lastprofil = { werte: [24 × W], tage, zeit }
// Warum Mittelwert und 14 Tage: In Haus-EMS über 60 Tage rückgerechnet. Der Median übersieht die Blöcke der
// Wärmepumpe, der Mittelwert enthält sie (docs/ems.md, „Lastprofil“).
// Ist die InfluxDB nicht erreichbar, bleibt das letzte Profil stehen (R1.6).

if (msg.schritt !== 'antwort') {
    msg.schritt = 'antwort';
    msg.query = `from(bucket: "geraete")
  |> range(start: -14d)
  |> filter(fn: (r) => r._measurement == "haus" and r._field == "ohne_auto_W")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_value"])`;
    return [msg, null];
}

const zeilen = Array.isArray(msg.payload) ? msg.payload : [];
const stunde = t => parseInt(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(t), 10);
const summe = new Array(24).fill(0), anzahl = new Array(24).fill(0);
const tage = new Set();
for (const z of zeilen) {
    // aggregateWindow stempelt das Ende der Stunde
    const t = new Date(z._time).getTime() - 3600000;
    const h = stunde(t);
    summe[h] += z._value;
    anzahl[h]++;
    tage.add(new Date(t).toISOString().slice(0, 10));
}
const alt = global.get('ems_lastprofil');
const standard = parseFloat(env.get('LAST_STANDARD_W')) || 500;
const besetzt = anzahl.filter(n => n > 0).length;
if (tage.size < 2 || besetzt < 20) {
    // zu wenig Daten: feste Annahme, bis genug gesammelt ist
    const profil = { werte: new Array(24).fill(standard), tage: tage.size, zeit: Date.now(), quelle: 'Standard' };
    global.set('ems_lastprofil', profil);
    node.status({ fill: 'yellow', shape: 'ring', text: `zu wenig Daten (${tage.size} Tage), fest ${standard} W` });
    return [null, profil];
}
const werte = summe.map((s, h) => Math.round(anzahl[h] ? s / anzahl[h] : (alt ? alt.werte[h] : standard)));
const profil = { werte, tage: tage.size, zeit: Date.now(), quelle: 'InfluxDB' };
global.set('ems_lastprofil', profil);
const tagWh = werte.reduce((a, b) => a + b, 0);
node.status({ fill: 'green', shape: 'dot', text: `${tage.size} Tage · ${(tagWh / 1000).toFixed(1)} kWh/Tag · max ${Math.max(...werte)} W` });
return [null, profil];
