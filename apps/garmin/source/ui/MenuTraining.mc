import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// The workout menu (UP held, UMSETZUNG 7.4): what can be done to the workout in progress.
module TrainingMenu {

    function build(session as TrainingSession) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.MenuTitle) as String });
        if (session.state == TrainingSession.STATE_SET || session.state == TrainingSession.STATE_REST) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuSets), null, :sets, null));
        }
        if (session.canUndo()) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuUndo), null, :undo, null));
        }
        if (session.canAddSet()) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuAddSet), null, :addSet, null));
        }
        if (session.canRemoveSet()) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuRemoveSet), null, :removeSet, null));
        }
        if (session.canSwap()) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuSwap), null, :swap, null));
        }
        if (session.state != TrainingSession.STATE_FINISHED) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuHints), null, :hints, null));
            if (TrainingMenu.recentExercises().size() > 0) {
                menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuAddExercise), null, :addExercise, null));
            }
        }
        if (session.canSkipExercise()) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuSkip), null, :skip, null));
        }
        menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuEnd), null, :end, null));
        menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuDiscard), null, :discard, null));
        return menu;
    }

    function open(session as TrainingSession) as Void {
        WatchUi.pushView(build(session), new TrainingMenuDelegate(session), WatchUi.SLIDE_LEFT);
    }

    // The recently trained exercises the plan loaded for "add exercise" (up to 10), from the storage.
    function recentExercises() as Array {
        var recent = new PlanCache(new KeyValueStore()).recent();
        var out = [] as Array;
        if (recent == null) {
            return out;
        }
        for (var i = 0; i < (recent as Array).size(); i++) {
            var entry = (recent as Array)[i];
            if (entry instanceof Dictionary && (entry as Dictionary)["id"] instanceof String && (entry as Dictionary)["n"] instanceof String) {
                out.add(entry);
            }
        }
        return out;
    }

    // "3 sets · 8 x 60 kg": what an exercise proposes; "" when it proposes nothing.
    function proposal(plan as TrainingPlan, entry as Dictionary) as String {
        var sets = plan.expand(entry["s"] as Object or Null);
        if (sets.size() == 0) {
            return "";
        }
        var count = Lang.format(TrainingText.text(sets.size() == 1 ? Rez.Strings.TrSetOne : Rez.Strings.TrSets), [sets.size()]);
        return count + " · " + TrainingText.repsAndLoad(sets[0]);
    }

    // The list to swap the exercise on screen: each alternative with its own proposal.
    function swapList(session as TrainingSession) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => TrainingText.text(Rez.Strings.MenuSwap) });
        var options = session.swapOptions();
        for (var i = 0; i < options.size(); i++) {
            var entry = session.plan.catalog[options[i]] as Dictionary;
            menu.addItem(new WatchUi.MenuItem(entry["n"] as String, proposal(session.plan, entry), options[i], null));
        }
        return menu;
    }

    function addList(session as TrainingSession, recent as Array) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => TrainingText.text(Rez.Strings.MenuAddExercise) });
        for (var i = 0; i < recent.size(); i++) {
            var entry = recent[i] as Dictionary;
            menu.addItem(new WatchUi.MenuItem(entry["n"] as String, proposal(session.plan, entry), i, null));
        }
        return menu;
    }
}

class TrainingMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        Menu2InputDelegate.initialize();
        _session = session;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :sets) {
            WatchUi.switchToView(SetList.build(_session), new SetListDelegate(_session), WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :undo) {
            _session.undoLastSet();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :addSet) {
            _session.addSet();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :removeSet) {
            _session.removeLastSet();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :swap) {
            WatchUi.switchToView(TrainingMenu.swapList(_session), new SwapDelegate(_session), WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :hints) {
            WatchUi.switchToView(new HintsView(_session), new HintsDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :addExercise) {
            var recent = TrainingMenu.recentExercises();
            WatchUi.switchToView(TrainingMenu.addList(_session, recent), new AddExerciseDelegate(_session, recent), WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :skip) {
            _session.skipExercise();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :end) {
            // Nothing trained yet: there is nothing to save, so ending means discarding.
            if (_session.setsDone() == 0) {
                discard();
            } else {
                WatchUi.pushView(
                    new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptEnd)),
                    new EndConfirmDelegate(_session),
                    WatchUi.SLIDE_UP
                );
            }
        } else if (id == :discard) {
            discard();
        }
    }

    hidden function discard() as Void {
        WatchUi.pushView(
            new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptDiscard)),
            new DiscardConfirmDelegate(_session, 1, 1),
            WatchUi.SLIDE_UP
        );
    }
}

// "End workout?" yes: the summary of what was done.
class EndConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        ConfirmationDelegate.initialize();
        _session = session;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _session.finishEarly();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);   // closes the menu below
        }
        return true;
    }
}

// A picked alternative replaces the exercise on screen.
class SwapDelegate extends WatchUi.Menu2InputDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        Menu2InputDelegate.initialize();
        _session = session;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        _session.swapTo(item.getId() as Number);
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }
}

// A picked recent exercise is added at the end of the day.
class AddExerciseDelegate extends WatchUi.Menu2InputDelegate {
    private var _session as TrainingSession;
    private var _recent as Array;

    function initialize(session as TrainingSession, recent as Array) {
        Menu2InputDelegate.initialize();
        _session = session;
        _recent = recent;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        _session.addExercise(_recent[item.getId() as Number] as Dictionary);
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }
}

// The notes of the exercise on screen: the progression hint, last time, the plan's own note.
class HintsView extends WatchUi.View {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        View.initialize();
        _session = session;
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, HintsScreen.lines(_session.exercise()));
    }
}

module HintsScreen {
    function lines(ex as PlannedExercise) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(ex.name, Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        if (ex.hint != null) {
            out.add(new PairingLine(ex.hint as String, Graphics.FONT_SMALL, Graphics.COLOR_YELLOW));
        }
        if (ex.lastTime != null) {
            out.add(new PairingLine(ex.lastTime as String, Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
        }
        if (ex.note != null) {
            out.add(new PairingLine(ex.note as String, Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
        }
        if (out.size() == 1) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.HintNone), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        }
        return out;
    }
}

// BACK or START closes the notes.
class HintsDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    function onSelect() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}
