
// ─── RADLER-EMS (deploy/nodered_einrichten.sh hängt diesen Block an ~/.node-red/settings.js an) ───
// Warnungen und Fehler aller Knoten (node.warn, node.error, auch HTTP-, Modbus-, InfluxDB-Fehler) landen in einem
// Puffer, den der Log-Bereich im Tab „⚙️ System“ alle 5 s abholt. So stehen sie im Log, ohne die Knoten zu ändern
// (Anforderung R2 aus Haus-EMS). Ohne diesen Block läuft alles andere genauso, nur fehlen diese Einträge.
const radlerLogPuffer = [];
module.exports.functionGlobalContext = Object.assign(module.exports.functionGlobalContext || {}, { radlerLogPuffer });
module.exports.logging = Object.assign(module.exports.logging || {}, {
    radlerEms: {
        level: 'warn', metrics: false, audit: false,
        handler: () => m => {
            if (!m.id) return;   // nur Meldungen von Knoten, nicht vom Laufzeitsystem
            radlerLogPuffer.push({ level: m.level, id: m.id, z: m.z, typ: m.type, name: m.name, text: m.msg, zeit: m.timestamp });
            if (radlerLogPuffer.length > 1000) radlerLogPuffer.shift();
        },
    },
});
// ─── Ende RADLER-EMS ───
