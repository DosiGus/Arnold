import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Lang;
import Toybox.UserProfile;
import Toybox.WatchUi;

// What the run session needs from the watch's recording. The real one writes a FIT activity;
// tests replace it, so the logic below runs without a recording.
class RunBackend {
    function initialize() {
    }

    // Opens the recording for this environment (PreStartModel.ENV_*) and starts its timer. False if the watch refuses.
    function open(environment as Number) as Boolean {
        return false;
    }

    // Closes a lap; `segment` is the number of the segment it covered (1 based), 0 for none.
    function lap(segment as Number) as Boolean {
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

// The Garmin activity of a run: sport running, sub sport street, treadmill or track by the environment.
// One lap per segment (otherwise per km), the segment number as a developer field of the lap.
class FitRunBackend extends RunBackend {
    private var _session as ActivityRecording.Session or Null;
    private var _segment as FitContributor.Field or Null;

    function initialize() {
        RunBackend.initialize();
        _session = null;
        _segment = null;
    }

    function open(environment as Number) as Boolean {
        var sub = Activity.SUB_SPORT_STREET;
        if (environment == PreStartModel.ENV_TREADMILL) {
            sub = Activity.SUB_SPORT_TREADMILL;
        } else if (environment == PreStartModel.ENV_TRACK) {
            sub = Activity.SUB_SPORT_TRACK;
        }
        var session = ActivityRecording.createSession({
            :name => WatchUi.loadResource(Rez.Strings.RecRunName) as String,
            :sport => Activity.SPORT_RUNNING,
            :subSport => sub
        });
        _segment = session.createField(
            WatchUi.loadResource(Rez.Strings.RecFieldSegment) as String, 0, FitContributor.DATA_TYPE_UINT8,
            { :mesgType => FitContributor.MESG_TYPE_LAP });
        _session = session;
        return session.start();
    }

    function lap(segment as Number) as Boolean {
        var session = _session;
        if (session == null) {
            return false;
        }
        if (_segment != null) {
            (_segment as FitContributor.Field).setData(segment);
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

// The readings of the running activity.
class ActivityRunSource extends RunSource {
    function initialize() {
        RunSource.initialize();
    }

    function read(into as RunReading) as Void {
        into.clear();
        if (!(Toybox has :Activity) || !(Activity has :getActivityInfo)) {
            return;
        }
        var info = Activity.getActivityInfo();
        if (info != null) {
            fill(info, into);
        }
    }

    hidden function fill(info as Activity.Info, into as RunReading) as Void {
        if (info has :timerTime && info.timerTime != null) {
            into.timerS = (info.timerTime as Number) / 1000;
        }
        if (info has :elapsedDistance && info.elapsedDistance != null) {
            into.distanceCm = ((info.elapsedDistance as Float) * 100).toNumber();
        }
        if (info has :currentSpeed && info.currentSpeed != null) {
            into.speedCmS = ((info.currentSpeed as Float) * 100).toNumber();
        }
        if (info has :currentHeartRate && info.currentHeartRate != null) {
            into.heartRate = info.currentHeartRate as Number;
        }
        if (info has :currentCadence && info.currentCadence != null) {
            into.cadence = info.currentCadence as Number;
        }
        if (info has :totalAscent && info.totalAscent != null) {
            into.ascentM = (info.totalAscent as Float).toNumber();
        }
    }
}

// The heart rate zones the watch has for running.
module RunZones {
    function fromProfile() as Array<Number> or Null {
        if (!(Toybox has :UserProfile) || !(UserProfile has :getHeartRateZones)) {
            return null;
        }
        var zones = UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_RUNNING);
        return zones != null && zones.size() >= 6 ? zones : null;
    }
}

// Everything a run session talks to; tests replace the parts.
class RunParts {
    var journal as RunJournal;
    var clock as PairingClock;
    var settings as Settings;
    var source as RunSource;
    var backend as RunBackend;
    var sensors as RunSensors or Null;
    var zones as Array<Number> or Null;

    function initialize(runJournal as RunJournal, pairingClock as PairingClock, userSettings as Settings,
                        readings as RunSource, recording as RunBackend, runSensors as RunSensors or Null, hrZones as Array<Number> or Null) {
        journal = runJournal;
        clock = pairingClock;
        settings = userSettings;
        source = readings;
        backend = recording;
        sensors = runSensors;
        zones = hrZones;
    }
}

// One run on the watch (RUN-015): the Garmin recording, the second-by-second values, the segments of the
// prescription, laps and the journal. START, pause menu and display belong to RUN-016, alarms to RUN-017,
// summary and sending to RUN-018; this class gives them `tick`, `pause`, `resume`, `nextSegment`, `save`, `discard`.
//
// The run comes first, like the strength recorder: a refusing recording ends the start, nothing else.
// After a crash `restore` takes the run up again from the journal (07 D-31): the numbers go on, the watch gets a
// NEW recording, Arnold still sees ONE run (the same uuid, `parts` counts the recordings).
class RunSession {
    enum State {
        STATE_RUNNING,
        STATE_PAUSED,          // by hand
        STATE_AUTO_PAUSED,     // by the auto pause
        STATE_FINISHED         // saved
    }

    const JOURNAL_EVERY_S as Number = 30;
    const KM_CM as Number = 100000;

    var uuid as String;
    var runId as String;
    var mode as Number;
    var environment as Number;
    var state as Number;
    var ordinal as Number;         // segment being run (0 based), count() when there is none (free run, plan done)
    var laps as Number;
    var parts as Number;           // Garmin recordings of this run so far
    var startedAt as Number;
    var plan as RunSegments;
    var calc as RunTick;
    var reading as RunReading;

    private var _parts as RunParts;
    private var _segT as Number;   // timer at the start of the segment (seconds, whole run)
    private var _segD as Number;   // distance at the start of the segment (cm)
    private var _kmLaps as Number;
    private var _since as Number;  // seconds since the journal was written
    private var _savedSplits as Number;
    private var _closed as Boolean;

    function initialize(runUuid as String, id as String, startMode as Number, env as Number, body as Dictionary or Null, runParts as RunParts) {
        uuid = runUuid;
        runId = id;
        mode = startMode;
        environment = env;
        state = STATE_RUNNING;
        ordinal = 0;
        laps = 0;
        parts = 1;
        startedAt = runParts.clock.nowSeconds();
        _parts = runParts;
        plan = new RunSegments(body);
        calc = new RunTick();
        calc.setZones(runParts.zones);
        reading = new RunReading();
        _segT = 0;
        _segD = 0;
        _kmLaps = 0;
        _since = 0;
        _savedSplits = 0;
        _closed = false;
    }

    // Starts a run from the pre-start screen. Null if the watch refuses the recording (nothing is left behind).
    static function start(model as PreStartModel, runParts as RunParts) as RunSession or Null {
        var request = model.request;
        var session = new RunSession(Uuid.v4(), request.runId, request.mode, model.environment, request.prescription, runParts);
        runParts.journal.begin(session.uuid, session.head(), request.prescription);
        if (!session.openRecording()) {
            runParts.journal.discard(session.uuid);
            return null;
        }
        return session;
    }

    // The run in progress after a restart or a forced exit, or null when there is none (or it was saved already, or
    // the watch refuses a new recording). It continues PAUSED: the user starts it again.
    static function restore(runParts as RunParts) as RunSession or Null {
        var journal = runParts.journal;
        var id = journal.activeId();
        if (id == null) {
            return null;
        }
        var head = journal.readHead(id as String);
        if (head == null) {
            journal.discard(id as String);   // damaged: it cannot be continued and must not block the next run
            return null;
        }
        var entry = head as Dictionary;
        if ((entry["st"] as Number) == STATE_FINISHED) {
            return null;                     // saved; the summary (RUN-018) owns it
        }
        var body = journal.readPrescription(id as String);
        var session = new RunSession(id as String, entry["rid"] as String, entry["md"] as Number, entry["en"] as Number, body, runParts);
        session.take(entry);
        journal.readSplits(id as String, session.calc, session.calc.splitCount);
        if (!session.openRecording()) {
            return null;
        }
        session.pause();
        return session;
    }

    hidden function take(head as Dictionary) as Void {
        calc.restore(head);
        ordinal = head["o"] as Number;
        _segT = head["ss"] as Number;
        _segD = head["sd"] as Number;
        _kmLaps = head["km"] as Number;
        laps = head["lp"] as Number;
        parts = (head["np"] as Number) + 1;
        startedAt = head["at"] as Number;
        _savedSplits = calc.splitCount;
        if (ordinal > plan.count()) {
            ordinal = plan.count();
        }
    }

    hidden function openRecording() as Boolean {
        try {
            if (!_parts.backend.open(environment)) {
                return false;
            }
        } catch (e) {
            return false;
        }
        var sensors = _parts.sensors;
        if (sensors != null) {
            (sensors as RunSensors).start(environment != PreStartModel.ENV_TREADMILL);
        }
        return true;
    }

    // Where the distance comes from: the treadmill has no position, its distance is the watch's estimate.
    function distanceIsEstimated() as Boolean {
        return environment == PreStartModel.ENV_TREADMILL;
    }

    function isClosed() as Boolean {
        return _closed;
    }

    function isPaused() as Boolean {
        return state == STATE_PAUSED || state == STATE_AUTO_PAUSED;
    }

    // True once all segments of the prescription were run (a free run never is).
    function isPlanDone() as Boolean {
        return plan.count() > 0 && ordinal >= plan.count();
    }

    // The segment being run, 1 based, 0 for none.
    function segmentNumber() as Number {
        return ordinal < plan.count() ? ordinal + 1 : 0;
    }

    function segmentSeconds() as Number {
        return calc.timerS - _segT;
    }

    function segmentMeters() as Number {
        return (calc.distanceCm - _segD) / 100;
    }

    // Every second: read, count, follow the segments, write the journal. The screen is drawn after it, once.
    function tick() as Void {
        if (_closed || state == STATE_FINISHED) {
            return;
        }
        _parts.source.read(reading);
        calc.update(reading, state == STATE_RUNNING);
        if (_parts.settings.isOn(Settings.AUTO_PAUSE) && (state == STATE_RUNNING || state == STATE_AUTO_PAUSED)) {
            var step = calc.autoPause(reading.speedCmS, state == STATE_AUTO_PAUSED);
            if (step == RunTick.AUTO_PAUSE) {
                guarded(:stop);
                state = STATE_AUTO_PAUSED;
                writeJournal();
            } else if (step == RunTick.AUTO_RESUME) {
                guarded(:start);
                state = STATE_RUNNING;
                writeJournal();
            }
        }
        if (state != STATE_RUNNING) {
            return;
        }
        follow();
        _since++;
        if (_since >= JOURNAL_EVERY_S) {
            writeJournal();
        }
    }

    // The lap key: ends the segment being run (a timed or distance one too) and starts the next. False when there is
    // no segment (free run, plan done) or the run stands still.
    function nextSegment() as Boolean {
        if (state != STATE_RUNNING || ordinal >= plan.count()) {
            return false;
        }
        endSegment(true);
        follow();
        return true;
    }

    function pause() as Void {
        if (_closed || state == STATE_PAUSED || state == STATE_FINISHED) {
            return;
        }
        guarded(:stop);
        state = STATE_PAUSED;
        calc.resetAutoPause();
        writeJournal();
    }

    function resume() as Void {
        if (_closed || (state != STATE_PAUSED && state != STATE_AUTO_PAUSED)) {
            return;
        }
        guarded(:start);
        state = STATE_RUNNING;
        calc.resetAutoPause();
        writeJournal();
    }

    // The run is saved: the activity goes to the watch history, the journal keeps the run (state FINISHED) until the
    // summary has sent it (RUN-018). True if the watch saved the recording.
    function save() as Boolean {
        if (_closed || state == STATE_FINISHED) {
            return false;
        }
        var saved = false;
        try {
            if (state == STATE_RUNNING) {
                _parts.backend.stop();
            }
            saved = _parts.backend.save();
        } catch (e) {
            saved = false;
        }
        state = STATE_FINISHED;
        writeJournal();
        releaseSensors();
        return saved;
    }

    // The run is thrown away: the recording and the journal.
    function discard() as Void {
        if (_closed) {
            return;
        }
        try {
            if (state == STATE_RUNNING) {
                _parts.backend.stop();
            }
            _parts.backend.discard();
        } catch (e) {
            // the watch drops an unsaved recording itself
        }
        _parts.journal.discard(uuid);
        _closed = true;
        releaseSensors();
    }

    hidden function releaseSensors() as Void {
        var sensors = _parts.sensors;
        if (sensors != null) {
            (sensors as RunSensors).keep = false;
            (sensors as RunSensors).stop();
        }
    }

    // start() or stop() of the recording; a failing recording never stops the run.
    hidden function guarded(which as Symbol) as Void {
        try {
            if (which == :stop) {
                _parts.backend.stop();
            } else {
                _parts.backend.start();
            }
        } catch (e) {
            // the numbers go on
        }
    }

    // Segments (or km laps) as far as the numbers have come in this second.
    hidden function follow() as Void {
        while (ordinal < plan.count() && segmentDone()) {
            endSegment(false);
        }
        if (ordinal >= plan.count()) {
            var changed = false;
            while (calc.distanceCm >= (_kmLaps + 1) * KM_CM) {
                lap(0);
                _kmLaps++;
                changed = true;
            }
            if (changed) {
                writeJournal();
            }
        }
    }

    // Time segments end on the second, distance segments at the tick closest to the distance
    // (half a step of the tick counts as reached), open ones only by the lap key.
    hidden function segmentDone() as Boolean {
        var type = plan.durationType(ordinal);
        var value = plan.durationValue(ordinal);
        if (type == RunSegments.DURATION_SECONDS) {
            return calc.timerS - _segT >= value;
        }
        if (type == RunSegments.DURATION_METERS) {
            return calc.distanceCm - _segD + calc.lastStepCm / 2 >= value * 100;
        }
        return false;
    }

    // Closes the segment with a lap. The next one starts where this one was meant to end, so a tick that was a
    // little early or late does not add up.
    hidden function endSegment(manual as Boolean) as Void {
        var type = plan.durationType(ordinal);
        var value = plan.durationValue(ordinal);
        lap(ordinal + 1);
        ordinal++;
        if (!manual && type == RunSegments.DURATION_SECONDS) {
            _segT += value;
            _segD = calc.distanceCm;
        } else if (!manual && type == RunSegments.DURATION_METERS) {
            _segD += value * 100;
            _segT = calc.timerS;
        } else {
            _segT = calc.timerS;
            _segD = calc.distanceCm;
        }
        writeJournal();
    }

    hidden function lap(segment as Number) as Void {
        try {
            if (_parts.backend.lap(segment)) {
                laps++;
            }
        } catch (e) {
            // no lap in the file; the run goes on
        }
    }

    // The state as the journal keeps it.
    function head() as Dictionary {
        return {
            "v" => 1, "st" => state, "rid" => runId, "md" => mode, "en" => environment, "at" => startedAt,
            "o" => ordinal, "ss" => _segT, "sd" => _segD, "t" => calc.timerS, "d" => calc.distanceCm,
            "a" => calc.ascentM, "z" => calc.zoneSeconds, "sc" => calc.splitCount, "km" => _kmLaps, "lp" => laps,
            "np" => parts - 1, "hs" => calc.heartSum, "hn" => calc.heartN, "hx" => calc.heartMax,
            "cs" => calc.cadenceSum, "cn" => calc.cadenceN
        };
    }

    // Splits first, then the head: the head never counts a split that was not written.
    hidden function writeJournal() as Void {
        _since = 0;
        try {
            _parts.journal.saveSplits(uuid, calc, _savedSplits, calc.splitCount);
            _savedSplits = calc.splitCount;
            _parts.journal.saveHead(uuid, head());
        } catch (e) {
            // storage is full or failing: the run goes on, the next write tries again
        }
    }
}
