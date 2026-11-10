import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// The adjust screen (PRD T-03, P-03): one field at a time, UP and DOWN change it,
// START goes on, BACK cancels. An unknown value says "choose" until it was chosen.
class EditView extends WatchUi.View {
    private var _session as TrainingSession;
    private var _adjust as SetAdjust;

    function initialize(session as TrainingSession, adjust as SetAdjust) {
        View.initialize();
        _session = session;
        _adjust = adjust;
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, EditScreen.lines(dc, _session, _adjust));
    }
}

module EditScreen {

    function lines(dc as Dc, session as TrainingSession, adjust as SetAdjust) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var ex = session.exercise();
        out.add(new PairingLine(ex.name, Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable());
        out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.TrSetOf), [adjust.setIndex + 1, ex.sets.size()]), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        var onReps = adjust.field == SetAdjust.FIELD_REPS;
        var unknown = onReps ? adjust.repsUnknown : adjust.loadUnknown;
        var label = onReps
            ? (unknown ? Rez.Strings.EditRepsPick : Rez.Strings.EditReps)
            : (unknown ? Rez.Strings.EditLoadPick : Rez.Strings.EditLoad);
        out.add(new PairingLine(TrainingText.text(label), Graphics.FONT_XTINY, unknown ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY));
        var value = onReps ? adjust.reps.toString() : TrainingText.kg(adjust.loadG, TrainingText.separator());
        out.add(PairingLayout.bigLine(dc, value, Graphics.COLOR_WHITE));
        out.add(new PairingLine(onReps ? TrainingText.text(Rez.Strings.TrRepsUnit) : TrainingText.text(Rez.Strings.TrKg), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        out.add(new PairingLine(TrainingText.text(onReps ? Rez.Strings.EditNextHint : Rez.Strings.EditDoneHint), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        return out;
    }
}

// Buttons of the adjust screen.
class EditDelegate extends WatchUi.BehaviorDelegate {
    private var _session as TrainingSession;
    private var _adjust as SetAdjust;

    function initialize(session as TrainingSession, adjust as SetAdjust) {
        BehaviorDelegate.initialize();
        _session = session;
        _adjust = adjust;
    }

    function onPreviousPage() as Boolean {
        _adjust.up();
        WatchUi.requestUpdate();
        return true;
    }

    function onNextPage() as Boolean {
        _adjust.down();
        WatchUi.requestUpdate();
        return true;
    }

    function onSelect() as Boolean {
        if (_adjust.next()) {
            complete();
        }
        WatchUi.requestUpdate();
        return true;
    }

    // BACK: leave without changing anything.
    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    // The choice is complete: ask about the later sets if there are any and the values changed.
    function complete() as Void {
        if (!_adjust.changed()) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        } else if (_session.doneSet(_adjust.setIndex) == null && _session.hasSetsAfter(_adjust.setIndex)) {
            WatchUi.pushView(
                new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptApplyRest)),
                new ApplyRestDelegate(_session, _adjust),
                WatchUi.SLIDE_UP
            );
        } else {
            _session.editSet(_adjust.setIndex, _adjust.reps, _adjust.loadG, false);
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
    }
}

// "Apply to the remaining sets?" yes: all later sets of the exercise, no: only this set.
class ApplyRestDelegate extends WatchUi.ConfirmationDelegate {
    private var _session as TrainingSession;
    private var _adjust as SetAdjust;

    function initialize(session as TrainingSession, adjust as SetAdjust) {
        ConfirmationDelegate.initialize();
        _session = session;
        _adjust = adjust;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        _session.editSet(_adjust.setIndex, _adjust.reps, _adjust.loadG, response == WatchUi.CONFIRM_YES);
        // The confirmation closes itself; this closes the adjust screen below it.
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }
}

// Opens the adjust screen on a set of the exercise on screen: the set on screen (DOWN, START
// on an open value) or one picked in the list of sets. A confirmed set is corrected.
module EditLauncher {
    function open(session as TrainingSession) as Void {
        if (session.state == TrainingSession.STATE_SET) {
            var adjust = make(session, session.setIdx);
            WatchUi.pushView(new EditView(session, adjust), new EditDelegate(session, adjust), WatchUi.SLIDE_LEFT);
        }
    }

    // Replaces the screen on top (the list of sets) by the adjust screen of set `index`.
    function switchTo(session as TrainingSession, index as Number) as Void {
        var adjust = make(session, index);
        WatchUi.switchToView(new EditView(session, adjust), new EditDelegate(session, adjust), WatchUi.SLIDE_LEFT);
    }

    function make(session as TrainingSession, index as Number) as SetAdjust {
        var planned = session.exercise().sets[index];
        var done = session.doneSet(index);
        var shown = planned;
        if (done != null) {
            var d = done as Dictionary;
            shown = new PlannedSet(d["r"] as Number, d["g"] instanceof Number ? d["g"] as Number : null, planned.side);
        }
        var adjust = new SetAdjust(shown, session.exercise(), SetAdjust.FIELD_REPS);
        adjust.setIndex = index;
        return adjust;
    }
}
