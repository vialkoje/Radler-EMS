// Ladestand des Autos von Hand setzen: GET/POST http://<pi>:1880/radler/auto?soc=55
// Für Autos ohne abrufbaren Ladestand (AUTO_QUELLE = manuell). Gilt WB_SOC_MAX_ALTER_MIN lang, danach plant die
// Ladeplanung nach „teuerste Stunden“.
// ─ Ausgang 1: Messwert → Link „→ Messwerte“
// ─ Ausgang 2: HTTP-Antwort

const q = Object.assign({}, msg.req && msg.req.query, typeof msg.payload === 'object' ? msg.payload : {});
const soc = parseFloat(q.soc);
if (isNaN(soc) || soc < 0 || soc > 100) {
    return [null, { statusCode: 400, payload: { fehler: 'soc fehlt oder ungültig (0–100)' }, res: msg.res }];
}
node.status({ fill: 'green', shape: 'dot', text: `Auto ${soc} % (von Hand)` });
return [{ geraet: 'auto', quelle: 'manuell', payload: { soc_pct: soc } },
        { statusCode: 200, payload: { ok: true, soc_pct: soc }, res: msg.res }];
