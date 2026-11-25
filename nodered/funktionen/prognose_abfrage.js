// PV-Prognose abfragen: Open-Meteo, Einstrahlung auf die geneigte Modulfläche (ohne Anmeldung)
// ─ Eingang: Inject stündlich und beim Start
// ─ Ausgang 1: je Dachfläche eine Nachricht mit msg.url und msg.flaeche, mit msg.parts für den Join-Knoten
// ─ Umgebung: STANDORT_LAT, STANDORT_LON,
//             PV_FLAECHEN = "Neigung/Azimut/kWp;…", Azimut wie Open-Meteo: 0 = Süd, -90 = Ost, 90 = West
//             Beispiel: "35/-90/4.5;35/90/4.5" (Ost-West-Dach mit je 4,5 kWp). Standard: "30/0/8"

const lat = parseFloat(env.get('STANDORT_LAT')) || 51.16; // ohne Einstellung: Mitte Deutschlands (Warnung beim Start)
const lon = parseFloat(env.get('STANDORT_LON')) || 10.45;
const flaechen = String(env.get('PV_FLAECHEN') || '30/0/8').split(';')
    .map(s => s.trim()).filter(Boolean)
    .map(s => { const [neigung, azimut, kwp] = s.split('/').map(parseFloat); return { neigung, azimut, kwp }; })
    .filter(f => [f.neigung, f.azimut, f.kwp].every(x => !isNaN(x)));
if (!flaechen.length) {
    node.status({ fill: 'red', shape: 'dot', text: 'PV_FLAECHEN ungültig' });
    return null;
}
const id = 'prognose-' + Date.now();
node.status({ fill: 'blue', shape: 'dot', text: `${flaechen.length} Fläche(n), ${flaechen.reduce((a, f) => a + f.kwp, 0)} kWp` });
return [flaechen.map((f, i) => ({
    flaeche: f,
    url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
         `&hourly=global_tilted_irradiance,temperature_2m&tilt=${f.neigung}&azimuth=${f.azimut}` +
         `&past_days=1&forecast_days=2&timeformat=unixtime&timezone=UTC`,
    parts: { id, index: i, count: flaechen.length, type: 'array' },
}))];
