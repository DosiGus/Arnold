import Toybox.Lang;
import Toybox.WatchUi;

// Buttons of the training (UMSETZUNG 7.4, 07 D-32): START confirms, BACK asks
// "pause training?", UP and DOWN change the rest by 15 s, UP held is the menu
// (GAR-B3-05; UP and DOWN on a set are the correction and adjust screens, also GAR-B3-05).
class TrainingDelegate extends WatchUi.BehaviorDelegate {
    private var _session as TrainingSession;
    private var _sender as OutboxSender;

    function initialize(session as TrainingSession, sender as OutboxSender) {
        BehaviorDelegate.initialize();
        _session = session;
        _sender = sender;
    }

    function onSelect() as Boolean {
        if (_session.state == TrainingSession.STATE_PREVIEW) {
            _session.confirmPreview();
        } else if (_session.state == TrainingSession.STATE_SET) {
            _session.confirmSet();
        } else if (_session.state == TrainingSession.STATE_REST) {
            _session.endRest();
        } else if (_session.isFinished()) {
            finish();
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

    // UP held: on the summary of an unsaved workout it discards (asked twice); during the workout the menu follows with GAR-B3-05.
    function onMenu() as Boolean {
        if (_session.isFinished() && _sender.phaseOf(_session.uuid) == OutboxSender.PHASE_NONE) {
            WatchUi.pushView(
                new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptDiscard)),
                new DiscardConfirmDelegate(_session, 1),
                WatchUi.SLIDE_UP
            );
        }
        return true;
    }

    // START on the summary: save and send; after the send, leave.
    function finish() as Void {
        var phase = _sender.phaseOf(_session.uuid);
        if (phase == OutboxSender.PHASE_NONE) {
            if (_session.save(_sender.outbox())) {
                _sender.sendAll();
            }
        } else if (phase == OutboxSender.PHASE_SENT) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
    }

    hidden function adjustRest(delta as Number) as Boolean {
        if (_session.state == TrainingSession.STATE_REST) {
            _session.adjustRest(delta);
            WatchUi.requestUpdate();
        }
        return true;
    }
}

// Discarding a finished workout is asked twice.
class DiscardConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _session as TrainingSession;
    private var _step as Number;

    function initialize(session as TrainingSession, step as Number) {
        ConfirmationDelegate.initialize();
        _session = session;
        _step = step;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response != WatchUi.CONFIRM_YES) {
            return true;
        }
        if (_step == 1) {
            WatchUi.pushView(
                new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptDiscard2)),
                new DiscardConfirmDelegate(_session, 2),
                WatchUi.SLIDE_UP
            );
        } else {
            _session.discard();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
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
    private var _sender as OutboxSender;

    function initialize(journal as Journal, clock as PairingClock, signals as Signals, sender as OutboxSender) {
        _journal = journal;
        _clock = clock;
        _signals = signals;
        _sender = sender;
    }

    function sender() as OutboxSender {
        return _sender;
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
        WatchUi.pushView(new TrainingView(session, _sender), new TrainingDelegate(session, _sender), WatchUi.SLIDE_LEFT);
    }
}
