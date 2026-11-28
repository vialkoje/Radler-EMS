// 🌡️ Wärmepumpe steuern (jede Minute): Anhebung bei PV-Überschuss und günstigem Strom, nie mitten im Heizlauf
// Übernommen aus Haus-EMS (docs/waermepumpe.md), geräteunabhängig: der Befehl enthält SG-Ready-Zustand UND
// Sollwertanhebung; der Adapter nimmt, was seine Wärmepumpe kann.
// ─ Eingang: Inject jede Minute
// ─ Ausgang 1: Befehl (msg.befehl = { sgready: 2|3, anhebung_K, ww_absenken, grund }) → Link „Befehl Wärmepumpe“
// ─ Ausgang 2: InfluxDB-Punkt (Bucket ems, Messreihe "wp_steuerung")
// ─ Ausgang 3: msg.log bei geänderter Anhebung
// ─ Liest: global.abbild (wp.status, wp.leistung_W, wp.aussen_C oder wetter.temperatur_C, wp.raum_C),
//          global.ems_live, global.ems_plan
// ─ Umgebung: WW_GUENSTIG (aus | beobachten | aktiv), WW_GUENSTIG_ANTEIL, WP_MODUS, WP_HEIZGRENZE_C, ANHEBUNG_PV_K, ANHEBUNG_GUENSTIG_K, WP_GUENSTIG_ANTEIL, PV_START_W, PV_HALTEN_W,
//             PV_AUS_MIN, PV_AKKU_SOC, WP_PV_PROGNOSE_WH, RAUM_MAX_C, NACHHEIZ_K, NACHHEIZ_MIN, WW_NACHT_VON, WW_NACHT_BIS
//
// SG-Ready: 1 = Sperre (nicht genutzt), 2 = Normalbetrieb, 3 = Einschaltempfehlung (mehr heizen), 4 = Anlaufbefehl (nicht genutzt)

const jetzt = Date.now();
const abbild = global.get('abbild') || {};
function wert(s, maxS) { const e = abbild[s]; return e && jetzt - e.zeit <= maxS * 1000 ? e.wert : null; }
function zahl(n, std) { const v = parseFloat(env.get(n)); return isNaN(v) ? std : v; }
function text(n, std) { const v = env.get(n); return v === undefined || v === null || v === '' ? std : String(v); }
const stunde = t => parseInt(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(t), 10);

const modus = text('WP_MODUS', 'beobachten');
const st = context.get('st') || { anhebung: 0, pvFenster: false, pvSeit: 0, pvUnterSeit: 0, zuWarm: false, geaendert: 0,
    lief: false, wwVorher: false, nachheizBis: 0 };

// Außentemperatur, Mittel 24 h (Proben alle 10 min)
const aussen = wert('wp.aussen_C', 900) ?? wert('wetter.temperatur_C', 1800);
const proben = (context.get('aussen') || []).filter(x => jetzt - x[0] <= 86400000);
if (aussen !== null && (!proben.length || jetzt - proben[proben.length - 1][0] >= 600000)) proben.push([jetzt, aussen]);
context.set('aussen', proben);
const aussen24 = proben.length ? proben.reduce((a, x) => a + x[1], 0) / proben.length : null;
const heizzeit = aussen24 === null ? true : aussen24 < zahl('WP_HEIZGRENZE_C', 15);

// Räume zu warm? (optional; ohne Raumwert gilt „nicht zu warm“)
const raum = wert('wp.raum_C', 3600);
const raumMax = zahl('RAUM_MAX_C', 22);
if (raum !== null) st.zuWarm = st.zuWarm ? raum > raumMax - 0.3 : raum >= raumMax;
else st.zuWarm = false;

const status = wert('wp.status', 300);               // 'aus' | 'heizen' | 'warmwasser' | 'stoerung'
const heizt = status === 'heizen';
const wpW = wert('wp.leistung_W', 300) || 0;

// Überschuss: Einspeisung minus Akku-Entladung plus Strom der Wärmepumpe (Mittel 5 min);
// ab PV_AKKU_SOC zählt auch die Ladung des Akkus (er ist fast voll)
const live = global.get('ems_live');
let ue = null;
if (live && jetzt - live.zeit < 120000) {
    const wpMittel = (context.get('wpw') || []).filter(x => jetzt - x[0] <= 300000);
    wpMittel.push([jetzt, wpW]); context.set('wpw', wpMittel);
    ue = live.frei_W + wpMittel.reduce((a, x) => a + x[1], 0) / wpMittel.length;
    if (live.soc !== null && live.soc >= zahl('PV_AKKU_SOC', 80)) ue += live.laden_W || 0;
}

// PV-Fenster: öffnet ab PV_START_W, endet erst, wenn der Überschuss PV_AUS_MIN unter PV_HALTEN_W liegt,
// frühestens nach 30 min und nie in einem Heizlauf
if (ue !== null && ue >= zahl('PV_START_W', 1500) && !st.pvFenster) { st.pvFenster = true; st.pvSeit = jetzt; st.pvUnterSeit = 0; }
if (st.pvFenster) {
    if (ue === null || ue < zahl('PV_HALTEN_W', 1000)) st.pvUnterSeit = st.pvUnterSeit || jetzt; else st.pvUnterSeit = 0;
    if (st.pvUnterSeit && jetzt - st.pvUnterSeit >= zahl('PV_AUS_MIN', 20) * 60000 && jetzt - st.pvSeit >= 30 * 60000 && !heizt) {
        st.pvFenster = false;
    }
}

// Günstiges Fenster: die laufende Stunde gehört zu den billigsten WP_GUENSTIG_ANTEIL der bekannten Preise
// und die Sonne bringt in 12 h wenig
const plan = global.get('ems_plan');
let guenstig = false;
if (plan && jetzt - plan.zeit < 20 * 60000 && plan.preise && plan.preise.length) {
    const h0 = Math.floor(jetzt / 3600000) * 3600000;
    const liste = plan.preise.filter(p => p.t >= h0);
    const n = Math.max(1, Math.floor(liste.length * zahl('WP_GUENSTIG_ANTEIL', 0.25)));
    const billig = new Set(liste.slice().sort((a, b) => a.ct - b.ct).slice(0, n).map(p => p.t));
    guenstig = billig.has(h0) && plan.pv12h_Wh < zahl('WP_PV_PROGNOSE_WH', 15000);
}

// Warmwasser eben fertig → kurz anheben, damit der Heizlauf direkt anschließt (spart Kompressorstarts)
const ww = status === 'warmwasser';
if (st.wwVorher && !ww) st.nachheizBis = jetzt + zahl('NACHHEIZ_MIN', 3) * 60000;
st.wwVorher = ww;

let ziel = 0, grund;
if (!heizzeit) grund = `keine Heizzeit (außen Ø ${aussen24.toFixed(1)} °C)`;
else if (st.zuWarm) grund = `Räume zu warm (${raum} °C)`;
else if (st.pvFenster) { ziel = zahl('ANHEBUNG_PV_K', 2); grund = `PV-Überschuss ${Math.round(ue || 0)} W`; }
else if (guenstig) { ziel = zahl('ANHEBUNG_GUENSTIG_K', 2); grund = 'günstiger Strom'; }
else grund = 'normal';
if (jetzt < st.nachheizBis && ziel < zahl('NACHHEIZ_K', 0.5) && heizzeit) { ziel = zahl('NACHHEIZ_K', 0.5); grund = 'Heizlauf an Warmwasser anhängen'; }

// Anhebung endet erst nach dem Heizlauf; sonst ändert sie sich höchstens alle 2 min (Nachheizen sofort)
let anhebung = st.anhebung;
if (modus === 'aus') { anhebung = 0; grund = 'Steuerung aus'; }
else if (ziel < st.anhebung && heizt) grund += ', bis Ende Heizlauf';
else if (ziel !== st.anhebung && (jetzt - st.geaendert >= 120000 || grund.startsWith('Heizlauf an'))) { anhebung = ziel; }
const geaendert = anhebung !== st.anhebung;
if (geaendert) st.geaendert = jetzt;

// Warmwasser absenken (falls die Wärmepumpe einen Sollwert annimmt): nachts und während einer Anhebung ab 1 K,
// damit die Wärme in den Estrich geht und das Warmwasser keinen Heizlauf unterbricht
const h = stunde(jetzt);
const nachtVon = zahl('WW_NACHT_VON', 1), nachtBis = zahl('WW_NACHT_BIS', 5);
const istNacht = x => nachtVon <= nachtBis ? x >= nachtVon && x < nachtBis : x >= nachtVon || x < nachtBis;

// Warmwasser in günstigen Stunden (aus Haus-EMS flows-34): normaler Sollwert nur in den billigsten WW_GUENSTIG_ANTEIL
// der bekannten Stunden außerhalb der Nacht und im PV-Fenster, sonst abgesenkt. Die Wärmepumpe heizt das Warmwasser dann
// fast nur noch in diesen Stunden nach. In Haus-EMS liefen 42 von 52 kWh Warmwasser außerhalb dieser Stunden (Ø 45,4 statt
// 39,8 ct, 29.10.–28.11.2026). Ohne Preise (null) gilt die bisherige Regel. Im Fenster hat Warmwasser Vorrang vor der
// Absenkung wegen einer Anhebung: beides ist dann billig.
const wwModus = text('WW_GUENSTIG', 'beobachten');
let wwFenster = null;
if (plan && jetzt - plan.zeit < 20 * 60000 && plan.preise && plan.preise.length) {
    const h0 = Math.floor(jetzt / 3600000) * 3600000;
    const liste = plan.preise.filter(p => p.t >= h0);
    if (liste.length && liste[0].t === h0) {
        const tagsueber = liste.filter(p => !istNacht(stunde(p.t))).map(p => p.ct).sort((a, b) => a - b);
        const grenze = tagsueber[Math.min(tagsueber.length - 1, Math.floor(tagsueber.length * zahl('WW_GUENSTIG_ANTEIL', 0.33)))];
        wwFenster = !istNacht(h) && tagsueber.length > 0 && liste[0].ct <= grenze;
    }
}
if (st.pvFenster) wwFenster = true;
const wwRegel = wwModus === 'aktiv' && wwFenster !== null;
const wwAbsenken = modus !== 'aus' && (istNacht(h) || heizt || (wwRegel ? !wwFenster : anhebung >= 1));

const befehl = { sgready: anhebung > 0 ? 3 : 2, anhebung_K: anhebung, ww_absenken: wwAbsenken };
const senden = modus === 'aktiv' && (geaendert || JSON.stringify(befehl) !== JSON.stringify(st.befehl) || jetzt - (st.gesendet || 0) >= 15 * 60000);
if (senden) st.gesendet = jetzt;
const logs = [];
if (geaendert) logs.push({ log: { stufe: 'info', bereich: 'wp',
    text: `Wärmepumpe: Anhebung ${st.anhebung} → ${anhebung} K (SG-Ready ${befehl.sgready}): ${grund}` + (modus !== 'aktiv' ? ` (WP_MODUS=${modus})` : '') } });
st.anhebung = anhebung; st.befehl = befehl;
context.set('st', st);

const fields = { anhebung_K: anhebung, ziel_K: ziel, sgready: befehl.sgready, grund, heizzeit: heizzeit ? 1 : 0,
    pv_fenster: st.pvFenster ? 1 : 0, guenstig: guenstig ? 1 : 0, heizen: heizt ? 1 : 0, ww_absenken: wwAbsenken ? 1 : 0,
    ww_fenster: wwFenster === null ? -1 : wwFenster ? 1 : 0, ww_guenstig: wwModus,
    gesendet: senden ? 1 : 0 };
if (ue !== null) fields.ueberschuss_W = Math.round(ue);
if (raum !== null) fields.raum_C = raum;
if (aussen24 !== null) fields.aussen24_C = +aussen24.toFixed(1);

node.status({ fill: anhebung > 0 ? 'blue' : 'green', shape: senden ? 'dot' : 'ring',
    text: `+${anhebung} K (SG ${befehl.sgready}) – ${grund} · WW ${wwAbsenken ? 'abgesenkt' : 'normal'}` +
          (wwFenster === null ? '' : wwFenster ? ' (günstig)' : ' (teuer)') + (wwModus !== 'aktiv' ? ` [WW ${wwModus}]` : '') +
          (modus !== 'aktiv' ? ` · ${modus}` : '') });
return [senden ? { befehl: Object.assign({ grund, zeit: jetzt }, befehl) } : null,
        { payload: [{ measurement: 'wp_steuerung', tags: { quelle: 'ems' }, fields, timestamp: new Date(jetzt) }] },
        logs.length ? logs : null];
