import Toybox.Graphics;
import Toybox.Lang;

// The set on screen (PRD 4.3) in the Instrument design: weight | repetitions, "Set 2 of 4" below,
// a ring of one segment per set. Page 1 holds the heart rate and what was done last time.
// The face is plain data (no dc), so tests read it.
module SetScreen {
    const WARN as Number = 0xFFAA00;
    const DASH as String = "–";       // an unknown value (never 0)
    const LINE_CHARS as Number = 16;   // what fits one grey line of the top on 218 px

    // page 0: the set; page 1: heart rate and last time.
    function face(session as TrainingSession, heartRate as Number or Null, page as Number) as InstrumentFace {
        var f = new InstrumentFace();
        var ex = session.exercise();
        var set = session.currentSet() as PlannedSet;
        var extra = extraInfo(ex, set);
        f.ring = InstrumentFace.RING_SEGMENTS;
        f.segments = ex.sets.size();
        f.done = session.setIdx;
        if (page == 1) {
            heartPage(f, heartRate, ex.lastTime);
            f.bottom = extra;
            return f;
        }
        f.top = wrap(ex.name, LINE_CHARS);
        if (f.top.size() == 1 && extra != null) {
            f.top.add(extra as String);   // room for a second grey line: "pro Hantel"
        }
        var dash = DASH;
        f.left = set.loadG == null ? dash : TrainingText.kg(set.loadG as Number, TrainingText.separator());
        f.leftUnit = TrainingText.text(Rez.Strings.TrKg);
        f.right = set.reps == null ? dash : (set.reps as Number).toString();
        f.rightUnit = TrainingText.text(Rez.Strings.TrRepsUnit);
        if (set.reps == null) {
            f.bottom = TrainingText.text(Rez.Strings.UhrRepsOpen);
            f.bottomColor = WARN;
        } else if (set.loadG == null) {
            f.bottom = TrainingText.text(Rez.Strings.UhrWeightOpen);
            f.bottomColor = WARN;
        } else {
            f.bottom = setLine(set, session.setIdx + 1, ex.sets.size());
        }
        return f;
    }

    // "Set 2 of 4"; one-sided: "Left · 3 of 5".
    function setLine(set as PlannedSet, number as Number, total as Number) as String {
        if (set.side == PlannedSet.SIDE_LEFT || set.side == PlannedSet.SIDE_RIGHT) {
            return Lang.format(TrainingText.text(Rez.Strings.UhrSideOf), [TrainingText.sideText(set.side) as String, number, total]);
        }
        return Lang.format(TrainingText.text(Rez.Strings.TrSetOf), [number, total]);
    }

    // The note that goes with the weight: "per side", "pro Hantel", "Alternating"; null if none.
    function extraInfo(ex as PlannedExercise, set as PlannedSet) as String or Null {
        if (set.side == PlannedSet.SIDE_ALTERNATING) {
            return TrainingText.sideText(set.side);
        }
        if (ex.perSide && set.side == PlannedSet.SIDE_BOTH) {
            return TrainingText.text(Rez.Strings.TrPerSide);
        }
        return ex.loadSuffix;
    }

    // The second page of set and rest: the heart rate as the one big value, "-" without a reading (never 0).
    function heartPage(f as InstrumentFace, heartRate as Number or Null, lastTime as String or Null) as Void {
        f.top = lastTime == null ? [TrainingText.text(Rez.Strings.UhrPulse)] as Array<String> : wrap(lastTime as String, LINE_CHARS);
        f.hero = heartRate == null ? DASH : (heartRate as Number).toString();
        f.sub = TrainingText.text(Rez.Strings.UhrBpm);
    }

    // "132 bpm", or "-- bpm" without a reading (never 0).
    function heartText(heartRate as Number or Null) as String {
        var value = heartRate == null ? TrainingText.text(Rez.Strings.TrNoReading) : (heartRate as Number).toString();
        return Lang.format(TrainingText.text(Rez.Strings.TrHeartRate), [value]);
    }

    // A text in at most two lines of `max` characters, broken at a space; too long: the end is cut with "…".
    function wrap(text as String, max as Number) as Array<String> {
        if (text.length() <= max) {
            return [text] as Array<String>;
        }
        var cut = max;
        for (var i = max; i > 0; i--) {
            if ((text.substring(i, i + 1) as String).equals(" ")) {
                cut = i;
                break;
            }
        }
        var first = text.substring(0, cut) as String;
        var rest = text.substring(cut, text.length()) as String;
        while (rest.length() > 0 && (rest.substring(0, 1) as String).equals(" ")) {
            rest = rest.substring(1, rest.length()) as String;
        }
        return [first, ellipsize(rest, max)] as Array<String>;
    }

    function ellipsize(text as String, max as Number) as String {
        if (text.length() <= max) {
            return text;
        }
        return (text.substring(0, max - 1) as String) + "…";
    }
}
