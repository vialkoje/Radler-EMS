// Tests der Regellogik: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { lauf, abbild, stunden } = require('./harness');

const ABEND = '2026-11-25T18:00:00+01:00';   // Mittwoch
const MITTAG = '2026-06-10T11:00:00+02:00';
const ENV = { BATTERIE_KAPAZITAET_WH: '10000', BATTERIE_MAX_W: '5000', BATTERIE_MIN_SOC: '10' };

test('Messwerte: Netzwert ergibt die Hausbilanz', () => {
    const t = ABEND;
    const r = lauf('messwerte.js', {
        jetzt: t,
        global: { abbild: abbild(t, { 'pv.leistung_W': 2000, 'batterie.leistung_W': 500, 'wallbox.leistung_W': 1000, 'wp.leistung_W': 300 }) },
        msg: { geraet: 'netz', quelle: 'test', payload: { bezug_W: -200 } },
    });
    const haus = r.ergebnis.payload.find(p => p.measurement === 'haus');
    assert.equal(haus.fields.verbrauch_W, 2300);      // −200 + 2000 + 500
    assert.equal(haus.fields.ohne_auto_W, 1300);
    assert.equal(haus.fields.grundlast_W, 1000);
    assert.equal(r.global.abbild['netz.bezug_W'].wert, -200);
});

test('Strategie: Netzladen, wenn dem Akku vor der billigeren Nacht Energie für teure Stunden fehlt', () => {
    const preise = stunden(ABEND, [25, 45, 45, 45, 45, 45, 20, 20]);
    const r = lauf('strategie.js', {
        jetzt: ABEND, env: Object.assign({ NL_MODUS: 'vorschau' }, ENV),
        global: { abbild: Object.assign(abbild(ABEND, { 'batterie.soc_pct': 20, 'netz.bezug_W': 600 }),
            { 'markt.preise': { wert: preise, zeit: new Date(ABEND).getTime() } }) },
    });
    const nl = r.global.ems_nl;
    assert.equal(nl.laden, true, nl.grund);
    assert.match(nl.grund, /^Vorschau: es fehlen/);
    assert.match(nl.grund, /billiger in 6 h/);
    assert.ok(nl.bedarf_Wh > 1000);
});

test('Strategie: kein Netzladen, wenn die nächste Stunde billiger ist', () => {
    const preise = stunden(ABEND, [30, 25, 45, 45]);
    const r = lauf('strategie.js', {
        jetzt: ABEND, env: ENV,
        global: { abbild: Object.assign(abbild(ABEND, { 'batterie.soc_pct': 20, 'netz.bezug_W': 600 }),
            { 'markt.preise': { wert: preise, zeit: new Date(ABEND).getTime() } }) },
    });
    assert.equal(r.global.ems_nl.laden, false);
    assert.match(r.global.ems_nl.grund, /billiger in 1 h/);
});

test('Strategie: Auto lädt, Akku wartet auf eine Nachbarstunde', () => {
    const preise = stunden(ABEND, [25, 25.5, 45, 45, 45, 45, 20]);
    const r = lauf('strategie.js', {
        jetzt: ABEND, env: ENV,
        global: { abbild: Object.assign(abbild(ABEND, { 'batterie.soc_pct': 15, 'netz.bezug_W': 11000, 'wallbox.leistung_W': 10500 }),
            { 'markt.preise': { wert: preise, zeit: new Date(ABEND).getTime() } }) },
    });
    assert.equal(r.global.ems_nl.laden, false);
    assert.match(r.global.ems_nl.grund, /^Auto lädt/);
});

test('Strategie: Wasserlinie findet eine Schwelle, wenn die Sonne den Akku sicher füllt', () => {
    const prog = stunden(MITTAG, [6000, 6000, 6000, 6000, 5000, 3000, 1000, 0, 0, 0, 0, 0], 'W');
    const r = lauf('strategie.js', {
        jetzt: MITTAG, env: Object.assign({ WL_MODUS: 'aktiv', LAST_STANDARD_W: '500' }, ENV),
        global: { abbild: Object.assign(abbild(MITTAG, { 'batterie.soc_pct': 50, 'netz.bezug_W': -3000 }),
            { 'prognose.pv': { wert: prog, zeit: new Date(MITTAG).getTime() } }) },
    });
    const wl = r.global.ems_wl;
    assert.ok(wl.T_W > 1000, `T = ${wl.T_W}, ${wl.grund}`);
    assert.equal(wl.T_W % 50, 0);
    // Probe: oberhalb von T kommt genug Energie für den freien Platz zusammen
    const menge = prog.reduce((a, x) => a + Math.min(Math.max(x.W - 500 - wl.T_W, 0), 5000), 0);
    assert.ok(menge >= wl.bedarf_Wh);
});

test('Strategie: Wasserlinie 0, wenn zu wenig Sonne erwartet wird', () => {
    const prog = stunden(MITTAG, [1500, 1500, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'W');
    const r = lauf('strategie.js', {
        jetzt: MITTAG, env: Object.assign({ WL_MODUS: 'aktiv' }, ENV),
        global: { abbild: Object.assign(abbild(MITTAG, { 'batterie.soc_pct': 20 }),
            { 'prognose.pv': { wert: prog, zeit: new Date(MITTAG).getTime() } }) },
    });
    assert.equal(r.global.ems_wl.T_W, 0);
    assert.equal(r.global.ems_wl.grund, 'zu wenig Sonne erwartet');
});

function ausfuehrung(werte, global = {}, env = {}) {
    return lauf('ausfuehrung.js', {
        jetzt: ABEND, env: Object.assign({ EMS_MODUS: 'aktiv' }, ENV, env),
        global: Object.assign({ abbild: abbild(ABEND, werte) }, global),
    });
}

test('Ausführung: Netzladen hat Vorrang', () => {
    const t = new Date(ABEND).getTime();
    const r = ausfuehrung({ 'netz.bezug_W': 500, 'batterie.leistung_W': 0, 'batterie.soc_pct': 30 },
        { ems_nl: { laden: true, leistung_W: 3000, bis: t + 600000 } });
    assert.deepEqual([r.ergebnis[0].befehl.modus, r.ergebnis[0].befehl.leistung_W], ['laden', 3000]);
});

test('Ausführung: Auto lädt → Akku entlädt nicht (Strom nicht teuer)', () => {
    const r = ausfuehrung({ 'netz.bezug_W': 11500, 'batterie.leistung_W': 0, 'batterie.soc_pct': 60, 'wallbox.leistung_W': 11000,
        'haus.ohne_auto_W': 500 }, { ems_haus: { teuer: false } });
    assert.equal(r.ergebnis[0].befehl.modus, 'begrenzt');
    assert.equal(r.ergebnis[0].befehl.max_entladen_W, 0);
});

test('Ausführung: Auto lädt bei teurem Strom → Akku deckt nur das Haus', () => {
    const r = ausfuehrung({ 'netz.bezug_W': 11500, 'batterie.leistung_W': 0, 'batterie.soc_pct': 60, 'wallbox.leistung_W': 11000,
        'haus.ohne_auto_W': 900, 'pv.leistung_W': 0 }, { ems_haus: { teuer: true } }, { HA_MODUS: 'aktiv' });
    assert.equal(r.ergebnis[0].befehl.max_entladen_W, 800);   // 900 − 150, auf 100 W gerundet
});

test('Ausführung: Wasserlinie begrenzt die Ladung auf den Überschuss über T', () => {
    const t = new Date(ABEND).getTime();
    const r = ausfuehrung({ 'netz.bezug_W': -1000, 'batterie.leistung_W': -2000, 'batterie.soc_pct': 50 },
        { ems_wl: { modus: 'aktiv', T_W: 1800, zeit: t } });
    assert.equal(r.ergebnis[0].befehl.modus, 'begrenzt');
    assert.equal(r.ergebnis[0].befehl.max_laden_W, 1200);     // S = 3000, 3000 − 1800
});

test('Ausführung: ohne Messwerte Fail-Safe, im Modus beobachten wird nichts gesendet', () => {
    const r = ausfuehrung({}, {}, { EMS_MODUS: 'beobachten' });
    assert.equal(r.ergebnis[0], null);
    assert.match(r.ergebnis[2][0].log.text, /Fail-Safe/);
    assert.equal(r.ergebnis[2][0].log.stufe, 'fehler');
});

const NACHT = '2026-11-25T20:00:00+01:00';  // Mittwoch, Abfahrt Donnerstag 6:00 → 10 Stunden
const NACHT_PREISE = [40, 38, 35, 30, 25, 24, 26, 30, 35, 40];
function wallbox(soc, o = {}) {
    const jetzt = o.jetzt || NACHT;
    return lauf('wallbox_plan.js', {
        jetzt, env: Object.assign({ WB_MODUS: 'aktiv', WB_AKKU_KWH: '60' }, o.env),
        global: Object.assign({
            abbild: abbild(jetzt, Object.assign({ 'wallbox.status': 'angesteckt', 'wallbox.leistung_W': 0 },
                soc === null ? {} : { 'auto.soc_pct': soc })),
            ems_plan: { zeit: new Date(jetzt).getTime(), preise: stunden(jetzt, o.preise || NACHT_PREISE) },
        }, o.global),
        context: o.context,
    });
}

test('Wallbox: bis 25 % sofort', () => {
    assert.equal(wallbox(20).ergebnis[0].befehl.modus, 'frei');
});

test('Wallbox: 40 % in teurer Stunde → warten auf günstige Stunde', () => {
    const r = wallbox(40);
    assert.equal(r.ergebnis[0].befehl.modus, 'pause');
    assert.match(r.global.wallbox_plan.grund, /warten auf günstige Stunde/);
});

test('Wallbox: 40 % in der billigsten Stunde → laden', () => {
    const r = wallbox(40, { preise: [24, 40, 38, 35, 30, 25, 26, 30, 35, 40] });
    assert.equal(r.ergebnis[0].befehl.modus, 'frei');
});

test('Wallbox: ab 80 % frei, Ladestand unbekannt → teuerste Stunden', () => {
    assert.equal(wallbox(85).ergebnis[0].befehl.modus, 'frei');
    const r = wallbox(null);
    assert.equal(r.global.wallbox_plan.regel, 'sperre');
    assert.equal(r.ergebnis[0].befehl.modus, 'pause');      // 40 ct gehört zu den teuersten 50 %
});

test('Wallbox: PV-Laden startet nach 2 min Überschuss mit passender Stromstärke', () => {
    const t = new Date(NACHT).getTime();
    const g = { ems_ueberschuss: { car_W: 6000, zeit: t } };
    const r1 = wallbox(40, { global: g });
    assert.equal(r1.ergebnis[0].befehl.modus, 'pause');
    const r2 = wallbox(40, { global: g, context: r1.context });
    assert.deepEqual(r2.ergebnis[0].befehl.modus, 'strom');
    assert.equal(r2.ergebnis[0].befehl.ampere, 8);            // 6000 W / 690 W je A
    assert.equal(r2.global.wallbox_plan.regel, 'pv');
});

test('Wärmepumpe: PV-Fenster hebt an und hält bis zum Ende des Heizlaufs', () => {
    const t0 = new Date(MITTAG.replace('06-10', '03-10').replace('+02', '+01')).getTime();
    const env = { WP_MODUS: 'aktiv' };
    const werte = (t, extra) => abbild(t, Object.assign({ 'wp.status': 'heizen', 'wp.leistung_W': 1800, 'wetter.temperatur_C': 5 }, extra));
    let r = lauf('wp_steuerung.js', { jetzt: t0, env,
        global: { abbild: werte(t0), ems_live: { frei_W: 800, laden_W: 0, soc: 50, zeit: t0 } } });
    assert.equal(r.ergebnis[0].befehl.anhebung_K, 2);
    assert.equal(r.ergebnis[0].befehl.sgready, 3);
    // 40 min später kein Überschuss mehr, die WP heizt aber noch → Anhebung bleibt
    const t1 = t0 + 40 * 60000;
    r = lauf('wp_steuerung.js', { jetzt: t1, env, context: r.context,
        global: { abbild: werte(t1), ems_live: { frei_W: -1500, laden_W: 0, soc: 50, zeit: t1 } } });
    const t2 = t1 + 25 * 60000;
    r = lauf('wp_steuerung.js', { jetzt: t2, env, context: r.context,
        global: { abbild: werte(t2), ems_live: { frei_W: -1500, laden_W: 0, soc: 50, zeit: t2 } } });
    // das PV-Fenster schließt nie in einem Heizlauf
    assert.equal(r.ergebnis[1].payload[0].fields.anhebung_K, 2);
    assert.equal(r.ergebnis[1].payload[0].fields.pv_fenster, 1);
    // Heizlauf vorbei → zurück auf 0
    const t3 = t2 + 3 * 60000;
    r = lauf('wp_steuerung.js', { jetzt: t3, env, context: r.context,
        global: { abbild: werte(t3, { 'wp.status': 'aus', 'wp.leistung_W': 0 }), ems_live: { frei_W: -300, laden_W: 0, soc: 50, zeit: t3 } } });
    assert.equal(r.ergebnis[1].payload[0].fields.anhebung_K, 0);
});

test('Meldung: nachts wartet „sonst“, Zusagen gehen raus, Sperrzeit greift', () => {
    const nacht = '2026-11-25T23:30:00+01:00';
    const e = (text, melden) => ({ meldung: { zeit: nacht, stufe: 'warnung', bereich: 'test', text, melden } });
    let r = lauf('meldung.js', { jetzt: nacht, msg: e('irgendwas', true) });
    assert.match(r.ergebnis[1].log.text, /Nachtruhe/);
    assert.equal(r.global.meldung_nacht.length, 1);
    r = lauf('meldung.js', { jetzt: nacht, msg: e('Auto bei 30 %', 'zusage'), env: { NTFY_TOPIC: 'test-topic' } });
    assert.equal(JSON.parse(r.ergebnis[0].payload).priority, 5);
    const r2 = lauf('meldung.js', { jetzt: nacht, msg: e('Auto bei 31 %', 'zusage'), env: { NTFY_TOPIC: 'test-topic' }, context: r.context });
    assert.equal(r2.ergebnis, null); // gleiche Meldung (Zahlen zählen nicht) in der Sperrzeit
});

test('Simulator: Netz = Haus + WP + Wallbox − PV − Batterie, Batterie folgt dem Ladebefehl', () => {
    const t = new Date(ABEND).getTime();
    const r = lauf('simulator.js', { jetzt: t, env: { SIM_ZUFALL: 'aus' },
        global: { abbild: {}, befehl_batterie: { modus: 'laden', leistung_W: 3000, zeit: t } } });
    const m = Object.fromEntries(r.ergebnis[0].map(x => [x.geraet, x.payload]));
    assert.equal(m.batterie.leistung_W, -3000);
    assert.equal(m.batterie.modus, 'laden');
    assert.ok(m.netz.bezug_W > 3000);
    assert.equal(r.ergebnis[0][r.ergebnis[0].length - 1].geraet, 'netz');
});

test('Tagesbericht: rechnet Kosten aus Minutenwerten und Viertelstundenpreisen', () => {
    const jetzt = '2026-11-25T07:00:00+01:00';
    const start = new Date('2026-11-24T00:00:00+01:00').getTime();
    const geraete = [];
    for (let i = 1; i <= 60; i++) geraete.push({ _time: new Date(start + i * 60000).toISOString(), _value: 1000, _measurement: 'netz' });
    for (let i = 1; i <= 60; i++) geraete.push({ _time: new Date(start + i * 60000).toISOString(), _value: 2000, _measurement: 'pv' });
    const preise = [{ _time: new Date(start - 3600000).toISOString(), _value: 30 }];
    const r = lauf('tagesbericht.js', { jetzt, env: { EINSPEISE_CT: '8' },
        msg: { schritt: 'ems', payload: [{ _value: 1 }, { _value: 0 }], bericht: { start, stop: start + 86400000, geraete, preise } } });
    const d = r.ergebnis[1].log.daten;
    assert.equal(d.bezug_kWh, 1);
    assert.equal(d.kosten_eur, 0.3);
    assert.equal(d.pv_kWh, 2);
    assert.equal(d.netzladen_h, 0.25);
    assert.match(r.ergebnis[1].log.text, /Tagesbericht 24\.11\./);
});

test('flows.json ist mit dem Generator gebaut', () => {
    execFileSync('python3', [path.join(__dirname, '..', 'nodered', 'build.py'), '--pruefen']);
});
