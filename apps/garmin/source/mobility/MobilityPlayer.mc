import Toybox.Lang;

// Vibration and tone of the mobility player (MOB-009): a short buzz when the side changes, two short ones when
// the next exercise is announced, one long one at the end. Same switches as everywhere (Settings: vibration,
// tone), the patterns go through Signals.outputPattern, which tests replace.
class MobilitySignals {
    static const SIDE as Number = 20;
    static const NEXT as Number = 21;
    static const FINISHED as Number = 22;

    private var _signals as Signals;
    private var _settings as Settings;

    function initialize(signals as Signals, settings as Settings) {
        _signals = signals;
        _settings = settings;
    }

    function sideSwitch() as Void {
        fire(SIDE, [150] as Array<Number>, false);
    }

    function nextExercise() as Void {
        fire(NEXT, [150, 100, 150] as Array<Number>, false);
    }

    function finished() as Void {
        fire(FINISHED, [500] as Array<Number>, true);
    }

    hidden function fire(pattern as Number, steps as Array<Number>, loud as Boolean) as Void {
        _signals.outputPattern(pattern, steps, loud, _settings.isOn(Settings.VIBRATION), _settings.isOn(Settings.TONE));
    }
}

// One mobility routine being done (MOB-009): the state machine behind the player screen. It knows no screen;
// the view calls tick() every second and the keys call toggle(), skip() and endEarly().
//
//   next    5 s: the name of the exercise that comes (double buzz), also before the first one
//   side    t seconds per side; at the end of the first of two sides: switch
//   switch  3 s: change the side (short buzz), then the second side
//   end     all done or stopped: the summary
//
// Time comes from the clock, second by second, so a late tick does not lose time. A pause freezes everything.
// The result keeps the field names of WatchMobilityRequestSchema; sending follows in MOB-010.
class MobilityPlayer {
    enum Phase {
        PH_NEXT,
        PH_SIDE,
        PH_SWITCH,
        PH_END
    }

    static const NEXT_S as Number = 5;
    static const SWITCH_S as Number = 3;
    static const MAX_CATCHUP_S as Number = 60;
    static const NOTE_EVERY_S as Number = 30;   // the journal is written after every exercise and every 30 s of movement

    var phase as Phase;
    var exIdx as Number;
    var side as Number;       // 0 first side, 1 second side
    var remain as Number;     // seconds left in the phase
    var endedEarly as Boolean;
    var sessionId as String;
    var kind as String;       // "morning" or "session"
    var uuid as String;
    var planVersion as String;   // the plan version of the routine ("" when the answer had none)

    private var _exercises as Array;
    private var _results as Array<Dictionary>;
    private var _spent as Number;      // seconds done on the exercise on screen
    private var _timerS as Number;     // seconds of movement in all
    private var _elapsedS as Number;   // seconds the player ran (pauses not counted)
    private var _paused as Boolean;
    private var _saved as Boolean;
    private var _last as Number;
    private var _startedAt as Number;
    private var _endedAt as Number;
    private var _offset as Number;
    private var _clock as PairingClock;
    private var _signals as MobilitySignals;
    private var _recorder as Recorder;
    private var _journal as MobilityJournal or Null;
    private var _outbox as MobilityOutbox or Null;
    private var _sendNow as (Method() as Void) or Null;

    function initialize(id as String, routineKind as String, routine as Dictionary, clock as PairingClock, signals as MobilitySignals, recorder as Recorder) {
        sessionId = id;
        kind = routineKind;
        uuid = Uuid.v4();
        _exercises = routine["ex"] as Array;
        planVersion = routine["p"] instanceof String ? routine["p"] as String : "";
        _results = [] as Array<Dictionary>;
        _clock = clock;
        _signals = signals;
        _recorder = recorder;
        _journal = null;
        _outbox = null;
        _sendNow = null;
        phase = PH_NEXT;
        exIdx = 0;
        side = 0;
        remain = NEXT_S;
        endedEarly = false;
        _spent = 0;
        _timerS = 0;
        _elapsedS = 0;
        _paused = false;
        _saved = false;
        _startedAt = clock.nowSeconds();
        _endedAt = _startedAt;
        _last = _startedAt;
        _offset = clock.utcOffsetMinutes();
    }

    // The journal of the routine, the outbox for its result and what starts the sending (MOB-010).
    function connect(journal as MobilityJournal, outbox as MobilityOutbox, sendNow as (Method() as Void) or Null) as Void {
        _journal = journal;
        _outbox = outbox;
        _sendNow = sendNow;
    }

    // The routine starts: the recording runs and the first exercise is announced.
    function begin() as Void {
        _startedAt = _clock.nowSeconds();
        _last = _startedAt;
        _offset = _clock.utcOffsetMinutes();
        _recorder.resume();
        _signals.nextExercise();
        if (_journal != null) {
            (_journal as MobilityJournal).begin(uuid, headOf());
            MobilityHandover.live = uuid;
        }
    }

    // What the journal keeps: the exercises done so far, the exercise under way with its seconds, the times.
    hidden function headOf() as Dictionary {
        return {
            "st" => phase == PH_END ? MobilityJournal.STATE_ENDED : MobilityJournal.STATE_RUNNING,
            "id" => sessionId, "pv" => planVersion, "k" => kind, "o" => _offset, "a" => _startedAt, "lt" => _clock.nowSeconds(),
            "tm" => _timerS, "el" => _elapsedS, "ee" => endedEarly ? 1 : 0, "cs" => _spent,
            "ci" => phase == PH_END ? "" : exercise()["c"], "ex" => _results
        } as Dictionary;
    }

    hidden function note() as Void {
        if (_journal != null) {
            (_journal as MobilityJournal).saveHead(uuid, headOf());
        }
    }

    function exercise() as Dictionary {
        return _exercises[exIdx] as Dictionary;
    }

    function exerciseCount() as Number {
        return _exercises.size();
    }

    function sides() as Number {
        return exercise()["s"] as Number;
    }

    function secondsPerSide() as Number {
        return exercise()["t"] as Number;
    }

    function reps() as Number or Null {
        var value = exercise()["r"];
        return value instanceof Number ? value as Number : null;
    }

    // The length of the phase on screen, for the ring.
    function phaseLength() as Number {
        if (phase == PH_NEXT) {
            return NEXT_S;
        }
        return phase == PH_SWITCH ? SWITCH_S : secondsPerSide();
    }

    function isPaused() as Boolean {
        return _paused;
    }

    function isSaved() as Boolean {
        return _saved;
    }

    function timerSeconds() as Number {
        return _timerS;
    }

    function elapsedSeconds() as Number {
        return _elapsedS;
    }

    function recordedCount() as Number {
        return _results.size();
    }

    function countOf(status as String) as Number {
        var n = 0;
        for (var i = 0; i < _results.size(); i++) {
            if (status.equals(_results[i]["st"] as String)) {
                n++;
            }
        }
        return n;
    }

    // Every second (or later): moves the time on by the seconds that passed on the clock.
    function tick() as Void {
        var now = _clock.nowSeconds();
        var gone = now - _last;
        if (gone <= 0) {
            return;
        }
        _last = now;
        if (_paused || phase == PH_END) {
            return;
        }
        if (gone > MAX_CATCHUP_S) {
            gone = MAX_CATCHUP_S;
        }
        for (var i = 0; i < gone && phase != PH_END; i++) {
            step();
        }
    }

    hidden function step() as Void {
        _elapsedS++;
        remain--;
        if (phase == PH_SIDE) {
            _spent++;
            _timerS++;
            if (_timerS % NOTE_EVERY_S == 0) {
                note();
            }
        }
        if (remain > 0) {
            return;
        }
        if (phase == PH_NEXT) {
            phase = PH_SIDE;
            remain = secondsPerSide();
        } else if (phase == PH_SWITCH) {
            side = 1;
            phase = PH_SIDE;
            remain = secondsPerSide();
        } else if (sides() == 2 && side == 0) {
            phase = PH_SWITCH;
            remain = SWITCH_S;
            _signals.sideSwitch();
        } else {
            finishExercise("done");
        }
    }

    // The exercise on screen is over (done or skipped): it is written down, the next one is announced.
    hidden function finishExercise(status as String) as Void {
        record(status);
        _spent = 0;
        side = 0;
        if (exIdx + 1 >= _exercises.size()) {
            stop(false);
            return;
        }
        exIdx++;
        phase = PH_NEXT;
        remain = NEXT_S;
        _signals.nextExercise();
        note();   // after the exercise is written down and the next one is announced
    }

    hidden function record(status as String) as Void {
        _results.add({ "c" => exercise()["c"], "st" => status, "t" => _spent } as Dictionary);
        if (_spent > 0) {
            _recorder.lap(0, null);   // a lap for each exercise that was done for some time
        }
    }

    hidden function stop(early as Boolean) as Void {
        phase = PH_END;
        endedEarly = early;
        _endedAt = _clock.nowSeconds();
        _recorder.pause();
        if (!early) {
            _signals.finished();
        }
        note();
    }

    // DOWN: the exercise on screen (or announced) is left out.
    function skip() as Void {
        if (phase != PH_END) {
            finishExercise("skipped");
        }
    }

    // BACK, answered with yes: the routine ends here. The exercise under way counts as partial,
    // the ones not reached are not listed.
    function endEarly() as Void {
        if (phase == PH_END) {
            return;
        }
        if (_spent > 0) {
            record("partial");
            _spent = 0;
        }
        stop(true);
    }

    function pause() as Void {
        if (phase != PH_END && !_paused) {
            _paused = true;
            _recorder.pause();
        }
    }

    function resume() as Void {
        if (phase != PH_END && _paused) {
            _paused = false;
            _last = _clock.nowSeconds();
            _recorder.resume();
        }
    }

    function toggle() as Void {
        if (_paused) {
            resume();
        } else {
            pause();
        }
    }

    // Something worth saving: at least one exercise is written down.
    function canSave() as Boolean {
        return phase == PH_END && _results.size() > 0;
    }

    // The summary's START: the recording goes to the watch history and the result is frozen in the outbox, which is
    // sent at once (MOB-010). The journal is dropped with it.
    function save() as Boolean {
        if (!canSave() || _saved) {
            return false;
        }
        _recorder.save();
        if (_outbox != null) {
            (_outbox as MobilityOutbox).addResult(result(), _clock.nowSeconds());
        }
        _saved = true;
        finish();
        if (_sendNow != null) {
            (_sendNow as Method() as Void).invoke();
        }
        return true;
    }

    function discard() as Void {
        _recorder.discard();
        finish();
    }

    // The routine is over for this process: nothing of it is "interrupted" any more.
    hidden function finish() as Void {
        if (_journal != null) {
            (_journal as MobilityJournal).discard(uuid);
        }
        MobilityHandover.live = null;
    }

    // The finished routine as WatchMobilityRequestSchema has it (without request_id and plan_version_id, which
    // the sending adds): ex = [{ c, st "done"|"skipped"|"partial", t }].
    function result() as Dictionary {
        var out = {
            "session_uuid" => uuid,
            "kind" => kind,
            "session_id" => sessionId,
            "workout_date_local" => Clock.localDate(_startedAt, _offset),
            "utc_offset_min" => _offset,
            "started_at_utc" => Clock.isoUtc(_startedAt),
            "ended_at_utc" => Clock.isoUtc(_endedAt),
            "timer_s" => _timerS,
            "elapsed_s" => _elapsedS,
            "ended_early" => endedEarly,
            "ex" => _results
        } as Dictionary;
        if (planVersion.length() > 0) {
            out["plan_version_id"] = planVersion;
        }
        return out;
    }
}
