import Toybox.Graphics;
import Toybox.Lang;

// The set on screen (PRD 4.3): "Set 2 of 4", the values big, the side of a
// one-sided exercise, the heart rate and what was done last time.
module SetScreen {

    function lines(dc as Dc, session as TrainingSession, heartRate as Number or Null) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var ex = session.exercise();
        var set = session.currentSet() as PlannedSet;
        var title = Lang.format(TrainingText.text(Rez.Strings.TrSetOf), [session.setIdx + 1, ex.sets.size()]);
        var side = TrainingText.sideText(set.side);
        if (side != null) {
            title = title + " · " + (side as String);
        }
        out.add(new PairingLine(title, Graphics.FONT_XTINY, side != null ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY));
        var values = TrainingText.repsAndLoad(set);
        var fonts = [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL] as Array<Graphics.FontType>;
        out.add(new PairingLine(values, PairingLayout.fitFont(dc, values, PairingLayout.textWidth(dc), fonts), Graphics.COLOR_WHITE));
        if (set.reps == null) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.TrRepsOpen), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW));
        } else if (set.loadG == null) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.TrWeightOpen), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW));
        } else if (ex.perSide && set.side == PlannedSet.SIDE_BOTH) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.TrPerSide), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        } else if (ex.loadSuffix != null) {
            out.add(new PairingLine(ex.loadSuffix as String, Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        }
        out.add(new PairingLine(heartText(heartRate), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        if (ex.lastTime != null) {
            out.add(new PairingLine(ex.lastTime as String, Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        }
        return out;
    }

    // "132 bpm", or "-- bpm" without a reading (never 0).
    function heartText(heartRate as Number or Null) as String {
        var value = heartRate == null ? "--" : (heartRate as Number).toString();
        return Lang.format(TrainingText.text(Rez.Strings.TrHeartRate), [value]);
    }
}
