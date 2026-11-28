// VORLAGE – Adapter: Messwerte lesen (GERAET steht in der ersten Zeile)
// Hier wird beim Hackathon das echte Gerät angebunden. Siehe docs/geraete-adapter.md.
//
// Aufgabe: das Gerät abfragen (vorgeschaltet: HTTP-, Modbus- oder MQTT-Knoten) und die Werte in das
// einheitliche Format bringen. Ausgang → Link „→ Messwerte“:
//   msg.geraet = GERAET
//   msg.quelle = 'geraet'
//   msg.payload = { … } mit genau diesen Feldern (fehlende weglassen):
//     pv:       { leistung_W }                                   (≥ 0)
//     bkw:      { leistung_W, soc_pct? }                         Balkonkraftwerk: AC-Abgabe ≥ 0, Akku-SoC falls vorhanden
//     netz:     { bezug_W }                                      (> 0 Bezug, < 0 Einspeisung)
//     batterie: { soc_pct, leistung_W }                          (leistung_W > 0 Entladen, < 0 Laden)
//     wallbox:  { leistung_W, status, ampere }                   status: getrennt | angesteckt | laedt | pausiert | stoerung
//     auto:     { soc_pct }                                      (Ladestand des Autos, falls abrufbar)
//     wp:       { leistung_W, status, aussen_C?, raum_C?, ww_C? }  status: aus | heizen | warmwasser | stoerung (ww_C = Warmwasser)
//
// Solange <GERÄT>_QUELLE nicht "geraet" ist, tut dieser Knoten nichts.

const QUELLE_VAR = { pv: 'PV_QUELLE', bkw: 'BKW_QUELLE', netz: 'NETZ_QUELLE', batterie: 'BATTERIE_QUELLE', wallbox: 'WALLBOX_QUELLE',
    auto: 'AUTO_QUELLE', wp: 'WP_QUELLE' }[GERAET];
if ((env.get(QUELLE_VAR) || 'simulator') !== 'geraet') {
    node.status({ fill: 'grey', shape: 'ring', text: 'nicht aktiv (' + QUELLE_VAR + ' ≠ geraet)' });
    return null;
}

// ▼▼▼ Hier die Antwort des Geräts (msg.payload) umrechnen ▼▼▼
const roh = msg.payload;
const werte = null; // z. B. { leistung_W: roh.P_PV }
// ▲▲▲

if (!werte) {
    if (!context.get('gewarnt')) {
        context.set('gewarnt', true);
        node.warn(`${QUELLE_VAR}=geraet, aber der Adapter für ${GERAET} ist noch nicht umgesetzt`);
    }
    node.status({ fill: 'yellow', shape: 'ring', text: 'Adapter noch nicht umgesetzt' });
    return null;
}
node.status({ fill: 'green', shape: 'dot', text: JSON.stringify(werte).slice(0, 60) });
return { geraet: GERAET, quelle: 'geraet', payload: werte };
