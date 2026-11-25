// Wetter auswerten
// ─ Eingang: Open-Meteo-Antwort mit "current" (aktuell) oder "hourly" (Verlauf 48 h)
// ─ Ausgang 1: InfluxDB-Punkte (Bucket markt, Messreihe "wetter")
// ─ Kontext: global.abbild['wetter.temperatur_C'] und weitere Felder (nur aus "current")
// Felder wie im ersten Wetter-Flow: temperatur, gefuehlt, taupunkt, luftfeuchte, niederschlag, regen, schnee,
// wettercode, bewoelkung, luftdruck, luftdruck_ort, wind, windrichtung, boeen, tag

const MAP = {
    temperature_2m: 'temperatur', apparent_temperature: 'gefuehlt', dew_point_2m: 'taupunkt',
    relative_humidity_2m: 'luftfeuchte', precipitation: 'niederschlag', rain: 'regen', snowfall: 'schnee',
    weather_code: 'wettercode', cloud_cover: 'bewoelkung', pressure_msl: 'luftdruck',
    surface_pressure: 'luftdruck_ort', wind_speed_10m: 'wind', wind_direction_10m: 'windrichtung',
    wind_gusts_10m: 'boeen', is_day: 'tag',
};
const TAGS = { ort: env.get('STANDORT_NAME') || 'Standort', quelle: 'open-meteo' };
const p = msg.payload || {};
const punkte = [];

if (p.current) {
    const c = p.current, fields = {};
    for (const [von, nach] of Object.entries(MAP)) if (typeof c[von] === 'number') fields[nach] = c[von];
    punkte.push({ measurement: 'wetter', tags: TAGS, fields, timestamp: new Date(c.time * 1000) });
    const abbild = global.get('abbild') || {};
    const zeit = Date.now();
    abbild['wetter.temperatur_C'] = { wert: fields.temperatur, einheit: '°C', zeit, quelle: 'open-meteo' };
    abbild['wetter.bewoelkung_pct'] = { wert: fields.bewoelkung, einheit: '%', zeit, quelle: 'open-meteo' };
    abbild['wetter.wettercode'] = { wert: fields.wettercode, einheit: '', zeit, quelle: 'open-meteo' };
    global.set('abbild', abbild);
    node.status({ fill: 'green', shape: 'dot', text: `${fields.temperatur} °C, ${fields.luftfeuchte} % – ${new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })}` });
} else if (p.hourly && Array.isArray(p.hourly.time)) {
    const jetzt = Date.now() / 1000;
    p.hourly.time.forEach((t, i) => {
        if (t > jetzt) return; // keine Vorhersage speichern
        const fields = {};
        for (const [von, nach] of Object.entries(MAP)) {
            const v = p.hourly[von] && p.hourly[von][i];
            if (typeof v === 'number') fields[nach] = v;
        }
        if (Object.keys(fields).length) punkte.push({ measurement: 'wetter', tags: TAGS, fields, timestamp: new Date(t * 1000) });
    });
    node.status({ fill: 'blue', shape: 'dot', text: `Verlauf: ${punkte.length} Stundenwerte` });
} else {
    node.status({ fill: 'red', shape: 'dot', text: 'keine Wetterdaten (HTTP ' + msg.statusCode + ')' });
    return null;
}
msg.payload = punkte;
return msg;
