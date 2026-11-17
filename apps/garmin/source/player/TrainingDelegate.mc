import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Buttons of the training (UMSETZUNG 7.4, 07 D-32): START confirms, BACK asks
// "pause training?", UP and DOWN change the rest by 15 s, UP held is the menu
// (GAR-B3-05; UP and DOWN on a set are the correction and adjust screens, also GAR-B3-05).
class TrainingDelegate extends WatchUi.BehaviorDelegate {
    private var _session as TrainingSession;
    private var _sender as OutboxSender;
    private var _downSince as Number = -1;   // when DOWN went down (ms); a long press turns the page

    const LONG_PRESS_MS as Number = 500;

    function initialize(session as TrainingSession, sender as OutboxSender) {
        BehaviorDelegate.initialize();
        _session = session;
        _sender = sender;
    }

    function onSelect() as Boolean {
        if (_session.state == TrainingSession.STATE_PREVIEW) {
            _session.confirmPreview();
        } else if (_session.state == TrainingSession.STATE_SET) {
            if (_session.setNeedsInput()) {
                EditLauncher.open(_session);   // unknown reps or weight are chosen, never saved on their own
            } else {
                _session.confirmSet();
            }
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
            new WatchUi.Confirmation(TrainingText.asking(_session, Rez.Strings.TrPausePrompt)),
            new PauseConfirmDelegate(_session),
            WatchUi.SLIDE_UP
        );
        return true;
    }

    // The second page of set and rest (heart rate, last time): DOWN held, or a swipe on a touch watch.
    // UP and DOWN pressed short keep their meaning (set list, adjust, rest +/- 15 s).
    function onKeyPressed(event as WatchUi.KeyEvent) as Boolean {
        if (event.getKey() == WatchUi.KEY_DOWN) {
            _downSince = System.getTimer();
        }
        return false;
    }

    function onSwipe(event as WatchUi.SwipeEvent) as Boolean {
        var direction = event.getDirection();
        if (direction == WatchUi.SWIPE_LEFT || direction == WatchUi.SWIPE_RIGHT) {
            return turnPage();
        }
        return false;
    }

    hidden function turnPage() as Boolean {
        if (_session.state != TrainingSession.STATE_SET && _session.state != TrainingSession.STATE_REST) {
            return false;
        }
        TrainingPages.toggle(_session);
        WatchUi.requestUpdate();
        return true;
    }

    function onNextPage() as Boolean {
        if (_downSince >= 0 && System.getTimer() - _downSince >= LONG_PRESS_MS) {
            _downSince = -1;
            if (turnPage()) {
                return true;
            }
        }
        _downSince = -1;
        if (_session.isFinished()) {
            SummaryScroll.by(1);   // the summary scrolls (found on a Forerunner 255, 15.11.2026)
            WatchUi.requestUpdate();
            return true;
        }
        if (_session.state == TrainingSession.STATE_SET) {
            EditLauncher.open(_session);
            return true;
        }
        return adjustRest(-_session.REST_STEP_S);
    }

    function onPreviousPage() as Boolean {
        if (_session.isFinished()) {
            SummaryScroll.by(-1);
            WatchUi.requestUpdate();
            return true;
        }
        if (_session.state == TrainingSession.STATE_SET) {
            SetList.open(_session);
            return true;
        }
        return adjustRest(_session.REST_STEP_S);
    }

    // UP held: on the summary of an unsaved workout it discards (asked twice); during the workout it opens the menu.
    function onMenu() as Boolean {
        if (_session.isFinished()) {
            if (_sender.phaseOf(_session.uuid) == OutboxSender.PHASE_NONE) {
                WatchUi.pushView(
                    new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptDiscard)),
                    new DiscardConfirmDelegate(_session, 1, 0),
                    WatchUi.SLIDE_UP
                );
            }
        } else {
            TrainingMenu.open(_session);
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
    private var _extraPops as Number;   // screens above the training screen (the menu)

    function initialize(session as TrainingSession, step as Number, extraPops as Number) {
        ConfirmationDelegate.initialize();
        _session = session;
        _step = step;
        _extraPops = extraPops;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response != WatchUi.CONFIRM_YES) {
            return true;
        }
        if (_step == 1) {
            // Not here: the question closes itself after this returns and would close the second one with it
            // (the same hang as RUN-028, seen on a Forerunner 255). The second question comes after (RunLater).
            RunLater.call(method(:askAgain));
        } else {
            _session.discard();
            for (var i = 0; i <= _extraPops; i++) {
                WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
            }
        }
        return true;
    }

    // The second question of discarding (RunLater needs a method without a result).
    function askAgain() as Void {
        WatchUi.pushView(
            new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptDiscard2)),
            new DiscardConfirmDelegate(_session, 2, _extraPops),
            WatchUi.SLIDE_UP
        );
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
    private var _recorder as Recorder or Null;   // the recording of the workout last shown

    function initialize(journal as Journal, clock as PairingClock, signals as Signals, sender as OutboxSender) {
        _journal = journal;
        _clock = clock;
        _signals = signals;
        _sender = sender;
        _recorder = null;
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
        var health = _sender.health();
        if (health != null) {
            (health as HealthSender).sendAll();   // asks for the consent; what waits is sent
        }
        show(session as TrainingSession);
        return true;
    }

    // The recording of this workout: the same one when the workout is shown again in this run
    // of the app (after a pause), otherwise a new one (first time, or after a crash, 07 D-31).
    function recorderFor(workoutUuid as String) as Recorder {
        var current = _recorder;
        if (current != null && (current as Recorder).uuid.equals(workoutUuid) && !(current as Recorder).isClosed()) {
            return current as Recorder;
        }
        var fresh = newRecorder(workoutUuid);
        _recorder = fresh;
        return fresh;
    }

    function newRecorder(workoutUuid as String) as Recorder {
        var recorder = new Recorder(workoutUuid, new FitBackend());
        var health = _sender.health();
        if (health != null) {
            try {
                recorder.attachHealth((health as HealthSender).newCapture(workoutUuid));
            } catch (e) {
                // no health values for this workout; the training goes on
            }
        }
        return recorder;
    }

    function show(session as TrainingSession) as Void {
        session.attachRecorder(recorderFor(session.uuid));
        WatchUi.pushView(new TrainingView(session, _sender), new TrainingDelegate(session, _sender), WatchUi.SLIDE_LEFT);
    }
}
