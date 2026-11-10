import Toybox.Graphics;
import Toybox.Lang;

// The rest (PRD 4.3): the countdown big, below it what comes next.
module RestScreen {
    const WARN_COLOR_S as Number = 10;

    function lines(dc as Dc, session as TrainingSession, heartRate as Number or Null) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var left = session.restRemaining();
        var ex = session.exercise();
        out.add(PairingLayout.nameLine(dc, ex.name, Graphics.COLOR_WHITE));
        out.add(new PairingLine(TrainingText.text(Rez.Strings.TrRest), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        var color = left <= WARN_COLOR_S ? Graphics.COLOR_YELLOW : Graphics.COLOR_WHITE;
        out.add(PairingLayout.bigLine(dc, TrainingText.clock(left), color));
        if (session.nextIsSameExercise()) {
            var total = ex.sets.size();
            out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.TrNextSet), [session.setIdx + 2, total]), Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
        } else {
            var next = session.nextExerciseIndex();
            if (next >= 0) {
                out.add(PairingLayout.lowerNameLine(dc, Lang.format(TrainingText.text(Rez.Strings.TrNextExercise), [session.plan.exercises[next].name]), Graphics.COLOR_LT_GRAY));
            }
        }
        out.add(new PairingLine(SetScreen.heartText(heartRate), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable());
        return out;
    }
}
