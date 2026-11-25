// Wetter abfragen: Open-Meteo am Standort (ohne Anmeldung)
// ─ Eingang: msg.topic = 'aktuell' (alle 10 min) oder 'verlauf' (beim Start: Stundenwerte der letzten 48 h)
// ─ Ausgang 1: msg.url für den HTTP-Knoten
// ─ Umgebung: STANDORT_LAT, STANDORT_LON, STANDORT_HOEHE (m, optional)

const lat = parseFloat(env.get('STANDORT_LAT')) || 51.16; // ohne Einstellung: Mitte Deutschlands (Warnung beim Start)
const lon = parseFloat(env.get('STANDORT_LON')) || 10.45;
const hoehe = parseFloat(env.get('STANDORT_HOEHE'));
const VARS = 'temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,rain,snowfall,' +
    'weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
const basis = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    (isNaN(hoehe) ? '' : `&elevation=${hoehe}`) + '&timeformat=unixtime&wind_speed_unit=kmh';
msg.url = msg.topic === 'verlauf'
    ? `${basis}&hourly=${VARS}&past_days=2&forecast_days=1`
    : `${basis}&current=${VARS},is_day&forecast_days=1`;
return msg;
