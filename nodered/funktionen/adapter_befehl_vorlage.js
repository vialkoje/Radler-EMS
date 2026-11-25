// VORLAGE – Adapter: Befehl ans Gerät senden (GERAET steht in der ersten Zeile)
// Hier wird beim Hackathon das echte Gerät angebunden. Siehe docs/geraete-adapter.md.
//
// Eingang msg.befehl (nur, wenn <GERÄT>_QUELLE = geraet):
//   batterie: { modus: 'eigenverbrauch' }
//             { modus: 'laden', leistung_W }                        aus dem Netz laden
//             { modus: 'begrenzt', max_laden_W, max_entladen_W }    null = keine Grenze, 0 = gesperrt
//   wallbox:  { modus: 'frei' } | { modus: 'pause' } | { modus: 'strom', ampere }
//   wp:       { sgready: 2|3, anhebung_K, ww_absenken }
// Ausgang → HTTP-/Modbus-/MQTT-Knoten des Geräts.
// Sicherheit: Gerät so einstellen, dass es ohne neuen Befehl nach einigen Minuten in den Normalbetrieb fällt
// (Timeout), sonst bleibt bei einem Ausfall von Node-RED der letzte Befehl stehen.

const b = msg.befehl;

// ▼▼▼ Hier den Befehl in Register/Anfrage des Geräts übersetzen ▼▼▼
const anfrage = null; // z. B. { payload: { value: b.max_laden_W, fc: 6, unitid: 1, address: 1234, quantity: 1 } }
// ▲▲▲

if (!anfrage) {
    if (!context.get('gewarnt')) {
        context.set('gewarnt', true);
        node.warn(`Befehl für ${GERAET} kann nicht gesendet werden: Adapter noch nicht umgesetzt`);
    }
    node.status({ fill: 'yellow', shape: 'ring', text: 'Adapter noch nicht umgesetzt' });
    return null;
}
node.status({ fill: 'green', shape: 'dot', text: JSON.stringify(b).slice(0, 60) });
return anfrage;
