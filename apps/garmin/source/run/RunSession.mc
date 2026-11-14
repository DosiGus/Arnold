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
        if (info has :calories && info.calories != null) {
            into.calories = info.calories as Number;
        }
        if (info has :trainingEffect && info.trainingEffect != null) {
            into.effect10 = ((info.trainingEffect as Float) * 10).toNumber();
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
    var health as HealthCapture or Null = null;   // the heart rate series of the run for Arnold (only with the consent), RUN-018

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

    // How the heart rate or pace compares with the target of the segment (targetFit).
    enum TargetFit {
        FIT_NONE,      // no target, or no value to compare
        FIT_OK,
        FIT_BELOW,     // under the range (pace: faster than asked)
        FIT_ABOVE      // over the range (pace: slower than asked)
    }

    // What the lap key does at this moment (lapAction).
    enum LapAction {
        LAP_NONE,      // nothing: the run stands still
        LAP_MANUAL,    // a lap without segments (free run, plan done)
        LAP_OPEN,      // ends an open segment
        LAP_SKIP       // ends a timed or distance segment early: the screen asks first
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
    var results as Array<Array<Number>>;   // finished segments: [kind, status, seconds, metres, seconds in target or -1, heart avg or 0, heart max or 0, round or 0]
    var pauses as Number;
    var effort as Number;          // the effort the user gave, 1 to 10, 0 = none (RUN-018)
    var endedAt as Number;         // when the run was saved (0 before)
    var correctedCm as Number;     // the distance the user corrected, -1 without one (RUN-018)
    var calories as Number;        // -1 = the watch does not know
    var effect10 as Number;        // aerobic training effect in tenths, -1 = unknown
    var alerts as RunAlertLink;    // the alarms of the run (RUN-017); muted via setMuted/isMuted (run settings, RUN-016)

    private var _parts as RunParts;
    private var _segT as Number;   // timer at the start of the segment (seconds, whole run)
    private var _segD as Number;   // distance at the start of the segment (cm)
    private var _kmLaps as Number;
    private var _since as Number;  // seconds since the journal was written
    private var _savedSplits as Number;
    private var _closed as Boolean;
    private var _gHrSum as Number;     // heart rate and seconds in target of the segment being run
    private var _gHrN as Number;
    private var _gHrMax as Number;
    private var _gBand as Number;

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
        var capture = runParts.health;
        if (capture != null) {
            var c = capture as HealthCapture;
            c.uuid = runUuid;   // the heart rate series belongs to this run
        }
        plan = new RunSegments(body);
        calc = new RunTick();
        calc.setZones(runParts.zones);
        reading = new RunReading();
        alerts = new RunAlertLink(body, runParts.zones, runParts.settings);
        _segT = 0;
        _segD = 0;
        _kmLaps = 0;
        _since = 0;
        _savedSplits = 0;
        _closed = false;
        results = [] as Array<Array<Number>>;
        pauses = 0;
        _gHrSum = 0;
        _gHrN = 0;
        _gHrMax = 0;
        _gBand = 0;
        effort = 0;
        endedAt = 0;
        correctedCm = -1;
        calories = -1;
        effect10 = -1;
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

    // A run that was saved, but whose result has not gone into the run outbox yet (the watch stopped between SAVE and the
    // outbox): the same run again, only to be built into a request. Null when there is none. No recording is opened.
    static function reopenSaved(runParts as RunParts) as RunSession or Null {
        var journal = runParts.journal;
        var id = journal.activeId();
        if (id == null) {
            return null;
        }
        var head = journal.readHead(id as String);
        if (head == null || ((head as Dictionary)["st"] as Number) != STATE_FINISHED) {
            return null;
        }
        var entry = head as Dictionary;
        var session = new RunSession(id as String, entry["rid"] as String, entry["md"] as Number, entry["en"] as Number, journal.readPrescription(id as String), runParts);
        session.take(entry);
        journal.readSplits(id as String, session.calc, session.calc.splitCount);
        session.state = STATE_FINISHED;
        if (session.endedAt <= 0) {
            session.endedAt = session.startedAt + session.calc.timerS;   // the end was not written: the timer is what is known
        }
        return session;
    }

    function take(head as Dictionary) as Void {
        calc.restore(head);
        ordinal = head["o"] as Number;
        _segT = head["ss"] as Number;
        _segD = head["sd"] as Number;
        _kmLaps = head["km"] as Number;
        laps = head["lp"] as Number;
        parts = (head["np"] as Number) + 1;   // the head counts the recordings so far
        startedAt = head["at"] as Number;
        _savedSplits = calc.splitCount;
        if (ordinal > plan.count()) {
            ordinal = plan.count();
        }
        var extra = _parts.journal.readExtra(uuid);
        if (extra != null) {
            var e = extra as Dictionary;
            results = e["r"] as Array<Array<Number>>;
            pauses = e["pc"] as Number;
            endedAt = e["e"] as Number;
            correctedCm = e["cm"] as Number;
            calories = e["kc"] as Number;
            effect10 = e["te"] as Number;
        }
    }

    function openRecording() as Boolean {
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
        withHealth(:resume);
        return true;
    }

    // Where the distance comes from: the treadmill has no position, its distance is the watch's estimate.
    function distanceIsEstimated() as Boolean {
        return environment == PreStartModel.ENV_TREADMILL;
    }

    function services() as RunParts {
        return _parts;
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

    // Seconds left in a timed segment, null for any other. Never below 0.
    function segmentRemainingSeconds() as Number or Null {
        if (ordinal >= plan.count() || plan.durationType(ordinal) != RunSegments.DURATION_SECONDS) {
            return null;
        }
        var left = plan.durationValue(ordinal) - segmentSeconds();
        return left < 0 ? 0 : left;
    }

    // Metres left in a distance segment, null for any other. Never below 0.
    function segmentRemainingMeters() as Number or Null {
        if (ordinal >= plan.count() || plan.durationType(ordinal) != RunSegments.DURATION_METERS) {
            return null;
        }
        var left = plan.durationValue(ordinal) - segmentMeters();
        return left < 0 ? 0 : left;
    }

    // Pace of the segment (lap) so far in seconds per km, null before 10 m.
    function segmentPace() as Number or Null {
        var cm = calc.distanceCm - _segD;
        if (cm < 1000 || segmentSeconds() <= 0) {
            return null;
        }
        return segmentSeconds() * 100000 / cm;
    }

    // The last heart rate the watch reported, null without one.
    function heartRate() as Number or Null {
        var hr = reading.heartRate;
        return hr != null && (hr as Number) > 0 ? hr : null;
    }

    // Heart rate zone 1 to 5 now; 0 without a heart rate or without zones.
    function heartZone() as Number {
        var hr = heartRate();
        return hr == null ? 0 : calc.zoneOf(hr as Number);
    }

    // The value the target of the segment is about: zone, pace (s/km) or bpm; null without one (effort has none).
    function targetActual() as Number or Null {
        if (ordinal >= plan.count()) {
            return null;
        }
        var type = plan.targetType(ordinal);
        if (type == 1) {
            var zone = heartZone();
            return zone > 0 ? zone : null;
        }
        if (type == 2) {
            return calc.paceDisplay();
        }
        if (type == 3) {
            return heartRate();
        }
        return null;
    }

    function targetFit() as Number {
        var actual = targetActual();
        if (actual == null) {
            return FIT_NONE;
        }
        var low = plan.targetLow(ordinal);
        var high = plan.targetHigh(ordinal);
        if ((actual as Number) < low) {
            return FIT_BELOW;
        }
        return (actual as Number) > high ? FIT_ABOVE : FIT_OK;
    }

    // What the lap key would do now.
    function lapAction() as Number {
        if (state != STATE_RUNNING) {
            return LAP_NONE;
        }
        if (ordinal >= plan.count()) {
            return LAP_MANUAL;
        }
        return plan.durationType(ordinal) == RunSegments.DURATION_OPEN ? LAP_OPEN : LAP_SKIP;
    }

    // The lap key: the next segment, or a plain lap where there are none. False when the run stands still.
    function lapKey() as Boolean {
        if (state != STATE_RUNNING) {
            return false;
        }
        if (ordinal < plan.count()) {
            return nextSegment();
        }
        lap(0);
        _segT = calc.timerS;
        _segD = calc.distanceCm;
        writeJournal();
        return true;
    }

    // Auto pause as the settings have it, and its switch (run settings).
    function autoPauseOn() as Boolean {
        return _parts.settings.isOn(Settings.AUTO_PAUSE);
    }

    function setAutoPause(on as Boolean) as Void {
        _parts.settings.set(Settings.AUTO_PAUSE, on);
        calc.resetAutoPause();
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
                withHealth(:pause);
                pauses++;
                state = STATE_AUTO_PAUSED;
                writeJournal();
            } else if (step == RunTick.AUTO_RESUME) {
                guarded(:start);
                withHealth(:resume);
                state = STATE_RUNNING;
                writeJournal();
            }
        }
        if (state != STATE_RUNNING) {
            return;
        }
        sumSegment();
        withHealth(:tick);
        follow();
        alerts.second(self);
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

    // Mute (or unmute) the alarm signals for this run; the hint line stays.
    function setMuted(muted as Boolean) as Void {
        alerts.muted = muted;
    }

    function isMuted() as Boolean {
        return alerts.muted;
    }

    function pause() as Void {
        if (_closed || state == STATE_PAUSED || state == STATE_FINISHED) {
            return;
        }
        guarded(:stop);
        withHealth(:pause);
        if (state == STATE_RUNNING) {
            pauses++;
        }
        state = STATE_PAUSED;
        calc.resetAutoPause();
        writeJournal();
    }

    function resume() as Void {
        if (_closed || (state != STATE_PAUSED && state != STATE_AUTO_PAUSED)) {
            return;
        }
        guarded(:start);
        withHealth(:resume);
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
        endedAt = _parts.clock.nowSeconds();
        if (reading.calories != null) {
            calories = reading.calories as Number;
        }
        if (reading.effect10 != null) {
            effect10 = reading.effect10 as Number;
        }
        recordLast();
        withHealth(:finish);   // before the recording ends: the watch still has the values
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
        withHealth(:discard);
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
                recordSegment(LAP_KIND, 0, 0, changed);
                _kmLaps++;
                changed = true;
            }
            if (changed) {
                _segT = calc.timerS;       // the lap shown on the display starts again
                _segD = calc.distanceCm;
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
        var round = plan.roundOf(ordinal);
        var early = manual && type != RunSegments.DURATION_OPEN;
        var seconds = calc.timerS - _segT;
        recordSegment(plan.kindOf(ordinal), early ? (seconds <= 1 ? 1 : 2) : 0, round == null ? 0 : (round as Array<Number>)[0], false);
        lap(ordinal + 1);
        ordinal++;
        if (ordinal >= plan.count()) {
            _kmLaps = calc.distanceCm / KM_CM;   // laps per km start after the plan, not for what was run in it
        }
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

    const LAP_KIND as Number = 5;       // segment kind of a km lap (wire code of RUN_SEGMENT_KINDS)
    const MAX_RESULTS as Number = 80;

    hidden function resetSegmentSums() as Void {
        _gHrSum = 0;
        _gHrN = 0;
        _gHrMax = 0;
        _gBand = 0;
    }

    // One more second of the segment being run: heart rate and the time the target was met.
    hidden function sumSegment() as Void {
        var hr = heartRate();
        if (hr != null) {
            _gHrSum += hr as Number;
            _gHrN++;
            if ((hr as Number) > _gHrMax) {
                _gHrMax = hr as Number;
            }
        }
        var type = ordinal < plan.count() ? plan.targetType(ordinal) : 0;
        if (type >= 1 && type <= 3 && targetFit() == FIT_OK) {
            _gBand++;
        }
    }

    // Adds the segment that just ended to the results. `repeat` continues a km lap that ended in the same second
    // (several km in one tick are laps of zero time).
    hidden function recordSegment(kind as Number, status as Number, round as Number, repeat as Boolean) as Void {
        if (results.size() >= MAX_RESULTS) {
            resetSegmentSums();
            return;
        }
        var seconds = repeat ? 0 : calc.timerS - _segT;
        var cm = repeat ? KM_CM : calc.distanceCm - _segD;
        var type = ordinal < plan.count() && kind != LAP_KIND ? plan.targetType(ordinal) : 0;
        var band = type >= 1 && type <= 3 ? (_gBand > seconds ? seconds : _gBand) : -1;
        results.add([kind, status, seconds < 0 ? 0 : seconds, cm < 0 ? 0 : cm / 100, band,
            _gHrN > 0 ? _gHrSum / _gHrN : 0, _gHrMax, round]);
        resetSegmentSums();
    }

    // The segment (or km) that was running when the run was saved.
    hidden function recordLast() as Void {
        if (calc.timerS - _segT <= 0 && calc.distanceCm - _segD <= 0) {
            return;
        }
        if (ordinal < plan.count()) {
            var round = plan.roundOf(ordinal);
            recordSegment(plan.kindOf(ordinal), 2, round == null ? 0 : (round as Array<Number>)[0], false);
        } else {
            recordSegment(LAP_KIND, 0, 0, false);
        }
    }

    // The distance the user corrected on the treadmill (cm); -1 takes the correction back.
    function correctDistance(cm as Number) as Void {
        correctedCm = cm;
        try {
            _parts.journal.saveExtra(uuid, extra());
        } catch (e) {
            // the correction is lost only if the watch is shut down before the result is made
        }
    }

    function extra() as Dictionary {
        return { "r" => results, "pc" => pauses, "e" => endedAt, "cm" => correctedCm, "kc" => calories, "te" => effect10 };
    }

    // The distance of the result in cm: the corrected one, else the watch's.
    function resultDistanceCm() as Number {
        return correctedCm >= 0 ? correctedCm : calc.distanceCm;
    }

    // start(), stop() ... of the health capture; it never stops the run.
    hidden function withHealth(which as Symbol) as Void {
        var capture = _parts.health;
        if (capture == null) {
            return;
        }
        try {
            var c = capture as HealthCapture;
            if (which == :tick) {
                c.tick();
            } else if (which == :resume) {
                c.resume();
            } else if (which == :pause) {
                c.pause();
            } else if (which == :finish) {
                c.finish();
            } else {
                c.discard();
            }
        } catch (e) {
            // health values are not worth the run
        }
    }

    // The state as the journal keeps it.
    function head() as Dictionary {
        return {
            "v" => 1, "st" => state, "rid" => runId, "md" => mode, "en" => environment, "at" => startedAt,
            "o" => ordinal, "ss" => _segT, "sd" => _segD, "t" => calc.timerS, "d" => calc.distanceCm,
            "a" => calc.ascentM, "z" => [calc.zoneSeconds[0], calc.zoneSeconds[1], calc.zoneSeconds[2], calc.zoneSeconds[3], calc.zoneSeconds[4]], "sc" => calc.splitCount, "km" => _kmLaps, "lp" => laps,
            "np" => parts, "hs" => calc.heartSum, "hn" => calc.heartN, "hx" => calc.heartMax,
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
            _parts.journal.saveExtra(uuid, extra());
        } catch (e) {
            // storage is full or failing: the run goes on, the next write tries again
        }
    }
}
