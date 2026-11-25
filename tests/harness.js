// Führt einen Funktionsknoten aus nodered/funktionen/ wie Node-RED aus, mit nachgebildetem Kontext und fester Uhrzeit.
//   const r = lauf('strategie.js', { jetzt: '2026-11-25T18:00:00+01:00', env: {...}, global: {...}, msg: {...} })
//   r.ergebnis  Rückgabe des Knotens        r.global / r.context  Zustand danach (für den nächsten Lauf)
//   r.status    letzter node.status         r.warnungen           node.warn-Texte
'use strict';
const fs = require('fs');
const path = require('path');

const ORDNER = path.join(__dirname, '..', 'nodered', 'funktionen');

function speicher(start) {
    const daten = start || {};
    return { daten, get: k => daten[k], set: (k, v) => { daten[k] = v; }, keys: () => Object.keys(daten) };
}

function lauf(datei, o = {}) {
    const jetzt = o.jetzt === undefined ? Date.now() : new Date(o.jetzt).getTime();
    const EchtesDate = Date;
    class FesteUhr extends EchtesDate {
        constructor(...a) { if (a.length) super(...a); else super(jetzt); }
        static now() { return jetzt; }
    }
    const g = speicher(o.global), c = speicher(o.context), f = speicher(o.flow);
    const env = { get: k => (o.env || {})[k] };
    const r = { status: null, warnungen: [], fehler: [] };
    const node = {
        status: s => { r.status = s; }, warn: t => r.warnungen.push(t), error: t => r.fehler.push(t),
        send: () => {}, done: () => {}, log: () => {},
    };
    let quelle = fs.readFileSync(path.join(ORDNER, datei), 'utf8');
    if (o.geraet) quelle = `const GERAET = '${o.geraet}';\n` + quelle;
    const fn = new Function('msg', 'node', 'env', 'global', 'flow', 'context', 'Date', quelle);
    r.ergebnis = fn(JSON.parse(JSON.stringify(o.msg || {})), node, env, g, f, c, FesteUhr);
    r.global = g.daten;
    r.context = c.daten;
    return r;
}

// Prozessabbild-Eintrag „frisch“ zum Zeitpunkt jetzt
function abbild(jetzt, werte) {
    const t = new Date(jetzt).getTime();
    const a = {};
    for (const [k, v] of Object.entries(werte)) a[k] = { wert: v, einheit: '', zeit: t - 1000, quelle: 'test' };
    return a;
}

// Stundenliste ab der Stunde von jetzt: preise(jetzt, [30, 31, …]) → [{ t, ct }]
function stunden(jetzt, werte, feld = 'ct') {
    const h0 = Math.floor(new Date(jetzt).getTime() / 3600000) * 3600000;
    return werte.map((v, i) => ({ t: h0 + i * 3600000, [feld]: v }));
}

module.exports = { lauf, abbild, stunden };
