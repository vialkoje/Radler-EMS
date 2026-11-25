// Warnungen und Fehler (Node-RED-Log) → Log
// ─ Zweck: holt alle 5 s, was der Logger aus settings.js (deploy/settings-radler.js) gesammelt hat,
//          damit node.warn/node.error aller Knoten im Log landen, ohne die Knoten zu ändern (R2.3).
// ─ Eingang: Inject alle 5 s. Kontext: global.radlerLogPuffer (Array, von settings.js angelegt)
// ─ Ausgang 1: je Eintrag eine Nachricht msg.log (Link → Log)
// Knoten des Log-Bereichs selbst (IDs beginnen mit "log-") werden übergangen, sonst gäbe es eine Schleife.

const puffer = global.get('radlerLogPuffer');
if (!Array.isArray(puffer)) {
    node.status({ fill: 'grey', shape: 'ring', text: 'kein Puffer: Zusatz in settings.js fehlt' });
    return null;
}
const neu = puffer.splice(0, puffer.length);
const msgs = neu
    .filter(e => !(e.id || '').startsWith('log-'))
    .map(e => ({
        log: {
            stufe: e.level <= 20 ? 'fehler' : 'warnung',
            bereich: 'node-red',
            text: `${e.name || e.typ || e.id}: ${typeof e.text === 'string' ? e.text : JSON.stringify(e.text)}`.slice(0, 500),
            daten: { id: e.id, tab: e.z },
        },
    }));
const gesamt = (context.get('gesamt') || 0) + msgs.length;
context.set('gesamt', gesamt);
node.status({ fill: 'green', shape: 'dot', text: `${gesamt} übernommen` });
return msgs.length ? [msgs] : null;
