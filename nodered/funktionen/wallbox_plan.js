// 🚗 Ladeplanung (jede Minute): Wallbox frei, Pause oder PV-Laden mit Strom in Ampere
// Übernommen aus Haus-EMS (docs/wallbox.md): bis 25 % sofort, 50 % sicher zur Abfahrt, bis 80 % nur in
// günstigen Stunden, darüber frei (Ladeziel im Auto); dazu PV-Laden mit dem Überschuss nach dem Hausakku.
// ─ Eingang: Inject jede Minute
// ─ Ausgang 1: Befehl an die Wallbox (msg.befehl = { modus: 'frei' | 'pause' | 'strom', ampere? }) → Link „Befehl Wallbox“
// ─ Ausgang 2: InfluxDB-Punkt (Bucket ems, Messreihe "wallbox_plan")
// ─ Ausgang 3: msg.log (Regelwechsel, Laden gestartet/pausiert/beendet, Zusage in Gefahr)
// ─ Liest: global.abbild (auto.soc_pct, wallbox.status, wallbox.leistung_W), global.ems_plan, global.ems_ueberschuss
// ─ Schreibt: global.wallbox_plan = { regel, befehl, zeit } (für die EMS-Ausführung)
// ─ Umgebung: WB_MODUS, WB_STRATEGIE, WB_ABFAHRT, WB_ABFAHRT_TAGE, WB_SOFORT_SOC, WB_PFLICHT_SOC, WB_ZIEL_SOC,
//             WB_AKKU_KWH, WB_WIRKUNGSGRAD, WB_PHASEN, WB_MAX_A, WB_MIN_A, WB_SOC_MAX_ALTER_MIN, WB_TEUER_ANTEIL,
//             WB_PV_MODUS, WB_PV_MIN_KW, WB_PV_HALT_KW, WB_MELDUNGEN

const jetzt = Date.now();
const abbild = global.get('abbild') || {};
function wert(s, maxS) { const e = abbild[s]; return e && jetzt - e.zeit <= maxS * 1000 ? e.wert : null; }
function zahl(n, std) { const v = parseFloat(env.get(n)); return isNaN(v) ? std : v; }
function text(n, std) { const v = env.get(n); return v === undefined || v === null || v === '' ? std : String(v); }
const fmt = (x, n = 1) => x.toFixed(n).replace('.', ',');
const stunde = t => parseInt(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(t), 10);
const wochentag = t => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(t)) + 1; // 1 = Montag

const modus = text('WB_MODUS', 'beobachten');
const strategie = text('WB_STRATEGIE', 'plan');
const SOFORT = zahl('WB_SOFORT_SOC', 25), PFLICHT = zahl('WB_PFLICHT_SOC', 50), ZIEL = zahl('WB_ZIEL_SOC', 80);
const akkuKWh = zahl('WB_AKKU_KWH', 60), eta = zahl('WB_WIRKUNGSGRAD', 0.9);
const phasen = zahl('WB_PHASEN', 3), maxA = zahl('WB_MAX_A', 16), minA = zahl('WB_MIN_A', 6);
const wJeA = phasen * 230;
const ladeKW = maxA * wJeA / 1000;
const teuerAnteil = zahl('WB_TEUER_ANTEIL', 0.5);
const abfahrtH = parseInt(text('WB_ABFAHRT', '06:00').split(':')[0], 10);
const abfahrtTage = text('WB_ABFAHRT_TAGE', '1,2,3,4,5').split(',').map(s => parseInt(s, 10));

const soc = wert('auto.soc_pct', zahl('WB_SOC_MAX_ALTER_MIN', 90) * 60);
const status = wert('wallbox.status', 300);
const leistung = wert('wallbox.leistung_W', 300);
const angesteckt = ['angesteckt', 'laedt', 'pausiert'].includes(status);

// Preise ab der laufenden Stunde (Plan des EMS, höchstens 20 min alt)
const h0 = Math.floor(jetzt / 3600000) * 3600000;
const plan = global.get('ems_plan');
const preise = plan && jetzt - plan.zeit < 20 * 60000 ? (plan.preise || []).filter(p => p.t >= h0) : [];

// nächste Abfahrt: erste volle Stunde WB_ABFAHRT an einem Abfahrtstag
let abfahrt = null;
for (let i = 1; i <= 8 * 24; i++) {
    const t = h0 + i * 3600000;
    if (stunde(t) === abfahrtH && abfahrtTage.includes(wochentag(t))) { abfahrt = t; break; }
}
const stundenFuer = pp => Math.ceil(Math.max(0, pp) / 100 * akkuKWh / eta / ladeKW);
const uhr = t => stunde(t) + ' Uhr';

// Stunden bis zur Abfahrt mit Preis (unbekannte Stunden mit dem Mittel der bekannten)
const mittelPreis = preise.length ? preise.reduce((a, p) => a + p.ct, 0) / preise.length : null;
const bisAbfahrt = [];
if (abfahrt) for (let t = h0; t < abfahrt; t += 3600000) {
    const p = preise.find(x => x.t === t);
    bisAbfahrt.push({ t, ct: p ? p.ct : mittelPreis, bekannt: !!p });
}
const teuerste = (liste, anteil) => {
    const n = Math.floor(liste.length * anteil);
    return new Set(liste.slice().sort((a, b) => b.ct - a.ct).slice(0, n).map(x => x.t));
};
const billigsteN = (liste, n) => new Set(liste.slice().sort((a, b) => a.ct - b.ct || a.t - b.t).slice(0, n).map(x => x.t));

let regel, frei, grund, bedarfKWh = 0, noetig = 0;
if (!preise.length) {
    regel = 'ohne_preise'; frei = true; grund = 'keine Preise: frei (lieber laden als stehen bleiben)';
} else if (soc === null || strategie === 'sperre') {
    // Regel „teuerste Stunden“: Ladestand unbekannt oder so eingestellt
    const teuer = teuerste(preise, teuerAnteil).has(h0);
    regel = 'sperre'; frei = !teuer;
    grund = (soc === null ? 'Ladestand unbekannt, ' : '') + (teuer ? 'teure Stunde: Pause' : 'keine teure Stunde: frei');
} else if (soc < SOFORT) {
    regel = 'sofort'; frei = true; grund = `bis ${SOFORT} %: sofort`;
} else if (soc >= ZIEL) {
    regel = 'frei'; frei = true; grund = `ab ${ZIEL} %: Ladeziel im Auto entscheidet`;
} else {
    bedarfKWh = (ZIEL - soc) / 100 * akkuKWh / eta;
    const nZiel = stundenFuer(ZIEL - soc);
    const guenstig = bisAbfahrt.filter(x => !teuerste(bisAbfahrt, teuerAnteil).has(x.t));
    const zielStunden = billigsteN(guenstig, nZiel);
    if (soc < PFLICHT) {
        noetig = stundenFuer(PFLICHT - soc);
        if (bisAbfahrt.length <= noetig) { regel = 'pflicht'; frei = true; grund = `bis ${PFLICHT} %: Zeit reicht knapp, sofort`; }
        else if (billigsteN(bisAbfahrt, noetig).has(h0)) { regel = 'pflicht'; frei = true; grund = `bis ${PFLICHT} % zur Abfahrt: günstige Stunde (${noetig} h nötig)`; }
        else if (zielStunden.has(h0)) { regel = 'ziel'; frei = true; grund = `bis ${ZIEL} %: günstige Stunde (${nZiel} h)`; }
        else { regel = 'pflicht'; frei = false; grund = `warten auf günstige Stunde (${noetig} h bis ${PFLICHT} %, Abfahrt ${uhr(abfahrt)})`; }
    } else {
        noetig = nZiel;
        if (zielStunden.has(h0)) { regel = 'ziel'; frei = true; grund = `bis ${ZIEL} %: günstige Stunde (${nZiel} h)`; }
        else { regel = 'ziel'; frei = false; grund = `warten auf günstige Stunde (${nZiel} h bis ${ZIEL} %)`; }
    }
}

// PV-Laden: würde das Auto gerade nicht laden, steckt aber und ist unter dem Ziel → mit dem Überschuss laden
const pvModus = text('WB_PV_MODUS', 'aktiv');
const ue = global.get('ems_ueberschuss');
const ueW = ue && jetzt - ue.zeit < 120000 ? ue.car_W : 0;
const pv = context.get('pv') || { aktiv: false, ueber: 0, unter: 0, ampere: 0, geaendert: 0 };
const pvMoeglich = !frei && angesteckt && (soc === null || soc < ZIEL) && pvModus !== 'aus';
if (pvMoeglich) {
    pv.ueber = ueW >= zahl('WB_PV_MIN_KW', 4.2) * 1000 ? pv.ueber + 1 : 0;
    pv.unter = ueW < zahl('WB_PV_HALT_KW', 3.6) * 1000 ? pv.unter + 1 : 0;
    if (!pv.aktiv && pv.ueber >= 2) { pv.aktiv = true; pv.geaendert = 0; }
    if (pv.aktiv && pv.unter >= 2) pv.aktiv = false;
} else { pv.aktiv = false; pv.ueber = 0; pv.unter = 0; }
let befehl;
if (pv.aktiv) {
    // Ampere dem Überschuss nachführen, höchstens alle 2 min (schont Wallbox und Auto).
    // ems_ueberschuss enthält beim PV-Laden die Ladeleistung des Autos schon (EMS-Ausführung).
    const ziel = Math.min(maxA, Math.max(minA, Math.floor(ueW / wJeA)));
    if (!pv.ampere || jetzt - pv.geaendert >= 120000) { if (ziel !== pv.ampere) pv.geaendert = jetzt; pv.ampere = ziel; }
    befehl = { modus: 'strom', ampere: pv.ampere };
    regel = 'pv'; grund = `PV-Überschuss ${fmt(ueW / 1000)} kW (${pv.ampere} A)`;
} else {
    pv.ampere = 0;
    befehl = frei ? { modus: 'frei' } : { modus: 'pause' };
}
context.set('pv', pv);
const effektivModus = pvModus === 'aktiv' ? befehl : (frei ? { modus: 'frei' } : { modus: 'pause' });
global.set('wallbox_plan', { regel: effektivModus.modus === 'strom' ? 'pv' : regel, befehl: effektivModus, grund, zeit: jetzt });

// Senden: bei Änderung und alle 15 min, nur im Modus aktiv
const st = context.get('st') || {};
const geaendert = JSON.stringify(st.befehl) !== JSON.stringify(effektivModus);
const senden = modus === 'aktiv' && (geaendert || jetzt - (st.gesendet || 0) >= 15 * 60000);
if (senden) st.gesendet = jetzt;

// Meldungen: Laden gestartet (3 min > 1 kW), pausiert (Sperre greift, Auto steckt), beendet (3 min nichts, mit kWh)
const logs = [];
const melden = text('WB_MELDUNGEN', 'an') === 'an' && modus === 'aktiv' ? 'wallbox' : undefined;
const lv = st.lv || { laedt: false, ueber: 0, unter: 0, energie_Wh: 0, start: 0 };
const fliesst = (leistung || 0) > 1000;
if (lv.laedt || fliesst) lv.energie_Wh += Math.max(0, leistung || 0) / 60;
lv.ueber = fliesst ? lv.ueber + 1 : 0;
lv.unter = fliesst ? 0 : lv.unter + 1;
const socText = (soc !== null ? ` · Auto ${Math.round(soc)} %` : '') + (modus !== 'aktiv' ? ` (WB_MODUS=${modus}, Plan nicht gesendet)` : '');
if (!lv.laedt && lv.ueber >= 3) {
    lv.laedt = true; lv.start = lv.start || jetzt - 3 * 60000;
    logs.push({ log: { stufe: 'info', bereich: 'wallbox', melden, text: `🔌 Wallbox: Laden gestartet – Regel: ${grund}${socText}` } });
} else if (lv.laedt && lv.unter >= 3) {
    lv.laedt = false;
    if (!(befehl.modus === 'pause' && angesteckt)) {
        const dauer = Math.round((jetzt - lv.start) / 60000);
        logs.push({ log: { stufe: 'info', bereich: 'wallbox', melden,
            text: `✅ Wallbox: Laden beendet – ${angesteckt ? 'vom Auto' : 'abgesteckt'}${socText} · geladen ${fmt(lv.energie_Wh / 1000)} kWh in ${Math.floor(dauer / 60)} h ${dauer % 60} min` } });
        lv.energie_Wh = 0; lv.start = 0;
    }
}
if (!angesteckt && !lv.laedt) { lv.energie_Wh = 0; lv.start = 0; }
if (geaendert && st.befehl && effektivModus.modus === 'pause' && angesteckt) {
    logs.push({ log: { stufe: 'info', bereich: 'wallbox', melden, text: `⏸ Wallbox: Laden pausiert – Regel: ${grund}${socText}` } });
}
st.lv = lv;

// Zusage in Gefahr: Auto steckt, unter der Pflicht, Wallbox frei, aber 10 min fließt nachweislich kein Strom
const gefahr = modus === 'aktiv' && angesteckt && soc !== null && soc < PFLICHT && befehl.modus !== 'pause' && leistung !== null && leistung <= 1000;
st.gefahrMin = gefahr ? (st.gefahrMin || 0) + 1 : 0;
if (st.gefahrMin === 10) {
    logs.push({ log: { stufe: 'warnung', bereich: 'wallbox', melden: 'zusage',
        text: `Zusage in Gefahr: Auto bei ${Math.round(soc)} % (Pflicht ${PFLICHT} %), Wallbox frei, aber seit 10 min kein Strom` } });
    st.gefahr = true;
} else if (st.gefahr && !gefahr) {
    logs.push({ log: { stufe: 'info', bereich: 'wallbox', melden: 'zusage', text: 'Entwarnung: Auto lädt wieder oder Pflicht erreicht' } });
    st.gefahr = false;
}
if (st.regel !== regel && st.regel !== undefined && !logs.length) {
    logs.push({ log: { stufe: 'info', bereich: 'wallbox', text: `Ladeplanung: ${grund}` } });
}
st.befehl = effektivModus; st.regel = regel;
context.set('st', st);

const fields = { regel, befehl: effektivModus.modus, frei: frei ? 1 : 0, grund, ampere: effektivModus.ampere || 0,
    pv_moeglich: pvMoeglich ? 1 : 0, pv_ueberschuss_W: Math.round(ueW), angesteckt: angesteckt ? 1 : 0,
    bedarf_kWh: +bedarfKWh.toFixed(1), stunden_noetig: noetig, bekannte_stunden: preise.length, gesendet: senden ? 1 : 0 };
if (soc !== null) fields.soc = soc;
if (leistung !== null) fields.leistung_W = leistung;
if (abfahrt) fields.bis_abfahrt_h = +((abfahrt - jetzt) / 3600000).toFixed(1);
if (preise.length) fields.preis_ct = preise[0].ct;

node.status({ fill: effektivModus.modus === 'pause' ? 'yellow' : 'green', shape: senden ? 'dot' : 'ring',
    text: `${effektivModus.modus}${effektivModus.ampere ? ' ' + effektivModus.ampere + ' A' : ''} – ${grund}` + (modus !== 'aktiv' ? ` · ${modus}` : '') });
return [senden ? { befehl: Object.assign({ grund, zeit: jetzt }, effektivModus) } : null,
        { payload: [{ measurement: 'wallbox_plan', tags: { quelle: 'ems' }, fields, timestamp: new Date(jetzt) }] },
        logs.length ? logs : null];
