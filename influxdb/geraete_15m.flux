// Task: Messwerte zu 15-Minuten-Mitteln verdichten (Bucket geraete → geraete_15m)
// "geraete" hält die 10-s-Werte 90 Tage, "geraete_15m" für immer (Auswertungen über Jahre, Simulationen).
// Nur Zahlen; Textfelder wie status oder modus bleiben weg.
import "types"

option task = {name: "geraete_15m", every: 15m, offset: 2m}

from(bucket: "geraete")
    |> range(start: -1h)
    |> filter(fn: (r) => types.isType(v: r._value, type: "float") or types.isType(v: r._value, type: "int"))
    |> aggregateWindow(every: 15m, fn: mean, createEmpty: false)
    |> to(bucket: "geraete_15m")
