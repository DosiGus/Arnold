import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Lang;
import Toybox.WatchUi;

// What the recorder needs from the watch. The real one writes a FIT activity;
// tests replace it, so the state logic below runs without a recording.
class RecorderBackend {
    function initialize() {
    }

    // Opens the recording and starts the timer. False if the watch refuses.
    function open() as Boolean {
        return false;
    }

    function lap(reps as Number, loadG as Number or Null) as Boolean {
        return false;
    }

    function start() as Boolean {
        return false;
    }

    function stop() as Boolean {
        return false;
    }

    function save() as Boolean {
        return false;
    }

    function discard() as Boolean {
        return false;
    }
}

// The Garmin activity: sport Training, sub sport strength training (constants from
// Activity, 07 D-32), one lap per confirmed set with the repetitions and the weight
// as developer fields of the lap (08 row 19; Garmin Connect does not show them in its
// strength table, they are in the file).
class FitBackend extends RecorderBackend {
    private var _session as ActivityRecording.Session or Null;
    private var _reps as FitContributor.Field or Null;
    private var _load as FitContributor.Field or Null;

    function initialize() {
        RecorderBackend.initialize();
        _session = null;
        _reps = null;
        _load = null;
    }

    function open() as Boolean {
        var session = ActivityRecording.createSession({
            :name => WatchUi.loadResource(Rez.Strings.RecActivityName) as String,
            :sport => Activity.SPORT_TRAINING,
            :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING
        });
        _reps = session.createField(
            WatchUi.loadResource(Rez.Strings.RecFieldReps) as String, 0, FitContributor.DATA_TYPE_UINT16,
            { :mesgType => FitContributor.MESG_TYPE_LAP, :units => "reps" });
        _load = session.createField(
            WatchUi.loadResource(Rez.Strings.RecFieldLoad) as String, 1, FitContributor.DATA_TYPE_FLOAT,
            { :mesgType => FitContributor.MESG_TYPE_LAP, :units => "kg" });
        _session = session;
        return session.start();
    }

    // The weight goes in as kilograms (the plan has whole grams). An unknown weight
    // is not written, never a 0.
    function lap(reps as Number, loadG as Number or Null) as Boolean {
        var session = _session;
        if (session == null) {
            return false;
        }
        if (_reps != null) {
            (_reps as FitContributor.Field).setData(reps);
        }
        if (loadG != null && _load != null) {
            (_load as FitContributor.Field).setData((loadG as Number) / 1000.0);
        }
        return (session as ActivityRecording.Session).addLap();
    }

    function start() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).start();
    }

    function stop() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).stop();
    }

    function save() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).save();
    }

    function discard() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).discard();
    }
}

// The recording of one workout, in step with the player (GAR-B4-01, UMSETZUNG 7.5):
// it runs while the workout runs, stands still in a pause and on the summary, is saved
// with the workout and thrown away with it. A lap per confirmed set.
//
// The training comes first: every call is guarded, a failing recording is given up for
// good and never reaches the player or the upload. After a crash the watch saves the
// recording itself, without the developer fields; the app does not take a FIT session
// up again, the journal is the truth (07 D-31). A resumed workout gets a new recording.
class Recorder {
    var uuid as String;
    private var _backend as RecorderBackend;
    private var _open as Boolean;      // a recording exists
    private var _running as Boolean;   // its timer runs
    private var _closed as Boolean;    // saved, discarded or given up
    private var _laps as Number;
    private var _health as HealthCapture or Null;   // health values of this workout (GAR-B4-02), independent of the FIT recording

    function initialize(workoutUuid as String, backend as RecorderBackend) {
        _health = null;
        uuid = workoutUuid;
        _backend = backend;
        _open = false;
        _running = false;
        _closed = false;
        _laps = 0;
    }

    function attachHealth(health as HealthCapture or Null) as Void {
        _health = health;
    }

    // Every second while the workout is on screen: the health capture takes its heart rate samples.
    function tick() as Void {
        if (_health != null) {
            (_health as HealthCapture).tick();
        }
    }

    // Saved, thrown away or given up: this recorder cannot be used again.
    function isClosed() as Boolean {
        return _closed;
    }

    function isRunning() as Boolean {
        return _running;
    }

    function lapCount() as Number {
        return _laps;
    }

    // The timer runs: starts the recording the first time, then goes on after a pause.
    function resume() as Void {
        if (_health != null) {
            (_health as HealthCapture).resume();
        }
        if (_closed || _running) {
            return;
        }
        try {
            if (!_open) {
                if (!_backend.open()) {
                    _closed = true;
                    return;
                }
                _open = true;
                _running = true;
            } else if (_backend.start()) {
                _running = true;
            }
        } catch (e) {
            giveUp();
        }
    }

    // Pause and summary: the timer stops, the recording stays open.
    function pause() as Void {
        if (_health != null) {
            (_health as HealthCapture).pause();
        }
        if (_closed || !_running) {
            return;
        }
        try {
            _backend.stop();
            _running = false;
        } catch (e) {
            giveUp();
        }
    }

    // A set was confirmed.
    function lap(reps as Number, loadG as Number or Null) as Void {
        if (_closed || !_running) {
            return;
        }
        try {
            if (_backend.lap(reps, loadG)) {
                _laps++;
            }
        } catch (e) {
            giveUp();
        }
    }

    // The workout is saved: the activity goes to the watch history. True if it was saved.
    function save() as Boolean {
        if (_health != null) {
            (_health as HealthCapture).finish();   // before the recording ends: the watch still has the training effect
        }
        if (_closed || !_open) {
            return false;
        }
        var saved = false;
        try {
            if (_running) {
                _backend.stop();
                _running = false;
            }
            saved = _backend.save();
        } catch (e) {
            saved = false;
        }
        _closed = true;
        _open = false;
        return saved;
    }

    // The workout is thrown away: so is the recording.
    function discard() as Void {
        if (_health != null) {
            (_health as HealthCapture).discard();
        }
        if (_closed) {
            return;
        }
        if (_open) {
            try {
                if (_running) {
                    _backend.stop();
                }
                _backend.discard();
            } catch (e) {
                // nothing to do: the watch drops an unsaved recording itself
            }
        }
        _running = false;
        _open = false;
        _closed = true;
    }

    hidden function giveUp() as Void {
        _running = false;
        _closed = true;
        if (_open) {
            _open = false;
            try {
                _backend.discard();
            } catch (e) {
            }
        }
    }
}
