// Meldung prüfen (R5): Katalog, Sperrzeit, Nachtruhe, Versand über ntfy
// ─ Eingang: msg.meldung = Logeintrag mit melden (vom Knoten "Logeintrag erzeugen")
// ─ Ausgang 1: HTTP-Anfrage an ntfy (JSON), nur wenn NTFY_TOPIC gesetzt ist
// ─ Ausgang 2: msg.log (Info: gesendet / wartet / kein Kanal) → Log, ohne melden (keine Schleife)
// ─ Umgebung: NTFY_TOPIC, NTFY_SERVER (Standard https://ntfy.sh), MELDUNG_RUHE_VON (22), MELDUNG_RUHE_BIS (7)
// ─ Kontext: context.gesendet (Sperrzeiten), global.meldung_nacht (nachts zurückgehalten, für den Tagesbericht)

const KATALOG = {
    zusage:       { titel: 'Zusage in Gefahr', sperre_min: 60,  nachts: true,  prio: 5 },
    geraet:       { titel: 'Gerät',            sperre_min: 60,  nachts: true,  prio: 4 },
    befehl:       { titel: 'Befehl abgelehnt', sperre_min: 60,  nachts: false, prio: 4 },
    konfig:       { titel: 'Einstellung',      sperre_min: 360, nachts: false, prio: 3 },
    wallbox:      { titel: 'Wallbox',          sperre_min: 0,   nachts: true,  prio: 3 },
    tagesbericht: { titel: 'Tagesbericht',     sperre_min: 0,   nachts: true,  prio: 2 },
    sonst:        { titel: 'Radler-EMS',       sperre_min: 60,  nachts: false, prio: 3 },
};

function zahl(name, std) { const n = parseFloat(env.get(name)); return isNaN(n) ? std : n; }
function stundeBerlin(t) {
    return parseInt(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(t), 10);
}

const e = msg.meldung;
if (!e || !e.text) return null;
const art = typeof e.melden === 'string' && KATALOG[e.melden] ? e.melden : 'sonst';
const k = KATALOG[art];
const jetzt = Date.now();

// Sperrzeit: gleiche Meldung (Zahlen zählen nicht als Unterschied) höchstens einmal je Sperrzeit
const schluessel = art + ':' + e.text.replace(/[-+]?\d+([.,]\d+)?/g, '#');
const gesendet = context.get('gesendet') || {};
for (const s of Object.keys(gesendet)) if (jetzt - gesendet[s] > 86400000) delete gesendet[s];
if (k.sperre_min > 0 && gesendet[schluessel] && jetzt - gesendet[schluessel] < k.sperre_min * 60000) {
    node.status({ fill: 'grey', shape: 'ring', text: 'gesperrt: ' + e.text.slice(0, 40) });
    return null;
}

// Nachtruhe: nur Fehler und Arten mit nachts: true gehen raus
const h = stundeBerlin(jetzt);
const von = zahl('MELDUNG_RUHE_VON', 22), bis = zahl('MELDUNG_RUHE_BIS', 7);
const ruhe = von > bis ? (h >= von || h < bis) : (h >= von && h < bis);
if (ruhe && !k.nachts && e.stufe !== 'fehler') {
    const nacht = global.get('meldung_nacht') || [];
    if (!nacht.some(x => x.schluessel === schluessel)) nacht.push({ zeit: e.zeit, text: e.text, schluessel });
    global.set('meldung_nacht', nacht.slice(-50));
    node.status({ fill: 'blue', shape: 'ring', text: 'Nachtruhe, wartet: ' + e.text.slice(0, 40) });
    return [null, { log: { stufe: 'info', bereich: 'meldung', text: 'Meldung wartet (Nachtruhe): ' + e.text } }];
}

gesendet[schluessel] = jetzt;
context.set('gesendet', gesendet);

const topic = env.get('NTFY_TOPIC');
if (!topic) {
    node.status({ fill: 'grey', shape: 'dot', text: 'kein Kanal (NTFY_TOPIC leer): ' + e.text.slice(0, 40) });
    return [null, { log: { stufe: 'info', bereich: 'meldung', text: 'Meldung ohne Kanal: ' + e.text } }];
}
const server = (env.get('NTFY_SERVER') || 'https://ntfy.sh').replace(/\/$/, '');
node.status({ fill: 'green', shape: 'dot', text: 'gesendet: ' + e.text.slice(0, 40) });
return [
    {
        url: server, method: 'POST', headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ topic, title: 'Radler-EMS: ' + k.titel, message: e.text, priority: k.prio }),
    },
    { log: { stufe: 'info', bereich: 'meldung', text: `Meldung gesendet (${art}): ${e.text}` } },
];
