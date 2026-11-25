// 🧪 Simulator (alle 10 s): bildet PV, Batterie, Wallbox mit Auto und Wärmepumpe nach, solange die echten
// Geräte fehlen. Er folgt den Befehlen des EMS genau so, wie es ein echtes Gerät tun sollte.
// ─ Eingang: Inject alle 10 s
// ─ Ausgang 1: Messwerte (mehrere Nachrichten) → Link „→ Messwerte“, Quelle 'simulator'
// ─ Liest: global.befehl_batterie, global.befehl_wallbox, global.befehl_wp, global.abbild (prognose.pv, wetter.temperatur_C)
// ─ Umgebung: <GERÄT>_QUELLE (nur Geräte mit "simulator" werden simuliert), PV_FLAECHEN (kWp),
//             BATTERIE_KAPAZITAET_WH, BATTERIE_MAX_W, BATTERIE_MIN_SOC, WB_PHASEN, WB_MAX_A, WB_AKKU_KWH, SIM_ZUFALL
// Modell (bewusst einfach, Zahlen in docs/simulator.md):
//   PV        = Prognose der laufenden Stunde × Wolkenfaktor (Zufallsweg 0,5 … 1,05)
//   BKW       = Prognose des Balkonkraftwerks × Wolkenfaktor, höchstens BKW_MAX_W (nur mit BKW_QUELLE = simulator)
//   Haus      = Grundlast 250 W + Tagesprofil + gelegentliche Spitzen (Wasserkocher, Herd)
//   WP        = Gebäude mit 20 kWh/K Speicher und 0,15 kW/K Verlust; Heizlauf mit 1,8 kW el. (COP 3,5),
//               Warmwasser 6:30 und 18:30 je 30 min mit 2,2 kW; SG-Ready 3 / Anhebung hebt den Raumsollwert
//   Auto      = werktags 7:00–17:30 unterwegs (kommt mit −15 % zurück), Ladeziel im Auto 80 %
//   Batterie  = Wirkungsgrad 95 % je Richtung, folgt dem Befehl (eigenverbrauch, laden, begrenzt)
//   Netz      = Haus + WP + Wallbox − PV − Balkonkraftwerk − Batterie

const jetzt = Date.now();
const abbild = global.get('abbild') || {};
function zahl(n, std) { const v = parseFloat(env.get(n)); return isNaN(v) ? std : v; }
const sim = name => (env.get(name) || 'simulator') === 'simulator';
const stundeDez = t => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', minute: 'numeric',
        hourCycle: 'h23', weekday: 'short' }).formatToParts(t).map(x => [x.type, x.value]));
    return { h: +p.hour + +p.minute / 60, werktag: !['Sat', 'Sun'].includes(p.weekday) };
};
const zufall = (env.get('SIM_ZUFALL') || 'an') !== 'aus' ? Math.random : () => 0.5;

const s = context.get('s') || {
    zeit: jetzt, wolke: 0.9, soc: 50, raum: 21.0, wpLaeuft: false, autoSoc: 45, autoDa: true, spitzeBis: 0, spitzeW: 0,
};
const dtH = Math.min(60, Math.max(1, (jetzt - s.zeit) / 1000)) / 3600; // Stunden seit dem letzten Schritt
s.zeit = jetzt;
const { h, werktag } = stundeDez(jetzt);

// ── PV und Balkonkraftwerk ──
function ausPrognose(signal) {
    const prog = abbild[signal];
    if (!prog || !Array.isArray(prog.wert)) return 0;
    const h0 = Math.floor(jetzt / 3600000) * 3600000;
    const a = prog.wert.find(x => x.t === h0), b = prog.wert.find(x => x.t === h0 + 3600000);
    return a ? (b ? a.W + (b.W - a.W) * ((jetzt - h0) / 3600000) : a.W) : 0;
}
s.wolke = Math.min(1.05, Math.max(0.5, s.wolke + (zufall() - 0.5) * 0.08));
const pv = Math.max(0, Math.round((abbild['prognose.pv_anlage'] ? ausPrognose('prognose.pv_anlage') : ausPrognose('prognose.pv')) * s.wolke));
const simBkw = (env.get('BKW_QUELLE') || 'aus') === 'simulator';
const bkw = simBkw ? Math.max(0, Math.round(Math.min(zahl('BKW_MAX_W', 800), ausPrognose('prognose.bkw') * s.wolke))) : 0;

// ── Haus (ohne WP und Wallbox) ──
let haus = 250 + 50 * Math.sin(h / 24 * 2 * Math.PI);
if (h >= 6.5 && h < 8.5) haus += 400;
if (h >= 11.5 && h < 13) haus += 500;
if (h >= 17 && h < 22) haus += 600;
if (jetzt > s.spitzeBis && zufall() < 0.004) { s.spitzeBis = jetzt + (60 + zufall() * 240) * 1000; s.spitzeW = 1500 + zufall() * 1500; }
if (jetzt < s.spitzeBis) haus += s.spitzeW;
haus = Math.round(haus + (zufall() - 0.5) * 80);

// ── Wärmepumpe ──
const aussenE = abbild['wetter.temperatur_C'];
const aussen = aussenE && typeof aussenE.wert === 'number' ? aussenE.wert : 5;
const bwp = global.get('befehl_wp') || {};
const anhebung = typeof bwp.anhebung_K === 'number' ? bwp.anhebung_K : (bwp.sgready === 3 ? 1.5 : 0);
const raumSoll = 21 + anhebung;
const ww = (h >= 6.5 && h < 7) || (h >= 18.5 && h < 19);
let wpW = 0, wpStatus = 'aus';
if (sim('WP_QUELLE')) {
    if (aussen < 15) {
        if (!s.wpLaeuft && s.raum < raumSoll - 0.3) s.wpLaeuft = true;
        if (s.wpLaeuft && s.raum > raumSoll + 0.3) s.wpLaeuft = false;
    } else s.wpLaeuft = false;
    let waerme = 0;
    if (ww) { wpW = 2200; wpStatus = 'warmwasser'; }
    else if (s.wpLaeuft) { wpW = 1800; wpStatus = 'heizen'; waerme = 1.8 * 3.5; }
    s.raum += (waerme - 0.15 * (s.raum - aussen)) * dtH / 20;
    wpW = Math.round(wpW * (0.95 + zufall() * 0.1));
}

// ── Auto und Wallbox ──
const bwb = global.get('befehl_wallbox') || { modus: 'frei' };
const phasen = zahl('WB_PHASEN', 3), maxA = zahl('WB_MAX_A', 16), akkuKWh = zahl('WB_AKKU_KWH', 60);
let wbW = 0, wbStatus = 'getrennt';
if (sim('WALLBOX_QUELLE')) {
    const unterwegs = werktag && h >= 7 && h < 17.5;
    if (s.autoDa && unterwegs) s.autoDa = false;
    if (!s.autoDa && !unterwegs) { s.autoDa = true; s.autoSoc = Math.max(5, s.autoSoc - 15 - zufall() * 10); }
    if (s.autoDa) {
        wbStatus = 'angesteckt';
        if (bwb.modus === 'pause') wbStatus = 'pausiert';
        else if (s.autoSoc < 80) {
            const a = bwb.modus === 'strom' ? Math.min(maxA, bwb.ampere || 6) : maxA;
            wbW = Math.round(a * 230 * phasen * (0.97 + zufall() * 0.03));
            wbStatus = 'laedt';
            s.autoSoc = Math.min(80, s.autoSoc + wbW / 1000 * dtH * 0.9 / akkuKWh * 100);
        }
    }
}

// ── Batterie ──
const cap = zahl('BATTERIE_KAPAZITAET_WH', 10000), maxW = zahl('BATTERIE_MAX_W', 5000), socMin = zahl('BATTERIE_MIN_SOC', 10);
const bb = global.get('befehl_batterie') || { modus: 'eigenverbrauch' };
const befehlAlt = !bb.zeit || jetzt - bb.zeit > 5 * 60000; // Timeout: ohne neuen Befehl zurück in den Eigenverbrauch
const modus = befehlAlt ? 'eigenverbrauch' : bb.modus;
const bedarf = haus + wpW + wbW - pv - bkw; // > 0 Defizit, < 0 Überschuss
let batt = 0; // > 0 Entladen, < 0 Laden
if (sim('BATTERIE_QUELLE')) {
    if (modus === 'laden') batt = -Math.min(maxW, bb.leistung_W || maxW);
    else {
        batt = Math.max(-maxW, Math.min(maxW, bedarf));
        if (modus === 'begrenzt') {
            if (batt > 0 && typeof bb.max_entladen_W === 'number') batt = Math.min(batt, bb.max_entladen_W);
            if (batt < 0 && typeof bb.max_laden_W === 'number') batt = Math.max(batt, -bb.max_laden_W);
        }
    }
    if (batt > 0 && s.soc <= socMin) batt = 0;
    if (batt < 0 && s.soc >= 100) batt = 0;
    const wh = batt > 0 ? batt * dtH / 0.95 : batt * dtH * 0.95;
    s.soc = Math.min(100, Math.max(0, s.soc - wh / cap * 100));
    batt = Math.round(batt);
}
const netz = Math.round(haus + wpW + wbW - pv - bkw - batt);
context.set('s', s);

const msgs = [];
const m = (geraet, quelleVar, payload) => { if (sim(quelleVar)) msgs.push({ geraet, quelle: 'simulator', payload, zeit: jetzt }); };
m('pv', 'PV_QUELLE', { leistung_W: pv });
if (simBkw) msgs.push({ geraet: 'bkw', quelle: 'simulator', payload: { leistung_W: bkw }, zeit: jetzt });
m('batterie', 'BATTERIE_QUELLE', { soc_pct: +s.soc.toFixed(1), leistung_W: batt, modus });
m('wallbox', 'WALLBOX_QUELLE', { leistung_W: wbW, status: wbStatus, ampere: wbW ? Math.round(wbW / 230 / phasen) : 0 });
m('auto', 'AUTO_QUELLE', { soc_pct: +s.autoSoc.toFixed(1) });
m('wp', 'WP_QUELLE', { leistung_W: wpW, status: wpStatus, raum_C: +s.raum.toFixed(2), aussen_C: aussen });
m('netz', 'NETZ_QUELLE', { bezug_W: netz }); // zuletzt, damit die Hausbilanz alle Werte dieses Schritts sieht
node.status({ fill: 'blue', shape: 'dot',
    text: `PV ${pv}${simBkw ? ' + BKW ' + bkw : ''} · Haus ${haus} · WP ${wpW} · Auto ${wbW} (${Math.round(s.autoSoc)} %) · Akku ${batt} (${s.soc.toFixed(0)} %) · Netz ${netz} W` });
return [msgs];
