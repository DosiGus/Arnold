import Toybox.Lang;

// What the journal says was trained (UMSETZUNG 7.3): the events are only ever
// appended, so a correction or an undo is an event of its own. The sets that
// count are found by reading the events in order.
//
//   SET      a set was confirmed (again after an undo: it replaces the old entry)
//   CORRECT  the values of a confirmed set were changed (times stay)
//   UNDO     a confirmed set was taken back
module WorkoutEvents {

    // The confirmed sets, in the order they were confirmed. Each is a dictionary with
    // e (exercise index), s (set index), r, g (absent when unknown), d (side), a, b.
    function sets(events as Array<Dictionary>) as Array<Dictionary> {
        var out = [] as Array<Dictionary>;
        for (var i = 0; i < events.size(); i++) {
            var event = events[i];
            var kind = event["k"] as Number;
            if (kind != Journal.EVENT_SET && kind != Journal.EVENT_CORRECT && kind != Journal.EVENT_UNDO) {
                continue;
            }
            var at = indexOf(out, event["e"] as Number, event["s"] as Number);
            if (kind == Journal.EVENT_SET) {
                if (at >= 0) {
                    out.remove(out[at]);
                }
                out.add(copy(event));
            } else if (at >= 0 && kind == Journal.EVENT_UNDO) {
                out.remove(out[at]);
            } else if (at >= 0) {
                var entry = out[at];
                entry["r"] = event["r"];
                if (event.hasKey("g")) {
                    entry["g"] = event["g"];
                } else {
                    entry.remove("g");
                }
            }
        }
        return out;
    }

    // Exercises that were passed over by the user or by the plan (they have no sets in the plan).
    function skipped(events as Array<Dictionary>) as Array<Number> {
        var out = [] as Array<Number>;
        for (var i = 0; i < events.size(); i++) {
            if ((events[i]["k"] as Number) == Journal.EVENT_SKIP && out.indexOf(events[i]["e"] as Number) < 0) {
                out.add(events[i]["e"] as Number);
            }
        }
        return out;
    }

    function indexOf(list as Array<Dictionary>, exercise as Number, set as Number) as Number {
        for (var i = 0; i < list.size(); i++) {
            if ((list[i]["e"] as Number) == exercise && (list[i]["s"] as Number) == set) {
                return i;
            }
        }
        return -1;
    }

    function copy(event as Dictionary) as Dictionary {
        var entry = { "e" => event["e"], "s" => event["s"], "r" => event["r"], "d" => event["d"], "a" => event["a"], "b" => event["b"] };
        if (event.hasKey("g")) {
            entry["g"] = event["g"];
        }
        return entry;
    }
}
