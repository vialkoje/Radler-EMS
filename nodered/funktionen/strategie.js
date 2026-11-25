// ⚡ EMS-Strategie (alle 15 min): Netzladen (Vorschau), Wasserlinie, Plan für Wallbox und Wärmepumpe
// Übernommen aus Haus-EMS (docs/ems.md), vereinfacht auf eine PV-Batterie.
// ─ Eingang: Inject alle 15 min (und 20 s nach dem Start)
// ─ Ausgang 1: InfluxDB-Punkt (Bucket ems, Messreihe "ems_strategie")
// ─ Ausgang 2: msg.log, nur bei geänderter Entscheidung
// ─ Liest: global.abbild (batterie.soc_pct, netz.bezug_W, wallbox.leistung_W, markt.preise, prognose.pv),
//          global.ems_lastprofil, global.ems_live
// ─ Schreibt: global.ems_nl (Netzladen), global.ems_wl (Wasserlinie), global.ems_plan (Preise für Wallbox und
//            Wärmepumpe), global.ems_haus (teuer: Strom jetzt teurer als bis zur nächsten Sonne)
// ─ Umgebung: BATTERIE_KAPAZITAET_WH, BATTERIE_MAX_W, BATTERIE_MIN_SOC, LAST_STANDARD_W,
//             NL_MODUS, NL_WIRKUNGSGRAD, NL_AUFSCHLAG_CT, NL_LAST_FAKTOR, NL_PV_FAKTOR, NL_MIN_KWH, NL_SOC_MAX, NL_LEISTUNG_W,
//             WL_MODUS, WL_RESERVE, WL_LETZTE_H, WL_PV_FAKTOR

const jetzt = Date.now();
const abbild = global.get('abbild') || {};
function wert(s, maxS) { const e = abbild[s]; return e && jetzt - e.zeit <= maxS * 1000 ? e.wert : null; }
function zahl(n, std) { const v = parseFloat(env.get(n)); return isNaN(v) ? std : v; }
function text(n, std) { const v = env.get(n); return v === undefined || v === null || v === '' ? std : String(v); }
const stunde = t => parseInt(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(t), 10);
const kWh = wh => (wh / 1000).toFixed(1).replace('.', ',');
const ct = x => x.toFixed(1).replace('.', ',');

const cap = zahl('BATTERIE_KAPAZITAET_WH', 10000);
const maxW = zahl('BATTERIE_MAX_W', 5000);
const socMin = zahl('BATTERIE_MIN_SOC', 10);
const soc = wert('batterie.soc_pct', 300);
const netz = wert('netz.bezug_W', 600);
const wb = wert('wallbox.leistung_W', 600) || 0;
const live = global.get('ems_live');
const liveFrisch = live && jetzt - live.zeit < 120000;

// Preise ab der laufenden Stunde (Endpreis inkl. Abgaben), höchstens 3 h alt
const h0 = Math.floor(jetzt / 3600000) * 3600000;
const preisE = abbild['markt.preise'];
const preise = (preisE && jetzt - preisE.zeit < 3 * 3600000 ? preisE.wert : []).filter(p => p.t >= h0);
const preisJetzt = preise.length && preise[0].t === h0 ? preise[0].ct : null;
const mittel = preise.length ? preise.reduce((a, p) => a + p.ct, 0) / preise.length : null;
const preisZu = t => { const p = preise.find(x => x.t === t); return p ? p.ct : mittel; };

// PV-Prognose (W je Stunde) und Lastprofil (W je Uhrzeit, ohne Auto)
const progE = abbild['prognose.pv'];
const prog = {};
if (progE && jetzt - progE.zeit < 6 * 3600000) for (const x of progE.wert) prog[x.t] = x.W;
const hatPrognose = Object.keys(prog).length > 0;
const pvH = t => prog[t] || 0;
const profil = global.get('ems_lastprofil');
const lastStd = zahl('LAST_STANDARD_W', 500);
const last = t => (profil ? profil.werte[stunde(t)] : lastStd);
const uhr = t => stunde(t) + ' Uhr';
const ueberschussJetzt = liveFrisch ? live.ueberschuss_W : (netz !== null ? Math.max(0, -netz) : 0);

// ───────────── 1. Netzladen: Vorschau ─────────────
// „Fehlt dem Akku Energie, bevor der Strom wieder billiger wird?“ (Haus-EMS seit 9.11.2026)
const NL = {
    modus: text('NL_MODUS', 'vorschau'), eta: zahl('NL_WIRKUNGSGRAD', 0.85), auf: zahl('NL_AUFSCHLAG_CT', 4),
    lastF: zahl('NL_LAST_FAKTOR', 1.2), pvF: zahl('NL_PV_FAKTOR', 0.9), minWh: zahl('NL_MIN_KWH', 1) * 1000,
    socMax: zahl('NL_SOC_MAX', 95), leistung: zahl('NL_LEISTUNG_W', Math.min(maxW, 3000)),
};
let nlLaden = false, nlBedarf = 0, nlGrund;
if (NL.modus === 'aus') nlGrund = 'Netzladen aus';
else if (soc === null) nlGrund = 'Ladestand unbekannt';
else if (preisJetzt === null) nlGrund = 'keine Preise';
else if (ueberschussJetzt >= 150) nlGrund = `PV-Überschuss ${Math.round(ueberschussJetzt)} W`;
else {
    const etaL = Math.sqrt(NL.eta), etaE = Math.sqrt(NL.eta); // je Richtung
    const voll = (100 - socMin) / 100 * cap;
    let inhalt = Math.max(0, (soc - socMin) / 100 * cap);
    // Grenze: eine Stunde lohnt nur, wenn sie nach Verlusten plus Aufschlag (Abstand, Verschleiß) teurer ist
    const grenze = preisJetzt / NL.eta + NL.auf;
    let erste = null, ende = 'nichts fehlt in 24 h', maxNichtLohnend = null;
    for (let i = 0; i < 24; i++) {
        const t = h0 + i * 3600000;
        const anteil = i === 0 ? (h0 + 3600000 - jetzt) / 3600000 : 1;
        const preis = preisZu(t);
        if (i > 0 && preis < preisJetzt - 0.5) { ende = `billiger in ${i} h (${ct(preis)} ct)`; break; }
        const netto = (pvH(t) * NL.pvF - last(t) * NL.lastF) * anteil;
        if (netto > 0) {
            inhalt = Math.min(voll, inhalt + netto * etaL);
            if (i > 0 && inhalt >= voll * 0.99) { ende = `Sonne füllt den Akku in ${i} h`; break; }
            continue;
        }
        const braucht = Math.min(-netto, maxW * anteil);
        const aus = Math.min(inhalt * etaE, braucht);
        inhalt -= aus / etaE;
        const fehl = braucht - aus;
        if (fehl > 1) {
            if (preis >= grenze) { nlBedarf += fehl; if (erste === null) erste = t; }
            else maxNichtLohnend = Math.max(maxNichtLohnend === null ? 0 : maxNichtLohnend, preis);
        }
    }
    const frei = Math.max(0, (NL.socMax - soc) / 100 * cap);
    if (nlBedarf <= 0) {
        nlGrund = maxNichtLohnend !== null
            ? `fehlt, lohnt nicht (höchstens ${ct(maxNichtLohnend)} < ${ct(grenze)} ct); ${ende}` : ende;
    } else if (nlBedarf < NL.minWh) nlGrund = `${kWh(nlBedarf)} kWh fehlen, weniger als ${kWh(NL.minWh)} kWh`;
    else if (frei < NL.minWh) nlGrund = `Akku fast voll (frei ${kWh(frei)} kWh)`;
    else {
        nlLaden = true;
        nlGrund = `Vorschau: es fehlen ${kWh(nlBedarf)} kWh in Stunden ≥ ${ct(grenze)} ct, fehlt ab ${uhr(erste)}` +
            (ende !== 'nichts fehlt in 24 h' ? `, dann ${ende}` : '');
        // Auto und Akku nicht gleichzeitig: gibt es vor der ersten Fehlstunde genug Stunden, die höchstens
        // 1 ct teurer sind als jetzt, wartet der Akku (Haus-EMS seit 12.11.2026)
        if (wb > 5000) {
            const noetig = Math.ceil(Math.min(nlBedarf, frei) / NL.leistung);
            const andere = preise.filter(p => p.t > h0 && p.t < erste && p.ct <= preisJetzt + 1).sort((a, b) => a.ct - b.ct);
            if (andere.length >= noetig) {
                nlLaden = false;
                nlGrund = `Auto lädt (${kWh(wb)} kW), Akku lädt später (${andere.slice(0, noetig).map(p => uhr(p.t)).join(', ')})`;
            }
        }
    }
}
const nl = {
    laden: NL.modus === 'vorschau' && nlLaden, berechnet: nlLaden, modus: NL.modus, bedarf_Wh: Math.round(nlBedarf),
    leistung_W: NL.leistung, grund: nlGrund, zeit: jetzt, bis: jetzt + 20 * 60000,
};
global.set('ems_nl', nl);

// ───────────── 2. Wasserlinie (Spitzenkappung) ─────────────
// Dieselbe Energie in den Akku, aber aus der Mittagsspitze: Ladeleistung = Überschuss über der Schwelle T
const WL = { modus: text('WL_MODUS', 'beobachten'), reserve: zahl('WL_RESERVE', 1.0), letzteH: zahl('WL_LETZTE_H', 1),
    pvF: zahl('WL_PV_FAKTOR', 1.0) };
let wlT = 0, wlGrund, wlBedarf = 0, wlErwartet = 0, wlKorr = 1;
if (WL.modus === 'aus') wlGrund = 'aus';
else if (soc === null) wlGrund = 'Ladestand unbekannt';
else if (!hatPrognose) wlGrund = 'keine Prognose';
else {
    const ue = [];
    for (let i = 0; i < 12; i++) {
        const t = h0 + i * 3600000;
        ue.push({ t, W: Math.max(0, pvH(t) * WL.pvF - last(t)), anteil: i === 0 ? (h0 + 3600000 - jetzt) / 3600000 : 1 });
    }
    // Tageskorrektur: bleibt der echte Überschuss hinter der Erwartung, wird der Rest kleiner angesetzt
    if (liveFrisch && ue[0].W > 300) wlKorr = Math.min(1, Math.max(0.3, live.ueberschuss_W / ue[0].W));
    for (const x of ue) x.W *= wlKorr;
    wlBedarf = (100 - soc) / 100 * cap / 0.95 * WL.reserve;
    wlErwartet = ue.reduce((a, x) => a + Math.min(x.W, maxW) * x.anteil, 0);
    const mitUe = ue.filter(x => x.W > 200);
    if (wlBedarf < 100) wlGrund = 'Akku voll';
    else if (!mitUe.length) wlGrund = 'kein Überschuss erwartet';
    else if (mitUe.length <= WL.letzteH) wlGrund = 'letzte Stunde mit Überschuss';
    else if (wlErwartet <= wlBedarf) wlGrund = 'zu wenig Sonne erwartet';
    else {
        const menge = T => ue.reduce((a, x) => a + Math.min(Math.max(x.W - T, 0), maxW) * x.anteil, 0);
        let lo = 0, hi = Math.max(...ue.map(x => x.W));
        for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (menge(mid) >= wlBedarf) lo = mid; else hi = mid; }
        wlT = Math.floor(lo / 50) * 50;
        wlGrund = `Akku braucht ${kWh(wlBedarf)} kWh, erwartet ${kWh(wlErwartet)} kWh`;
    }
}
const wl = { T_W: wlT, modus: WL.modus, grund: wlGrund, bedarf_Wh: Math.round(wlBedarf), erwartet_Wh: Math.round(wlErwartet),
    korrektur: +wlKorr.toFixed(2), zeit: jetzt };
global.set('ems_wl', wl);

// ───────────── 3. Plan für Wallbox und Wärmepumpe ─────────────
let sonneAb = null;
for (let i = 1; i < 24; i++) { const t = h0 + i * 3600000; if (pvH(t) * 0.9 >= last(t)) { sonneAb = t; break; } }
const bisSonne = preise.filter(p => p.t >= h0 && (sonneAb === null || p.t < sonneAb));
const mittelBisSonne = bisSonne.length ? bisSonne.reduce((a, p) => a + p.ct, 0) / bisSonne.length : null;
const teuer = preisJetzt !== null && mittelBisSonne !== null && preisJetzt > mittelBisSonne;
global.set('ems_haus', { teuer, mittel_bis_sonne_ct: mittelBisSonne, zeit: jetzt });
let pv12 = 0;
for (let i = 0; i < 12; i++) pv12 += pvH(h0 + i * 3600000);
global.set('ems_plan', { zeit: jetzt, preise, preis_jetzt: preisJetzt, mittel, pv12h_Wh: Math.round(pv12), ohne_preise: !preise.length });

// ───────────── Protokoll und Log ─────────────
const fields = {
    nl_laden: nl.laden ? 1 : 0, nl_berechnet: nlLaden ? 1 : 0, nl_bedarf_Wh: nl.bedarf_Wh, nl_grund: nlGrund, nl_modus: NL.modus,
    wl_T_W: wlT, wl_bedarf_Wh: wl.bedarf_Wh, wl_erwartet_Wh: wl.erwartet_Wh, wl_grund: wlGrund, wl_modus: WL.modus,
    wl_korrektur: wl.korrektur, haus_teuer: teuer ? 1 : 0, pv12h_Wh: Math.round(pv12),
    lastprofil_tage: profil ? profil.tage : 0,
};
if (preisJetzt !== null) fields.preis_ct = preisJetzt;
if (mittel !== null) fields.mittel_ct = +mittel.toFixed(2);
if (soc !== null) fields.soc = soc;

const logs = [];
const vorher = context.get('vorher') || {};
if (vorher.nl !== nlLaden) {
    logs.push({ log: { stufe: 'info', bereich: 'ems',
        text: (nlLaden ? 'Netzladen ' + (nl.laden ? 'startet' : '(nur berechnet, NL_MODUS=' + NL.modus + ')') : 'kein Netzladen') + ': ' + nlGrund,
        daten: { soc, preis_ct: preisJetzt, bedarf_Wh: nl.bedarf_Wh } } });
}
if ((vorher.wl > 0) !== (wlT > 0)) {
    logs.push({ log: { stufe: 'info', bereich: 'ems',
        text: wlT > 0 ? `Wasserlinie ${wlT} W (${WL.modus}): ${wlGrund}` : `Wasserlinie aus: ${wlGrund}` } });
}
context.set('vorher', { nl: nlLaden, wl: wlT });

node.status({ fill: nl.laden ? 'blue' : 'green', shape: 'dot',
    text: `${preisJetzt !== null ? ct(preisJetzt) + ' ct' : 'ohne Preis'} · SoC ${soc ?? '–'} % · NL: ${nlLaden ? 'laden' : 'nein'} · WL ${wlT} W` });
return [{ payload: [{ measurement: 'ems_strategie', tags: { quelle: 'ems' }, fields, timestamp: new Date(jetzt) }] },
        logs.length ? logs : null];
