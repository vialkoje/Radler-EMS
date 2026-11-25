// ⚡ EMS-Ausführung (alle 10 s): einziger Schreiber an die PV-Batterie
// Übernommen aus Haus-EMS (docs/ems.md, „Ausführung“), für eine Batterie, die sich selbst auf Eigenverbrauch regelt.
// ─ Eingang: Inject alle 10 s
// ─ Ausgang 1: Befehl an die Batterie (msg.befehl) → Link „Befehl Batterie“, nur bei Änderung oder alle 60 s
// ─ Ausgang 2: InfluxDB-Punkt (Bucket ems, Messreihe "ems_ausfuehrung"), alle 30 s und bei Änderung
// ─ Ausgang 3: msg.log bei geändertem Modus
// ─ Liest: global.abbild, global.ems_nl, global.ems_wl, global.ems_haus, global.wallbox_plan
// ─ Schreibt: global.ems_live (Überschuss, Mittel 5 min; für die Wärmepumpe),
//            global.ems_ueberschuss (für das PV-Laden des Autos, Mittel 1 min)
// ─ Umgebung: EMS_MODUS (aus | beobachten | aktiv), HA_MODUS, BATTERIE_MAX_W, BATTERIE_VOLL_SOC
//
// Befehle an die Batterie (docs/geraete-adapter.md):
//   { modus: 'eigenverbrauch' }                                   Gerät regelt selbst auf 0 W am Netz
//   { modus: 'laden', leistung_W }                                aus dem Netz laden (Netzladen)
//   { modus: 'begrenzt', max_laden_W, max_entladen_W }            Eigenverbrauch mit Grenzen (null = keine)
// Rangfolge: Netzladen → Auto lädt → Wasserlinie → Eigenverbrauch

const jetzt = Date.now();
const abbild = global.get('abbild') || {};
function wert(s, maxS) { const e = abbild[s]; return e && jetzt - e.zeit <= maxS * 1000 ? e.wert : null; }
function zahl(n, std) { const v = parseFloat(env.get(n)); return isNaN(v) ? std : v; }
function text(n, std) { const v = env.get(n); return v === undefined || v === null || v === '' ? std : String(v); }
function mittel(schluessel, wert, fensterMs) {
    // gleitendes Mittel im Knotenkontext
    const r = (context.get(schluessel) || []).filter(x => jetzt - x[0] <= fensterMs);
    r.push([jetzt, wert]);
    context.set(schluessel, r);
    return r.reduce((a, x) => a + x[1], 0) / r.length;
}
const rund100 = w => Math.max(0, Math.round(w / 100) * 100);

const modusEms = text('EMS_MODUS', 'beobachten');
const haModus = text('HA_MODUS', 'aktiv');
const maxW = zahl('BATTERIE_MAX_W', 5000);
const vollSoc = zahl('BATTERIE_VOLL_SOC', 99);

const netz = wert('netz.bezug_W', 60);           // > 0 Bezug, < 0 Einspeisung
const batt = wert('batterie.leistung_W', 60);    // > 0 Entladen, < 0 Laden
const soc = wert('batterie.soc_pct', 300);
const pv = wert('pv.leistung_W', 60) || 0;
const wb = wert('wallbox.leistung_W', 120) || 0;
const hausOhneAuto = wert('haus.ohne_auto_W', 60);

const plan = global.get('wallbox_plan');
const pvLaden = !!(plan && plan.regel === 'pv' && jetzt - plan.zeit < 180000);

let befehl, grund, S = 0, frei = 0;
if (modusEms === 'aus') {
    befehl = { modus: 'eigenverbrauch' }; grund = 'EMS aus';
} else if (netz === null || batt === null) {
    // Fail-Safe: ohne Messwerte regelt die Batterie selbst
    befehl = { modus: 'eigenverbrauch' }; grund = 'Fail-Safe: Messwerte fehlen';
} else {
    const einspeisung = Math.max(0, -netz);
    const battLaden = Math.max(0, -batt), battEntladen = Math.max(0, batt);
    // Überschuss: was eingespeist oder schon in den Akku geladen wird (+ Auto, wenn es mit PV lädt)
    S = einspeisung + battLaden + (pvLaden ? wb : 0);
    // frei: Einspeisung minus Akku-Entladung (Akku-Strom ist kein Überschuss), Bezug negativ
    frei = -netz - battEntladen;

    const nl = global.get('ems_nl');
    const wl = global.get('ems_wl');
    const haus = global.get('ems_haus');
    if (nl && nl.laden && jetzt < nl.bis) {
        befehl = { modus: 'laden', leistung_W: nl.leistung_W }; grund = 'Netzladen';
    } else if (wb > 1000) {
        // Auto lädt aus dem Netz, nicht aus dem Akku. Mit HA_MODUS=aktiv deckt der Akku den Hausverbrauch ohne
        // Auto (150 W Abstand), beim PV-Laden immer, sonst nur, wenn der Strom jetzt teuer ist.
        const hausDecken = haModus === 'aktiv' && (pvLaden || (haus && haus.teuer)) && hausOhneAuto !== null;
        if (hausDecken) {
            befehl = { modus: 'begrenzt', max_laden_W: null, max_entladen_W: rund100(hausOhneAuto - pv - 150) };
            grund = `Auto lädt, Akku deckt nur das Haus (${pvLaden ? 'PV-Laden' : 'Strom teuer'})`;
        } else {
            befehl = { modus: 'begrenzt', max_laden_W: null, max_entladen_W: 0 };
            grund = 'Auto lädt, Akku entlädt nicht';
        }
    } else if (wl && wl.modus === 'aktiv' && wl.T_W > 0 && jetzt - wl.zeit < 20 * 60000 && S >= 100) {
        befehl = { modus: 'begrenzt', max_laden_W: rund100(S - wl.T_W), max_entladen_W: null };
        grund = `Wasserlinie ${wl.T_W} W`;
    } else {
        befehl = { modus: 'eigenverbrauch' }; grund = 'Eigenverbrauch';
    }
}

// Überschuss für Wärmepumpe (5 min) und Auto (1 min)
const sMittel5 = mittel('s5', S, 300000);
const freiMittel5 = mittel('f5', frei, 300000);
global.set('ems_live', { ueberschuss_W: Math.round(sMittel5), frei_W: Math.round(freiMittel5),
    laden_W: Math.max(0, -(batt || 0)), soc, zeit: jetzt });
// Anteil des Akkus am Überschuss: was er (noch) aufnehmen darf. Der Rest geht ans Auto (300 W Abstand).
let akkuAnteil = soc !== null && soc < vollSoc ? Math.min(S, maxW) : 0;
if (befehl.modus === 'begrenzt' && befehl.max_laden_W !== null) akkuAnteil = Math.min(akkuAnteil, befehl.max_laden_W);
const autoW = mittel('a1', Math.max(0, S - akkuAnteil - 300), 60000);
global.set('ems_ueberschuss', { car_W: Math.round(autoW), zeit: jetzt });

// Senden: bei Änderung (Grenzen ab 100 W Unterschied) oder alle 60 s; im Modus beobachten nie
const letzter = context.get('letzter') || {};
const gleich = letzter.befehl && letzter.befehl.modus === befehl.modus &&
    ['leistung_W', 'max_laden_W', 'max_entladen_W'].every(k => {
        const a = letzter.befehl[k], b = befehl[k];
        return (a === undefined || a === null) ? (b === undefined || b === null) : (b !== null && b !== undefined && Math.abs(a - b) < 100);
    });
const senden = modusEms === 'aktiv' && (!gleich || jetzt - (letzter.gesendet || 0) >= 60000);
const out1 = senden ? { befehl: Object.assign({ grund, zeit: jetzt }, befehl) } : null;
if (senden) letzter.gesendet = jetzt;

const logs = [];
if (letzter.grund !== grund) {
    logs.push({ log: { stufe: grund.startsWith('Fail-Safe') ? 'fehler' : 'info', bereich: 'batterie',
        text: `Batterie: ${grund}` + (modusEms !== 'aktiv' ? ` (EMS_MODUS=${modusEms}, nicht gesendet)` : ''), daten: befehl } });
}
let out2 = null;
if (!gleich || letzter.grund !== grund || jetzt - (letzter.protokoll || 0) >= 30000) {
    letzter.protokoll = jetzt;
    const f = { modus: befehl.modus, grund, ueberschuss_W: Math.round(S), frei_W: Math.round(frei), auto_ueberschuss_W: Math.round(autoW),
        gesendet: senden ? 1 : 0 };
    for (const k of ['leistung_W', 'max_laden_W', 'max_entladen_W']) if (typeof befehl[k] === 'number') f[k] = befehl[k];
    out2 = { payload: [{ measurement: 'ems_ausfuehrung', tags: { quelle: 'ems' }, fields: f, timestamp: new Date(jetzt) }] };
}
letzter.befehl = befehl; letzter.grund = grund;
context.set('letzter', letzter);

const grenzen = befehl.modus === 'laden' ? ` ${befehl.leistung_W} W`
    : befehl.modus === 'begrenzt' ? ` laden ≤ ${befehl.max_laden_W ?? '∞'} W, entladen ≤ ${befehl.max_entladen_W ?? '∞'} W` : '';
node.status({ fill: modusEms === 'aktiv' ? 'green' : 'grey', shape: senden ? 'dot' : 'ring',
    text: `${grund}:${grenzen} · Überschuss ${Math.round(S)} W` + (modusEms !== 'aktiv' ? ` · ${modusEms}` : '') });
return [out1, out2, logs.length ? logs : null];
