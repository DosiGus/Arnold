import Toybox.Lang;

// The alarm rules of a run (RUN-017). Pure: once a second it gets a snapshot (`RunAlertInput`) and says which events
// happened in that second. No sensors, no display, no vibration, no storage. It counts its own seconds (one `update`
// is one second of running), so a pause does not count.
//
// Heart rate too high:  over the upper bound for the dwell time (20 s), never in a warm-up segment or in the run-in time
//                       (5 min of a continuous run), over when the heart rate is 3 beats under the bound, again only after
//                       the repeat lock (60 s). Without a heart rate there is no heart rate alarm.
// Heart rate too low:   only with a heart rate target in a work segment of a tempo or threshold run, 30 s under the bound.
// Pace outside:         only work segments of 2 min or 400 m and more, not in the first 20 s of a segment, 15 s outside the band.
// Countdown / change:   3 s (50 m) before the end of a segment, then the change with the next segment and its target.
// Kilometre:            every full km with its time, only with the setting on. Drink: long runs from minute 60, every 30 min.
// No sensor:            one hint after 60 s without a heart rate.
class RunAlerts {
    const BEATS_UNDER as Number = 3;           // heart rate is "down again" 3 beats under the bound
    const COUNTDOWN_S as Number = 3;
    const COUNTDOWN_CM as Number = 5000;
    const NO_SENSOR_S as Number = 60;
    const KM_CM as Number = 100000;
    const THRESHOLD_RUN as Number = 5;             // run types 4 (tempo) and 5 (threshold intervals)
    const NONE as Number = -1;

    var params as RunAlertParams;

    private var _now as Number;                // seconds seen
    private var _first as Boolean;
    private var _pool as Array<RunAlertEvent>;
    private var _slots as Array<RunAlertEvent>;   // the events of the last second, in order
    private var _count as Number;
    private var _counts as Array<Number>;

    private var _ordinal as Number;
    private var _changed as Boolean;
    private var _hiOver as Number;
    private var _hiActive as Boolean;
    private var _hiLast as Number;
    private var _loUnder as Number;
    private var _loLast as Number;
    private var _tooFast as Number;
    private var _tooSlow as Number;
    private var _paceLast as Number;
    private var _countdownDone as Boolean;
    private var _kmDone as Number;
    private var _kmTimer as Number;
    private var _drinkNext as Number;
    private var _noHr as Number;
    private var _noHrWarned as Boolean;

    function initialize(alarmParams as RunAlertParams) {
        params = alarmParams;
        _now = 0;
        _first = true;
        _pool = new [RunAlertEvent.TYPES] as Array<RunAlertEvent>;
        _slots = new [RunAlertEvent.TYPES] as Array<RunAlertEvent>;
        _counts = new [RunAlertEvent.TYPES] as Array<Number>;
        for (var i = 0; i < RunAlertEvent.TYPES; i++) {
            _pool[i] = new RunAlertEvent(i);
            _slots[i] = _pool[i];
            _counts[i] = 0;
        }
        _count = 0;
        _ordinal = NONE;
        _changed = false;
        _hiOver = 0;
        _hiActive = false;
        _hiLast = NONE;
        _loUnder = 0;
        _loLast = NONE;
        _tooFast = 0;
        _tooSlow = 0;
        _paceLast = NONE;
        _countdownDone = false;
        _kmDone = 0;
        _kmTimer = 0;
        _drinkNext = 0;
        _noHr = 0;
        _noHrWarned = false;
    }

    // Seconds of running seen so far (the clock of the hint line).
    function seconds() as Number {
        return _now;
    }

    // How often an event happened in this run, silenced or not (the log of the alarms).
    function countOf(type as Number) as Number {
        return _counts[type];
    }

    // Number of events of the last second; `eventAt` gives them in the order of their importance.
    function eventCount() as Number {
        return _count;
    }

    function eventAt(index as Number) as RunAlertEvent {
        return _slots[index];
    }

    // One second of running. Returns the number of events (see eventAt).
    function update(input as RunAlertInput) as Number {
        _now++;
        _count = 0;
        if (_first) {
            start(input);
        }
        _changed = false;
        if (input.ordinal != _ordinal) {
            _changed = _ordinal != NONE;
            _ordinal = input.ordinal;
            newSegment();
        }
        var hr = input.heartRate;
        var heart = hr != null && (hr as Number) > 0 ? hr as Number : NONE;
        heartRateHigh(input, heart);
        if (_changed) {
            var change = emit(RunAlertEvent.CHANGE, input);
            change.kind = input.kind;
            change.targetType = input.targetType;
            change.targetLow = input.targetLow;
            change.targetHigh = input.targetHigh;
        }
        countdown(input);
        paceBand(input);
        heartRateLow(input, heart);
        kilometre(input);
        drink(input);
        noSensor(input, heart);
        return _count;
    }

    // The first second: what the run already has (after a restart) does not fire.
    hidden function start(input as RunAlertInput) as Void {
        _first = false;
        _kmDone = input.distanceCm / KM_CM;
        _kmTimer = input.timerS <= 10 ? 0 : NONE;      // a run taken up again does not know when its km began
        if (params.drinkEveryMin > 0) {
            _drinkNext = params.drinkFromMin * 60;
            while (_drinkNext < input.timerS) {
                _drinkNext += params.drinkEveryMin * 60;
            }
        }
    }

    // Every segment starts its counters again; the repeat locks go on over the change.
    hidden function newSegment() as Void {
        _hiOver = 0;
        _hiActive = false;
        _loUnder = 0;
        _tooFast = 0;
        _tooSlow = 0;
        _countdownDone = false;
    }

    // Fills the event of this type, puts it in the list and counts it. Silencing is decided here.
    hidden function emit(type as Number, input as RunAlertInput) as RunAlertEvent {
        var event = _pool[type];
        var heartType = type == RunAlertEvent.HR_HIGH || type == RunAlertEvent.HR_LOW || type == RunAlertEvent.NO_HEART_RATE;
        event.shown = !heartType || input.hrAlarms;
        event.audible = event.shown && !input.muted;
        event.kind = NONE;
        event.targetType = 0;
        event.targetLow = 0;
        event.targetHigh = 0;
        event.value = 0;
        event.timeS = NONE;
        _slots[_count] = event;
        _count++;
        _counts[type]++;
        return event;
    }

    hidden function locked(last as Number, lock as Number) as Boolean {
        return last != NONE && _now - last < lock;
    }

    // Upper heart rate bound of the target in bpm, null when the segment has none (no tolerance added yet).
    hidden function upperBound(input as RunAlertInput) as Number or Null {
        if (input.targetType == 3) {
            return input.targetHigh;
        }
        var zones = params.zones;
        if (input.targetType == 1 && zones != null && (zones as Array<Number>).size() >= 6
            && input.targetHigh >= 1 && input.targetHigh <= 5) {
            return (zones as Array<Number>)[input.targetHigh];
        }
        return null;
    }

    hidden function lowerBound(input as RunAlertInput) as Number or Null {
        if (input.targetType == 3) {
            return input.targetLow;
        }
        var zones = params.zones;
        if (input.targetType == 1 && zones != null && (zones as Array<Number>).size() >= 6
            && input.targetLow >= 1 && input.targetLow <= 5) {
            return (zones as Array<Number>)[input.targetLow - 1];
        }
        return null;
    }

    hidden function heartRateHigh(input as RunAlertInput, heart as Number) as Void {
        var upper = upperBound(input);
        var setting = params.hi;
        if (heart == NONE || upper == null || input.kind == 0 || input.timerS < setting.warmupS) {
            _hiOver = 0;
            _hiActive = false;
            return;
        }
        var limit = (upper as Number) + setting.tolerance;
        _hiOver = heart > limit ? _hiOver + 1 : 0;
        if (heart <= limit - BEATS_UNDER) {
            _hiActive = false;
        }
        var ready = _hiActive ? heart > limit : _hiOver >= setting.dwellS;
        if (ready && !locked(_hiLast, setting.lockS)) {
            _hiActive = true;
            _hiLast = _now;
            emit(RunAlertEvent.HR_HIGH, input);
        }
    }

    hidden function heartRateLow(input as RunAlertInput, heart as Number) as Void {
        var lower = lowerBound(input);
        var setting = params.lo;
        var type = params.runType;
        if (heart == NONE || lower == null || input.kind != 1 || (type != 4 && type != THRESHOLD_RUN)
            || input.timerS < setting.warmupS) {
            _loUnder = 0;
            return;
        }
        _loUnder = heart < (lower as Number) - setting.tolerance ? _loUnder + 1 : 0;
        if (_loUnder >= setting.dwellS && !locked(_loLast, setting.lockS)) {
            _loLast = _now;
            emit(RunAlertEvent.HR_LOW, input);
        }
    }

    // Only work segments of 2 min or 400 m and more; 15 s outside the band, but not in the first 20 s of the segment.
    hidden function paceBand(input as RunAlertInput) as Void {
        var pace = input.paceSKm;
        var longEnough = (input.durationType == 1 && input.durationValue >= 120)
            || (input.durationType == 2 && input.durationValue >= 400);
        var setting = params.pace;
        if (pace == null || input.targetType != 2 || input.kind != 1 || !longEnough || input.segmentSeconds < setting.warmupS) {
            _tooFast = 0;
            _tooSlow = 0;
            return;
        }
        // pace is seconds per km: low is the fast end of the band, high the slow end
        _tooFast = (pace as Number) < input.targetLow - setting.tolerance ? _tooFast + 1 : 0;
        _tooSlow = (pace as Number) > input.targetHigh + setting.tolerance ? _tooSlow + 1 : 0;
        if (locked(_paceLast, setting.lockS)) {
            return;
        }
        if (_tooSlow >= setting.dwellS) {
            _paceLast = _now;
            emit(RunAlertEvent.PACE_FAST, input);
        } else if (_tooFast >= setting.dwellS) {
            _paceLast = _now;
            emit(RunAlertEvent.PACE_SLOW, input);
        }
    }

    // Once per segment, 3 s (50 m) before its end; it names the segment that follows.
    hidden function countdown(input as RunAlertInput) as Void {
        if (_countdownDone) {
            return;
        }
        var left = -1;
        if (input.durationType == 1) {
            left = input.durationValue - input.segmentSeconds;
            if (left <= 0 || left > COUNTDOWN_S) {
                return;
            }
        } else if (input.durationType == 2) {
            var cm = input.durationValue * 100 - input.segmentCm;
            if (cm <= 0 || cm > COUNTDOWN_CM) {
                return;
            }
            left = (cm + 99) / 100;
        } else {
            return;
        }
        _countdownDone = true;
        var event = emit(RunAlertEvent.COUNTDOWN, input);
        event.value = left;
        event.kind = input.nextKind;
        event.targetType = input.nextTargetType;
        event.targetLow = input.nextTargetLow;
        event.targetHigh = input.nextTargetHigh;
    }

    // Counts the kilometres always, so the signal never makes up for a time it was off.
    hidden function kilometre(input as RunAlertInput) as Void {
        var km = input.distanceCm / KM_CM;
        if (km <= _kmDone) {
            return;
        }
        var time = _kmTimer == NONE ? NONE : input.timerS - _kmTimer;
        _kmDone = km;
        _kmTimer = input.timerS;
        if (input.kmSignal) {
            var event = emit(RunAlertEvent.KM, input);
            event.value = km;
            event.timeS = time;
        }
    }

    hidden function drink(input as RunAlertInput) as Void {
        if (params.drinkEveryMin <= 0 || input.timerS < _drinkNext) {
            return;
        }
        var minute = _drinkNext / 60;
        while (_drinkNext <= input.timerS) {
            _drinkNext += params.drinkEveryMin * 60;
        }
        var event = emit(RunAlertEvent.DRINK, input);
        event.value = minute;
    }

    // One hint, once per run, after 60 s without a heart rate.
    hidden function noSensor(input as RunAlertInput, heart as Number) as Void {
        if (heart != NONE) {
            _noHr = 0;
            return;
        }
        _noHr++;
        if (_noHr >= NO_SENSOR_S && !_noHrWarned) {
            _noHrWarned = true;
            emit(RunAlertEvent.NO_HEART_RATE, input);
        }
    }
}
