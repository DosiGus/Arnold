import Toybox.Lang;

// What the watch reports once a second (RUN-015). One object, filled again every second, so the
// tick makes no new objects. A value the watch does not have is null, never 0.
class RunReading {
    var timerS as Number or Null;       // seconds the recording's timer has run (it stands still in a pause)
    var distanceCm as Number or Null;   // distance of this recording in cm
    var speedCmS as Number or Null;     // current speed in cm/s
    var heartRate as Number or Null;
    var cadence as Number or Null;      // steps per minute
    var ascentM as Number or Null;      // metres climbed in this recording
    var calories as Number or Null;     // kcal of this recording (RUN-018)
    var effect10 as Number or Null;     // aerobic training effect in tenths, as the watch has it (RUN-018)

    function initialize() {
        clear();
    }

    function clear() as Void {
        timerS = null;
        distanceCm = null;
        speedCmS = null;
        heartRate = null;
        cadence = null;
        ascentM = null;
        calories = null;
        effect10 = null;
    }
}

// Where the readings come from. The real one asks the activity; tests (and the three-hour
// simulation) hand in synthetic values instead of real sensors.
class RunSource {
    function initialize() {
    }

    function read(into as RunReading) as Void {
    }
}

// The arithmetic of a run, second by second (RUN-015): totals, smoothed pace, time in heart rate
// zones, a split every 100 m, the auto pause decision. No I/O and no drawing. Integers only: distance
// in cm, speed in cm/s, so nothing is allocated on the tick and nothing rounds away.
//
// The totals run on across a restart: `restore` starts the numbers from the journal and the new
// recording counts from 0 again (its values are added to the base).
class RunTick {
    const RING as Number = 30;                 // seconds of speed kept (the longest smoothing)
    const DISPLAY_S as Number = 10;            // smoothing of the displayed pace
    const ALARM_S as Number = 30;              // smoothing for the alarms (RUN-017)
    const SPLIT_CM as Number = 10000;          // a split every 100 m
    const MAX_SPLITS as Number = 600;          // up to 60 km
    const MIN_PACE_CMS as Number = 30;        // below 0.3 m/s there is no pace
    const PAUSE_BELOW_CMS as Number = 100;     // auto pause: under 1.0 m/s ...
    const PAUSE_AFTER_S as Number = 4;         // ... for 4 s
    const RESUME_ABOVE_CMS as Number = 160;    // continue: over 1.6 m/s ...
    const RESUME_AFTER_S as Number = 2;        // ... for 2 s

    enum AutoPauseStep {
        AUTO_NONE,
        AUTO_PAUSE,
        AUTO_RESUME
    }

    var timerS as Number;          // moving seconds of the whole run
    var distanceCm as Number;
    var ascentM as Number;
    var lastStepCm as Number;      // distance gained in the last tick (cm)
    var heartSum as Number;
    var heartN as Number;
    var heartMax as Number;
    var cadenceSum as Number;
    var cadenceN as Number;
    var zoneSeconds as Array<Number>;    // zones 1 to 5
    var splitCount as Number;

    private var _baseT as Number;       // what earlier recordings of this run counted
    private var _baseD as Number;
    private var _baseA as Number;
    private var _lastT as Number;       // last values of this recording
    private var _lastD as Number;
    private var _ring as Array<Number>;
    private var _ringPos as Number;
    private var _ringN as Number;
    private var _splits as Array<Number>;   // timer in tenths of a second at each 100 m
    private var _zones as Array<Number> or Null;   // six heart rate bounds, zone 1 starts at the first
    private var _slow as Number;
    private var _fast as Number;

    function initialize() {
        timerS = 0;
        distanceCm = 0;
        ascentM = 0;
        lastStepCm = 0;
        heartSum = 0;
        heartN = 0;
        heartMax = 0;
        cadenceSum = 0;
        cadenceN = 0;
        zoneSeconds = [0, 0, 0, 0, 0] as Array<Number>;
        splitCount = 0;
        _baseT = 0;
        _baseD = 0;
        _baseA = 0;
        _lastT = 0;
        _lastD = 0;
        _ring = new [RING] as Array<Number>;
        _ringPos = 0;
        _ringN = 0;
        _splits = new [MAX_SPLITS] as Array<Number>;
        _zones = null;
        _slow = 0;
        _fast = 0;
    }

    // The heart rate zones of the watch's profile: six ascending values, or null when it has none.
    function setZones(bounds as Array<Number> or Null) as Void {
        _zones = bounds;
    }

    // Continues the numbers of an earlier recording of the same run.
    function restore(head as Dictionary) as Void {
        timerS = head["t"] as Number;
        distanceCm = head["d"] as Number;
        ascentM = head["a"] as Number;
        heartSum = head["hs"] as Number;
        heartN = head["hn"] as Number;
        heartMax = head["hx"] as Number;
        cadenceSum = head["cs"] as Number;
        cadenceN = head["cn"] as Number;
        splitCount = head["sc"] as Number;
        var zones = head["z"] as Array;
        for (var i = 0; i < 5; i++) {
            zoneSeconds[i] = zones[i] as Number;
        }
        _baseT = timerS;
        _baseD = distanceCm;
        _baseA = ascentM;
        _lastT = 0;
        _lastD = 0;
    }

    // Puts the splits of one stored chunk back (index of the first split, values).
    function restoreSplits(first as Number, values as Array<Number>) as Void {
        for (var i = 0; i < values.size() && first + i < MAX_SPLITS; i++) {
            _splits[first + i] = values[i];
        }
    }

    // Timer in tenths of a second when 100 m number `index` (0 based) was reached.
    function splitAt(index as Number) as Number {
        return _splits[index];
    }

    // One second. `running` is false while the timer is stopped (a pause): nothing is counted then,
    // but the readings still move the last values on.
    function update(r as RunReading, running as Boolean) as Void {
        var t = r.timerS;
        var d = r.distanceCm;
        var dt = t != null && (t as Number) > _lastT ? (t as Number) - _lastT : 0;
        var dd = d != null && (d as Number) > _lastD ? (d as Number) - _lastD : 0;
        if (t != null) {
            _lastT = t as Number;
        }
        if (d != null) {
            _lastD = d as Number;
        }
        lastStepCm = dd;
        if (!running) {
            return;
        }
        timerS = _baseT + _lastT;
        distanceCm = _baseD + _lastD;
        if (r.ascentM != null) {
            ascentM = _baseA + (r.ascentM as Number);
        }
        var speed = r.speedCmS;
        pushSpeed(speed != null ? speed as Number : (dt > 0 ? dd / dt : 0));
        var hr = r.heartRate;
        if (hr != null && (hr as Number) > 0) {
            heartSum += hr as Number;
            heartN++;
            if ((hr as Number) > heartMax) {
                heartMax = hr as Number;
            }
            var zone = zoneOf(hr as Number);
            if (zone > 0) {
                zoneSeconds[zone - 1] += dt;
            }
        }
        var cadence = r.cadence;
        if (cadence != null && (cadence as Number) > 0) {
            cadenceSum += cadence as Number;
            cadenceN++;
        }
        addSplits(dt, dd);
    }

    hidden function pushSpeed(cms as Number) as Void {
        _ring[_ringPos] = cms < 0 ? 0 : cms;
        _ringPos = (_ringPos + 1) % RING;
        if (_ringN < RING) {
            _ringN++;
        }
    }

    // Average speed in cm/s over the last `seconds` seconds, or null before there is a reading.
    function speedOver(seconds as Number) as Number or Null {
        var n = _ringN < seconds ? _ringN : seconds;
        if (n == 0) {
            return null;
        }
        var sum = 0;
        for (var i = 1; i <= n; i++) {
            sum += _ring[(_ringPos - i + RING) % RING];
        }
        return sum / n;
    }

    // Pace in seconds per km over the last `seconds`, or null while standing or without a reading.
    function paceOver(seconds as Number) as Number or Null {
        var speed = speedOver(seconds);
        if (speed == null || (speed as Number) < MIN_PACE_CMS) {
            return null;
        }
        return 100000 / (speed as Number);
    }

    // Average pace of the whole run in seconds per km, or null before 10 m are run.
    function paceAverage() as Number or Null {
        if (distanceCm < 1000 || timerS <= 0) {
            return null;
        }
        return timerS * 100000 / distanceCm;
    }

    // Seconds the last full km took (the last ten splits), null before the first km.
    function lastKmSeconds() as Number or Null {
        if (splitCount < 10) {
            return null;
        }
        var from = splitCount > 10 ? _splits[splitCount - 11] : 0;
        return (_splits[splitCount - 1] - from) / 10;
    }

    function paceDisplay() as Number or Null {
        return paceOver(DISPLAY_S);
    }

    function paceAlarm() as Number or Null {
        return paceOver(ALARM_S);
    }

    // Heart rate zone 1 to 5 of a value; 0 below zone 1 or without zones; above the last bound it is zone 5.
    function zoneOf(heartRate as Number) as Number {
        var bounds = _zones;
        if (bounds == null || (bounds as Array<Number>).size() < 6 || heartRate < (bounds as Array<Number>)[0]) {
            return 0;
        }
        for (var z = 5; z >= 1; z--) {
            if (heartRate >= (bounds as Array<Number>)[z - 1]) {
                return z;
            }
        }
        return 0;
    }

    // Every 100 m reached in this second gets its time, interpolated inside the second.
    hidden function addSplits(dt as Number, dd as Number) as Void {
        var before = distanceCm - dd;
        while (splitCount < MAX_SPLITS && (splitCount + 1) * SPLIT_CM <= distanceCm) {
            var target = (splitCount + 1) * SPLIT_CM;
            var into = dd > 0 ? (target - before) * dt * 10 / dd : dt * 10;   // tenths of a second into this tick
            _splits[splitCount] = (timerS - dt) * 10 + into;
            splitCount++;
        }
    }

    // Auto pause (only asked while the setting is on): AUTO_PAUSE after 4 s under 1.0 m/s, AUTO_RESUME after
    // 2 s over 1.6 m/s while paused. Between the two thresholds nothing counts; an unknown speed neither.
    function autoPause(speedCmS as Number or Null, paused as Boolean) as Number {
        if (speedCmS == null) {
            _slow = 0;
            _fast = 0;
            return AUTO_NONE;
        }
        var speed = speedCmS as Number;
        _slow = speed < PAUSE_BELOW_CMS ? _slow + 1 : 0;
        _fast = speed > RESUME_ABOVE_CMS ? _fast + 1 : 0;
        if (!paused && _slow >= PAUSE_AFTER_S) {
            _slow = 0;
            return AUTO_PAUSE;
        }
        if (paused && _fast >= RESUME_AFTER_S) {
            _fast = 0;
            return AUTO_RESUME;
        }
        return AUTO_NONE;
    }

    // The counters start again (after a pause by hand, or when a pause begins or ends).
    function resetAutoPause() as Void {
        _slow = 0;
        _fast = 0;
    }
}
