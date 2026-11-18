import Toybox.Graphics;
import Toybox.Lang;

// Exercise preview (PRD 4.3): name, sets and values, rest, hint.
module PreviewScreen {

    function lines(dc as Dc, session as TrainingSession) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var ex = session.exercise();
        var number = session.exIdx + 1;
        out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.TrExerciseOf), [number, session.plan.exerciseCount()]), Graphics.FONT_XTINY, Instrument.LABEL));
        out.add(new PairingLine(ex.name, Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(summary(ex), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.TrRestOf), [TrainingText.clock(ex.restSeconds)]), Graphics.FONT_XTINY, Instrument.LABEL));
        if (ex.hint != null) {
            out.add(new PairingLine(ex.hint as String, Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
        }
        return out;
    }

    // "4 sets · 8 x 60 kg": the values of the first set, with the count of sets.
    function summary(ex as PlannedExercise) as String {
        var count = ex.sets.size();
        var sets = Lang.format(TrainingText.text(count == 1 ? Rez.Strings.TrSetOne : Rez.Strings.TrSets), [count]);
        var first = TrainingText.repsAndLoad(ex.sets[0]);
        var side = ex.perSide ? " " + TrainingText.text(Rez.Strings.TrPerSide) : "";
        return sets + " · " + first + side;
    }
}
