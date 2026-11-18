import Toybox.Graphics;
import Toybox.Lang;

// The rest (PRD 4.3) in the Instrument design: the countdown as the one big value, the last set below it,
// what comes next at the bottom, a ring that runs down and ends at twelve o'clock.
// Page 1 shows the heart rate instead of the last set.
module RestScreen {
    const WARN_COLOR_S as Number = 10;
    const NEXT_NAME_CHARS as Number = 9;   // "Then: " and the name must fit one line at the bottom

    function face(session as TrainingSession, heartRate as Number or Null, page as Number) as InstrumentFace {
        var f = new InstrumentFace();
        var left = session.restRemaining();
        var warn = left <= WARN_COLOR_S;
        f.top = [TrainingText.text(Rez.Strings.TrRest)] as Array<String>;
        if (page == 1) {
            f.hero = heartRate == null ? SetScreen.DASH : (heartRate as Number).toString();
            f.sub = TrainingText.text(Rez.Strings.UhrBpm);
        } else {
            f.hero = TrainingText.clock(left);
            f.heroColor = warn ? SetScreen.WARN : Graphics.COLOR_WHITE;
            f.sub = lastSet(session);
        }
        if (session.nextIsSameExercise()) {
            f.bottom = Lang.format(TrainingText.text(Rez.Strings.UhrThenSet), [session.setIdx + 2]);
        } else {
            var next = session.nextExerciseIndex();
            if (next >= 0) {
                f.bottom = Lang.format(TrainingText.text(Rez.Strings.UhrThenExercise), [SetScreen.ellipsize(session.plan.exercises[next].name, NEXT_NAME_CHARS)]);
            }
        }
        // The time ring runs down: it ends at twelve o'clock, its length is what is left of the whole rest.
        f.ring = InstrumentFace.RING_TIME;
        var total = session.restLength();
        var length = 0;
        if (total > 0 && left > 0) {
            length = (left > total ? total : left) * 360 / total;
        }
        f.timeLength = length;
        f.timeFrom = 360 - length;
        f.ringColor = warn ? SetScreen.WARN : Graphics.COLOR_WHITE;
        return f;
    }

    // "62,5 kg × 8", without a weight "8 reps"; null if the set is not known.
    function lastSet(session as TrainingSession) as String or Null {
        var done = session.doneSet(session.setIdx);
        if (done == null || !((done as Dictionary)["r"] instanceof Number)) {
            return null;
        }
        var reps = (done as Dictionary)["r"] as Number;
        var load = (done as Dictionary)["g"];
        if (load instanceof Number) {
            return Lang.format(TrainingText.text(Rez.Strings.UhrLast), [TrainingText.kg(load as Number, TrainingText.separator()), reps]);
        }
        return reps.toString() + " " + TrainingText.text(Rez.Strings.TrRepsUnit);
    }
}
