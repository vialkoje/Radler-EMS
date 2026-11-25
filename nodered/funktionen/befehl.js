// Befehl verteilen (je Gerät, GERAET steht in der ersten Zeile, vom Generator eingesetzt)
// ─ Eingang: msg.befehl vom EMS (Batterie), von der Ladeplanung (Wallbox) oder der Wärmepumpen-Steuerung
// ─ Ausgang 1: an den Geräte-Adapter (nur wenn <GERÄT>_QUELLE = geraet)
// ─ Kontext: global.befehl_<geraet> = letzter Befehl (der Simulator liest ihn von dort)
//            global.abbild['befehl.<geraet>'] (zur Anzeige)
// ─ Umgebung: <GERÄT>_QUELLE: simulator (Standard) | geraet | aus

const QUELLE_VAR = { batterie: 'BATTERIE_QUELLE', wallbox: 'WALLBOX_QUELLE', wp: 'WP_QUELLE' }[GERAET];
const quelle = env.get(QUELLE_VAR) || 'simulator';
const b = msg.befehl;
if (!b) return null;
global.set('befehl_' + GERAET, b);
const abbild = global.get('abbild') || {};
abbild['befehl.' + GERAET] = { wert: b, einheit: '', zeit: Date.now(), quelle: 'ems' };
global.set('abbild', abbild);

const kurz = Object.entries(b).filter(([k]) => !['grund', 'zeit'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ');
node.status({ fill: quelle === 'aus' ? 'grey' : 'green', shape: 'dot', text: `${quelle}: ${kurz}` });
return quelle === 'geraet' ? msg : null;
