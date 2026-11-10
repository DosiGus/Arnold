import Toybox.Lang;
import Toybox.WatchUi;

// Buttons of the training (UMSETZUNG 7.4, 07 D-32): START confirms, BACK asks
// "pause training?", UP and DOWN change the rest by 15 s, UP held is the menu
// (GAR-B3-05; UP and DOWN on a set are the correction and adjust screens, also GAR-B3-05).
class TrainingDelegate extends WatchUi.BehaviorDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        BehaviorDelegate.initialize();
        _session = session;
    }

    function onSelect() as Boolean {
        if (_session.state == TrainingSession.STATE_PREVIEW) {
            _session.confirmPreview();
        } else if (_session.state == TrainingSession.STATE_SET) {
            _session.confirmSet();
        } else if (_session.state == TrainingSession.STATE_REST) {
            _session.endRest();
        }
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() as Boolean {
        if (_session.isFinished()) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);   // the workout stays in the journal
            return true;
        }
        WatchUi.pushView(
            new WatchUi.Confirmation(TrainingText.text(Rez.Strings.TrPausePrompt)),
            new PauseConfirmDelegate(_session),
            WatchUi.SLIDE_UP
        );
        return true;
    }

    function onNextPage() as Boolean {
        return adjustRest(-_session.REST_STEP_S);
    }

    function onPreviousPage() as Boolean {
        return adjustRest(_session.REST_STEP_S);
    }

    function onMenu() as Boolean {
        return true;   // the workout menu follows with GAR-B3-05
    }

    hidden function adjustRest(delta as Number) as Boolean {
        if (_session.state == TrainingSession.STATE_REST) {
            _session.adjustRest(delta);
            WatchUi.requestUpdate();
        }
        return true;
    }
}

class PauseConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        ConfirmationDelegate.initialize();
        _session = session;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _session.pause();
            // The confirmation closes itself; this leaves the training screen too.
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        }
        return true;
    }
}

// Starts or continues a workout from the start screen and shows it.
class TrainingLauncher {
    private var _journal as Journal;
    private var _clock as PairingClock;
    private var _signals as Signals;

    function initialize(journal as Journal, clock as PairingClock, signals as Signals) {
        _journal = journal;
        _clock = clock;
        _signals = signals;
    }

    // Name of the workout in progress (to be continued), or null.
    function activeName() as String or Null {
        var id = _journal.activeId();
        if (id == null) {
            return null;
        }
        var head = _journal.readHead(id as String);
        if (head == null || !((head as Dictionary)["nm"] instanceof String)) {
            return null;
        }
        return (head as Dictionary)["nm"] as String;
    }

    // Continues the workout in progress, otherwise starts a new one on `day`
    // (null: nothing to start). True if a training screen was opened.
    function begin(day as Dictionary or Null) as Boolean {
        var session = TrainingSession.resume(_journal, _clock, _signals);
        if (session == null && day != null) {
            session = TrainingSession.start(day as Dictionary, _journal, _clock, _signals);
        }
        if (session == null) {
            return false;
        }
        show(session as TrainingSession);
        return true;
    }

    function show(session as TrainingSession) as Void {
        WatchUi.pushView(new TrainingView(session), new TrainingDelegate(session), WatchUi.SLIDE_LEFT);
    }
}
