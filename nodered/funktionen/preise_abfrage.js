// Strompreise abfragen: Day-Ahead DE-LU von Energy-Charts (Fraunhofer ISE, CC BY 4.0, ohne Anmeldung)
// ─ Eingang: Inject stündlich und beim Start
// ─ Ausgang 1: msg.url für den HTTP-Knoten (heute bis übermorgen; die Preise für morgen kommen gegen 13 Uhr)
// ─ Umgebung: PREIS_ZONE (DE-LU)

const tag = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(t);
const jetzt = Date.now();
const zone = env.get('PREIS_ZONE') || 'DE-LU';
msg.url = `https://api.energy-charts.info/price?bzn=${encodeURIComponent(zone)}&start=${tag(jetzt)}&end=${tag(jetzt + 2 * 86400000)}`;
return msg;
