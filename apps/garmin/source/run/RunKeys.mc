import Toybox.Lang;
import Toybox.WatchUi;

// What the keys of the run display do (RUN-016). The logic lives here, without WatchUi, so tests press the keys
// and look at what the session and the navigation did; RunDelegate only passes the keys on.
//
//   START/STOP   pauses the run and opens the pause menu (Continue, Save, Discard with a question)
//   LAP (BACK)   a lap or the next segment; a timed or distance segment is ended only after a question
//   UP, DOWN     pages (RunView)
//   UP long      run settings (alarms muted, auto pause)
class RunController {
    var session as RunSession;
    private var _nav as RunNav;
    private var _afterPreStart as Boolean;
    private var _ticker as RunTicker or Null;

    function initialize(runSession as RunSession, nav as RunNav, afterPreStart as Boolean, ticker as RunTicker or Null) {
        session = runSession;
        _nav = nav;
        _afterPreStart = afterPreStart;
        _ticker = ticker;
    }

    function onStart() as Void {
        if (session.isClosed() || session.state == RunSession.STATE_FINISHED) {
            return;
        }
        if (session.state == RunSession.STATE_RUNNING) {
            session.pause();
        }
        _nav.openChoices(new RunPauseChoices(self, _nav));
    }

    function onLap() as Void {
        var action = session.lapAction();
        if (action == RunSession.LAP_SKIP) {
            _nav.openChoices(new RunAskChoices(self, _nav, RunAskChoices.ACTION_SKIP));
        } else if (action != RunSession.LAP_NONE) {
            session.lapKey();
        }
    }

    function onSettings() as Void {
        if (session.isClosed() || session.state == RunSession.STATE_FINISHED) {
            return;
        }
        _nav.openChoices(new RunSettingsChoices(self, _nav));
    }

    // SAVE: the watch saves the activity, the summary takes over.
    function save() as Void {
        var saved = session.save();
        stopTicker();
        _nav.pop();                                   // the pause menu
        _nav.toSummary(saved, _afterPreStart);
    }

    // Yes to "Discard?": the run and its journal are gone, back to the start screen.
    function discard() as Void {
        session.discard();
        stopTicker();
        _nav.pop();                                   // the question
        _nav.pop();                                   // the pause menu
        _nav.leave(_afterPreStart);                   // the run display (and the pre-start screen)
    }

    // Yes to "Skip segment?".
    function skip() as Void {
        session.nextSegment();
        _nav.pop();
    }

    hidden function stopTicker() as Void {
        if (_ticker != null) {
            (_ticker as RunTicker).stop();
        }
    }
}

class RunPauseChoices extends RunChoices {
    const CONTINUE as Number = 0;
    const SAVE as Number = 1;
    const DISCARD as Number = 2;

    private var _controller as RunController;

    function initialize(controller as RunController, nav as RunNav) {
        RunChoices.initialize(nav);
        _controller = controller;
    }

    function title() as String {
        return HomeScreen.text(_controller.session.state == RunSession.STATE_AUTO_PAUSED ? Rez.Strings.RunAutoPaused : Rez.Strings.RunPaused);
    }

    function labels() as Array<String> {
        return [HomeScreen.text(Rez.Strings.RunContinue), HomeScreen.text(Rez.Strings.RunSave), HomeScreen.text(Rez.Strings.RunDiscard)] as Array<String>;
    }

    function onChoose(index as Number) as Void {
        if (index == CONTINUE) {
            _controller.session.resume();
            _nav.pop();
        } else if (index == SAVE) {
            _controller.save();
        } else {
            _nav.openChoices(new RunAskChoices(_controller, _nav, RunAskChoices.ACTION_DISCARD));
        }
    }
}

// "Discard this run?" / "Skip this segment?": No is selected first, so a stray press changes nothing.
class RunAskChoices extends RunChoices {
    enum Action {
        ACTION_DISCARD,
        ACTION_SKIP
    }

    private var _controller as RunController;
    private var _action as Number;

    function initialize(controller as RunController, nav as RunNav, action as Number) {
        RunChoices.initialize(nav);
        _controller = controller;
        _action = action;
    }

    function title() as String {
        return HomeScreen.text(_action == ACTION_DISCARD ? Rez.Strings.RunAskDiscard : Rez.Strings.RunAskSkip);
    }

    function labels() as Array<String> {
        return [HomeScreen.text(Rez.Strings.RunNo), HomeScreen.text(Rez.Strings.RunYes)] as Array<String>;
    }

    function onChoose(index as Number) as Void {
        if (index == 0) {
            _nav.pop();
        } else if (_action == ACTION_DISCARD) {
            _controller.discard();
        } else {
            _controller.skip();
        }
    }
}

// Run settings (UP long): alarms muted for this run, auto pause. Choosing a line switches it and the line says so.
class RunSettingsChoices extends RunChoices {
    private var _controller as RunController;

    function initialize(controller as RunController, nav as RunNav) {
        RunChoices.initialize(nav);
        _controller = controller;
    }

    function title() as String {
        return HomeScreen.text(Rez.Strings.RunSettingsTitle);
    }

    function labels() as Array<String> {
        var session = _controller.session;
        return [
            HomeScreen.text(session.muted ? Rez.Strings.RunMuteOn : Rez.Strings.RunMuteOff),
            HomeScreen.text(session.autoPauseOn() ? Rez.Strings.RunAutoOn : Rez.Strings.RunAutoOff)
        ] as Array<String>;
    }

    function onChoose(index as Number) as Void {
        var session = _controller.session;
        if (index == 0) {
            session.muted = !session.muted;
        } else {
            session.setAutoPause(!session.autoPauseOn());
        }
    }
}

// The keys of the run display, handed to the controller.
class RunDelegate extends WatchUi.BehaviorDelegate {
    private var _controller as RunController;
    private var _view as RunView;

    function initialize(controller as RunController, view as RunView) {
        BehaviorDelegate.initialize();
        _controller = controller;
        _view = view;
    }

    function onSelect() as Boolean {
        _controller.onStart();
        return true;
    }

    // The lap key of the Forerunners; the watches without one (fenix) use BACK, as Garmin's own run does.
    function onKey(event as WatchUi.KeyEvent) as Boolean {
        if (event.getKey() == WatchUi.KEY_LAP) {
            _controller.onLap();
            return true;
        }
        return BehaviorDelegate.onKey(event);
    }

    function onBack() as Boolean {
        _controller.onLap();
        return true;
    }

    function onNextPage() as Boolean {
        _view.movePage(1);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.movePage(-1);
        WatchUi.requestUpdate();
        return true;
    }

    function onMenu() as Boolean {
        _controller.onSettings();
        return true;
    }

    // A tap in the rain or with a sleeve must not pause the run.
    function onTap(event as WatchUi.ClickEvent) as Boolean {
        return true;
    }
}
