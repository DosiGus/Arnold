import Toybox.Lang;

// One set as the plan proposes it. Unknown reps or weight stay unknown (null),
// never 0 (PRD P-03).
class PlannedSet {
    var reps as Number or Null;
    var loadG as Number or Null;       // grams (07 D-11)
    var side as Number;                // PlannedSet.SIDE_*

    enum Side {
        SIDE_BOTH,
        SIDE_LEFT,
        SIDE_RIGHT,
        SIDE_ALTERNATING
    }

    function initialize(plannedReps as Number or Null, plannedLoadG as Number or Null, plannedSide as Number) {
        reps = plannedReps;
        loadG = plannedLoadG;
        side = plannedSide;
    }

    static function sideCode(name as String or Null) as Number {
        if (name == null) {
            return SIDE_BOTH;
        }
        if ((name as String).equals("left")) {
            return SIDE_LEFT;
        }
        if ((name as String).equals("right")) {
            return SIDE_RIGHT;
        }
        if ((name as String).equals("alternating")) {
            return SIDE_ALTERNATING;
        }
        return SIDE_BOTH;
    }

    // Wire name of a side code, as the server's upload wants it.
    static function sideName(code as Number) as String {
        if (code == SIDE_LEFT) {
            return "left";
        }
        if (code == SIDE_RIGHT) {
            return "right";
        }
        if (code == SIDE_ALTERNATING) {
            return "alternating";
        }
        return "both";
    }
}

// One exercise of the day with everything the screens and the upload need.
class PlannedExercise {
    var planItemId as String;
    var exerciseId as String;
    var name as String;
    var stepG as Number;                 // weight step in grams (from the server)
    var loadSuffix as String or Null;    // e.g. "pro Hantel" (from the server)
    var perSide as Boolean;              // reps are counted per side
    var restSeconds as Number;
    var repMin as Number or Null;
    var repMax as Number or Null;
    var hint as String or Null;          // progression hint, e.g. "Heute +2,5 kg"
    var lastTime as String or Null;      // e.g. "Letztes Mal 8 · 8 · 7"
    var note as String or Null;          // the plan's own note
    var sets as Array<PlannedSet>;

    function initialize(item as Dictionary, entry as Dictionary, plannedSets as Array<PlannedSet>) {
        planItemId = item["id"] as String;
        exerciseId = entry["id"] as String;
        name = entry["n"] as String;
        stepG = entry["g"] instanceof Number ? entry["g"] as Number : 2500;
        var load = entry["l"];
        var suffix = load instanceof Dictionary ? (load as Dictionary)["s"] : null;
        loadSuffix = suffix instanceof String ? suffix as String : null;
        var basis = entry["rb"];
        perSide = false;
        if (basis instanceof String && (basis as String).equals("per_side")) {
            perSide = true;
        }
        restSeconds = item["r"] instanceof Number ? item["r"] as Number : 120;
        var range = item["rr"];
        repMin = null;
        repMax = null;
        if (range instanceof Array && (range as Array).size() == 2 && (range as Array)[0] instanceof Number && (range as Array)[1] instanceof Number) {
            repMin = (range as Array)[0] as Number;
            repMax = (range as Array)[1] as Number;
        }
        hint = item["h"] instanceof String ? item["h"] as String : null;
        lastTime = item["l"] instanceof String ? item["l"] as String : null;
        note = item["n"] instanceof String ? item["n"] as String : null;
        sets = plannedSets;
    }
}

// The training day of a workout, read from the stored copy of the plan (07 D-22):
// exercises once in a catalog, items point at them by index, sets are run-length
// encoded as [count, reps, load_g, side?]. Malformed parts are left out rather than guessed.
class TrainingPlan {
    const MAX_SETS as Number = 30;

    var dayId as String;
    var dayName as String;
    var planVersion as String;
    var exercises as Array<PlannedExercise>;

    function initialize(day as Dictionary) {
        dayId = day["id"] as String;
        dayName = day["n"] as String;
        planVersion = day["p"] as String;
        exercises = [] as Array<PlannedExercise>;
        var cat = day["cat"] as Array;
        var items = day["items"] as Array;
        for (var i = 0; i < items.size(); i++) {
            if (!(items[i] instanceof Dictionary)) {
                continue;
            }
            var item = items[i] as Dictionary;
            var index = item["c"];
            if (!(item["id"] instanceof String) || !(index instanceof Number) || (index as Number) < 0 || (index as Number) >= cat.size()) {
                continue;
            }
            var entry = cat[index as Number];
            if (!(entry instanceof Dictionary) || !((entry as Dictionary)["id"] instanceof String) || !((entry as Dictionary)["n"] instanceof String)) {
                continue;
            }
            exercises.add(new PlannedExercise(item, entry as Dictionary, expand((entry as Dictionary)["s"] as Object or Null)));
        }
    }

    function exerciseCount() as Number {
        return exercises.size();
    }

    function setCount() as Number {
        var total = 0;
        for (var i = 0; i < exercises.size(); i++) {
            total += exercises[i].sets.size();
        }
        return total;
    }

    // [[count, reps, load_g, side?], ...] to one entry per set.
    hidden function expand(runs as Object or Null) as Array<PlannedSet> {
        var sets = [] as Array<PlannedSet>;
        if (!(runs instanceof Array)) {
            return sets;
        }
        var list = runs as Array;
        for (var i = 0; i < list.size(); i++) {
            if (!(list[i] instanceof Array)) {
                continue;
            }
            var run = list[i] as Array;
            if (run.size() < 3 || !(run[0] instanceof Number) || (run[0] as Number) < 1) {
                continue;
            }
            var reps = run[1] instanceof Number ? run[1] as Number : null;
            var load = run[2] instanceof Number ? run[2] as Number : null;
            var side = run.size() > 3 && run[3] instanceof String ? PlannedSet.sideCode(run[3] as String) : PlannedSet.SIDE_BOTH;
            for (var k = 0; k < (run[0] as Number) && sets.size() < MAX_SETS; k++) {
                sets.add(new PlannedSet(reps, load, side));
            }
        }
        return sets;
    }
}
