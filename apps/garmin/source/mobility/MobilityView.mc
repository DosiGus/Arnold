import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// What the mobility player shows (MOB-009), in the Instrument design like the rest of the strength training:
// the name at the top, the countdown as the one big value, the side or the unit below it, the cue at the bottom
// and a ring that runs down over the phase. Plain data, so tests read it.
module MobilityScreen {
    const NAME_CHARS as Number = 16;   // one grey line of the top
    const CUE_CHARS as Number = 20;    // the cue at the bottom, in the smaller font if needed
    const NEXT_CHARS as Number = 14;   // the next name under the number

    function face(player as MobilityPlayer) as InstrumentFace {
        var f = new InstrumentFace();
        var ex = player.exercise();
        var left = player.remain;
        var total = player.phaseLength();
        var paused = player.isPaused();
        f.hero = TrainingText.clock(left);
        f.heroColor = paused ? Instrument.LABEL : Graphics.COLOR_WHITE;
        if (player.phase == MobilityPlayer.PH_NEXT) {
            // "Next up", the number of seconds, the name of the exercise (two lines if it is long).
            var name = SetScreen.wrap(ex["n"] as String, NEXT_CHARS);
            f.top = [MobilityPreviewScreen.text(Rez.Strings.MobNext)] as Array<String>;
            f.hero = left.toString();
            f.sub = name[0];
            f.bottom = name.size() > 1 ? name[1] : null;
            f.bottomColor = Graphics.COLOR_WHITE;
        } else {
            f.top = SetScreen.wrap(ex["n"] as String, NAME_CHARS);
            if (player.phase == MobilityPlayer.PH_SWITCH) {
                f.hero = left.toString();
                f.sub = MobilityPreviewScreen.text(Rez.Strings.MobSwitch);
                f.bottom = TrainingText.sideText(PlannedSet.SIDE_RIGHT);
            } else {
                f.sub = sideAndUnit(player);
                var reps = player.reps();
                if (reps != null) {
                    f.hero = (reps as Number).toString();
                }
                var cue = ex["h"];
                f.bottom = cue instanceof String ? SetScreen.ellipsize(cue as String, CUE_CHARS) : null;
            }
        }
        if (paused) {
            f.bottom = MobilityPreviewScreen.text(Rez.Strings.MobPaused);
            f.bottomColor = Instrument.WARN;
        }
        // The ring runs down: it ends at twelve o'clock, its length is what is left of the phase.
        f.ring = InstrumentFace.RING_TIME;
        var length = 0;
        if (total > 0 && left > 0) {
            length = (left > total ? total : left) * 360 / total;
        }
        f.timeLength = length;
        f.timeFrom = 360 - length;
        f.ringColor = paused ? Instrument.LABEL : Graphics.COLOR_WHITE;
        return f;
    }

    // "Left", "Reps", "Left · Reps"; null for one side without repetitions.
    function sideAndUnit(player as MobilityPlayer) as String or Null {
        var side = player.sides() == 2 ? TrainingText.sideText(player.side == 0 ? PlannedSet.SIDE_LEFT : PlannedSet.SIDE_RIGHT) : null;
        var unit = player.reps() == null ? null : TrainingText.text(Rez.Strings.TrRepsUnit);
        if (side != null && unit != null) {
            return (side as String) + " · " + (unit as String);
        }
        return side != null ? side : unit;
    }

    // The end: what was done, then START saves and BACK discards.
    function summary(player as MobilityPlayer) as Array<PairingLine> {
        var white = Graphics.COLOR_WHITE;
        var gray = Instrument.LABEL;
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(MobilityPreviewScreen.text(player.endedEarly ? Rez.Strings.MobEnded : Rez.Strings.MobDone), Graphics.FONT_MEDIUM, white));
        if (!player.canSave()) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumNothing), Graphics.FONT_XTINY, gray));
            out.add(new PairingLine(MobilityPreviewScreen.text(Rez.Strings.MobDiscardHint), Graphics.FONT_XTINY, white));
            return out;
        }
        out.add(new PairingLine(TrainingText.clock(player.elapsedSeconds()), Graphics.FONT_SMALL, white));
        out.add(new PairingLine(Lang.format(MobilityPreviewScreen.text(Rez.Strings.MobSumDone), [player.countOf("done"), player.exerciseCount()]), Graphics.FONT_XTINY, gray));
        var skipped = player.countOf("skipped");
        if (skipped > 0) {
            out.add(new PairingLine(Lang.format(MobilityPreviewScreen.text(Rez.Strings.MobSumSkipped), [skipped]), Graphics.FONT_XTINY, gray).skippable());
        }
        if (player.isSaved()) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumSaved), Graphics.FONT_XTINY, white));
        } else {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumSave), Graphics.FONT_XTINY, white));
            out.add(new PairingLine(MobilityPreviewScreen.text(Rez.Strings.MobDiscardHint), Graphics.FONT_XTINY, gray).skippable());
        }
        return out;
    }
}

// The player screen. A timer every second moves the countdown; while a question or the menu covers the
// view the timer is off (the question pauses the player).
class MobilityView extends WatchUi.View {
    var player as MobilityPlayer;
    private var _timer as Timer.Timer or Null;

    function initialize(routinePlayer as MobilityPlayer) {
        View.initialize();
        player = routinePlayer;
        _timer = null;
    }

    function onShow() as Void {
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
        player.tick();
    }

    function onHide() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        player.tick();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        if (player.phase == MobilityPlayer.PH_END) {
            PairingLayout.draw(dc, MobilityScreen.summary(player));
        } else {
            Instrument.draw(dc, MobilityScreen.face(player));
        }
    }
}
