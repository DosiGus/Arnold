import Toybox.Activity;
import Toybox.ActivityMonitor;
import Toybox.Application;
import Toybox.Lang;
import Toybox.SensorHistory;
import Toybox.Time;
import Toybox.UserProfile;

// Where the health values come from. The real source asks the watch; tests replace it.
// Every method answers null when there is no valid value: never a 0 instead (07 D-30).
class HealthSource {
    function initialize() {
    }

    // Body Battery: the newest valid value of the last 30 minutes.
    function bodyBattery(now as Number) as Number or Null {
        return null;
    }

    // Stress: the newest valid value of the last 60 minutes (the spacing is irregular).
    function stress(now as Number) as Number or Null {
        return null;
    }

    // Resting heart rate of the day.
    function restingHr() as Number or Null {
        return null;
    }

    // Heart rate right now, or null when the sensor has no reading.
    function heartRate() as Number or Null {
        return null;
    }

    // Recovery time in hours, as far as the watch has it after the workout.
    function recoveryTimeH() as Numeric or Null {
        return null;
    }

    // Aerobic training effect 0 to 5, as far as the watch has it.
    function trainingEffect() as Numeric or Null {
        return null;
    }
}

// The watch. Every call asks at run time whether the watch can do it (08 rows 4 to 7).
// Steps, intensity minutes, VO2max, SpO2 and the SDK temperature are left out (07 D-30).
class WatchHealthSource extends HealthSource {
    const BODY_BATTERY_WINDOW_S as Number = 30 * 60;
    const STRESS_WINDOW_S as Number = 60 * 60;
    const MAX_SAMPLES as Number = 40;

    function initialize() {
        HealthSource.initialize();
    }

    function bodyBattery(now as Number) as Number or Null {
        if (!Capabilities.hasBodyBatteryHistory()) {
            return null;
        }
        var iterator = SensorHistory.getBodyBatteryHistory({
            :period => new Time.Duration(BODY_BATTERY_WINDOW_S),
            :order => SensorHistory.ORDER_NEWEST_FIRST
        });
        return newestValid(iterator, now, BODY_BATTERY_WINDOW_S);
    }

    function stress(now as Number) as Number or Null {
        if (!Capabilities.hasStressHistory()) {
            return null;
        }
        var iterator = SensorHistory.getStressHistory({
            :period => new Time.Duration(STRESS_WINDOW_S),
            :order => SensorHistory.ORDER_NEWEST_FIRST
        });
        return newestValid(iterator, now, STRESS_WINDOW_S);
    }

    function restingHr() as Number or Null {
        if (!(Toybox has :UserProfile) || !(UserProfile has :getProfile)) {
            return null;
        }
        var profile = UserProfile.getProfile();
        if (profile has :restingHeartRate && profile.restingHeartRate != null && (profile.restingHeartRate as Number) > 0) {
            return profile.restingHeartRate as Number;
        }
        return null;
    }

    function heartRate() as Number or Null {
        return LiveHeart.current();
    }

    function recoveryTimeH() as Numeric or Null {
        if (!(Toybox has :ActivityMonitor) || !(ActivityMonitor has :getInfo)) {
            return null;
        }
        var info = ActivityMonitor.getInfo();
        if (info has :timeToRecovery && info.timeToRecovery != null && (info.timeToRecovery as Number) >= 0) {
            return info.timeToRecovery as Number;
        }
        return null;
    }

    function trainingEffect() as Numeric or Null {
        if (!(Toybox has :Activity) || !(Activity has :getActivityInfo)) {
            return null;
        }
        var info = Activity.getActivityInfo();
        if (info != null && info has :trainingEffect && info.trainingEffect != null) {
            var effect = info.trainingEffect as Numeric;
            return effect > 0 ? effect : null;
        }
        return null;
    }

    // The newest sample that has a value and lies inside the window. Invalid samples (no data) are skipped.
    hidden function newestValid(iterator as SensorHistory.SensorHistoryIterator or Null, now as Number, windowS as Number) as Number or Null {
        if (iterator == null) {
            return null;
        }
        var sample = (iterator as SensorHistory.SensorHistoryIterator).next();
        var seen = 0;
        while (sample != null && seen < MAX_SAMPLES) {
            var data = sample.data;
            var age = now - sample.when.value();
            if (data != null && age <= windowS && age > -120) {
                var value = (data as Numeric).toNumber();
                return value >= 0 && value <= 100 ? value : null;
            }
            sample = (iterator as SensorHistory.SensorHistoryIterator).next();
            seen++;
        }
        return null;
    }
}

// Collects the health values of one workout (GAR-B4-02, UMSETZUNG 7.6, 07 D-03 and D-30):
// the values before the training, the heart rate every 5 s, the values after it. At the
// end one frozen request goes to the health outbox.
//
// Consent first: only when the account has agreed (HealthConsent, from GET /device) is
// anything read or saved. Without it nothing is collected; the workout and its upload are
// not touched. Every call is guarded: a failure here gives the capture up and never reaches
// the player. Gaps in the heart rate are 0 (no measurement); the server stores them as gaps.
class HealthCapture {
    const INTERVAL_S as Number = 5;
    const BLOCK_SIZE as Number = 60;        // 5 minutes of heart rate per storage block
    const MAX_VALUES as Number = 12000;     // the contract's limit

    var uuid as String;
    private var _source as HealthSource;
    private var _store as KeyValueStore;
    private var _consent as HealthConsent;
    private var _outbox as HealthOutbox;
    private var _clock as PairingClock;
    private var _running as Boolean;
    private var _began as Boolean;
    private var _done as Boolean;          // finished, discarded or given up
    private var _before as Dictionary or Null;
    private var _startedAt as Number;
    private var _count as Number;          // heart rate slots written so far (blocks and current block)
    private var _block as Array<Number>;
    private var _blockIndex as Number;
    private var _nextAt as Number;

    function initialize(
        workoutUuid as String, source as HealthSource, store as KeyValueStore,
        consent as HealthConsent, outbox as HealthOutbox, clock as PairingClock
    ) {
        uuid = workoutUuid;
        _source = source;
        _store = store;
        _consent = consent;
        _outbox = outbox;
        _clock = clock;
        _running = false;
        _began = false;
        _done = false;
        _before = null;
        _startedAt = 0;
        _count = 0;
        _block = [] as Array<Number>;
        _blockIndex = 0;
        _nextAt = 0;
    }

    function isDone() as Boolean {
        return _done;
    }

    // The training timer runs.
    function resume() as Void {
        if (_done) {
            return;
        }
        _running = true;
        tick();
    }

    // Pause and summary: no samples; the gap is filled with 0 when the training goes on.
    function pause() as Void {
        _running = false;
    }

    // Called every second while the workout is on screen.
    function tick() as Void {
        if (_done || !_running) {
            return;
        }
        try {
            var now = _clock.nowSeconds();
            if (!_began) {
                if (!_consent.isOn()) {
                    return;
                }
                _before = snapshot(now);
                _startedAt = now;
                _began = true;
                _nextAt = now;
            }
            if (now >= _nextAt) {
                sample(now);
            }
        } catch (e) {
            giveUp();
        }
    }

    // The workout was saved: the values after it, then one frozen request for the outbox.
    function finish() as Void {
        if (_done) {
            return;
        }
        _done = true;
        _running = false;
        try {
            if (!_began || !_consent.isOn()) {
                purgeBlocks();
                return;
            }
            var now = _clock.nowSeconds();
            var body = {};
            var values = collect();
            var hr = heartRateEntry(values);
            if (hr != null) {
                body["hr"] = hr;
            }
            if (_before != null) {
                body["before"] = _before;
            }
            var after = snapshot(now);
            if (after != null) {
                body["after"] = after;
            }
            var extras = extrasNow();
            if (extras != null) {
                body["extras"] = extras;
            }
            purgeBlocks();
            if (body.size() > 0) {
                _outbox.add(uuid, body, now);
            }
        } catch (e) {
            purgeBlocks();
        }
    }

    // The workout is thrown away: so are its values, also a request that was waiting.
    function discard() as Void {
        _done = true;
        _running = false;
        try {
            purgeBlocks();
            _outbox.remove(uuid);
        } catch (e) {
        }
    }

    hidden function giveUp() as Void {
        _done = true;
        _running = false;
        try {
            purgeBlocks();
        } catch (e) {
        }
    }

    // One heart rate slot every 5 s. Slots without a reading (and the time of a pause) are 0.
    hidden function sample(now as Number) as Void {
        if (!_consent.isOn()) {   // consent withdrawn while training: what was kept is deleted
            giveUp();
            return;
        }
        var slot = (now - _startedAt) / INTERVAL_S;
        while (_count < slot && _count < MAX_VALUES) {
            push(0);
        }
        if (_count >= MAX_VALUES) {
            _nextAt = now + 3600;
            return;
        }
        var hr = _source.heartRate();
        push(hr != null && (hr as Number) > 0 && (hr as Number) <= 300 ? hr as Number : 0);
        _nextAt = _startedAt + (slot + 1) * INTERVAL_S;
    }

    hidden function push(value as Number) as Void {
        _block.add(value);
        _count++;
        if (_block.size() >= BLOCK_SIZE) {
            flush();
        }
    }

    hidden function flush() as Void {
        if (_block.size() == 0) {
            return;
        }
        _store.setValue(StoreKeys.heartRateBlock(uuid, _blockIndex), _block as Application.Storage.ValueType);
        _blockIndex++;
        _block = [] as Array<Number>;
    }

    // All values: the stored blocks of this capture, then the current block.
    hidden function collect() as Array<Number> {
        var values = [] as Array<Number>;
        for (var i = 0; i < _blockIndex; i++) {
            var raw = _store.getValue(StoreKeys.heartRateBlock(uuid, i));
            if (raw instanceof Array) {
                for (var k = 0; k < (raw as Array).size(); k++) {
                    values.add((raw as Array)[k] as Number);
                }
            } else {
                for (var k = 0; k < BLOCK_SIZE; k++) {   // a lost block is a gap
                    values.add(0);
                }
            }
        }
        values.addAll(_block);
        return values;
    }

    // Deletes this capture's blocks and any older ones of the same workout (after a resumed workout).
    hidden function purgeBlocks() as Void {
        var i = 0;
        while (i < _blockIndex || _store.getValue(StoreKeys.heartRateBlock(uuid, i)) != null) {
            _store.deleteValue(StoreKeys.heartRateBlock(uuid, i));
            i++;
        }
        _block = [] as Array<Number>;
        _blockIndex = 0;
    }

    // Null when there is no measurement at all (a series of 0 is no series).
    hidden function heartRateEntry(values as Array<Number>) as Dictionary or Null {
        var last = values.size() - 1;
        while (last >= 0 && values[last] == 0) {
            last--;
        }
        if (last < 0) {
            return null;
        }
        return {
            "interval_s" => INTERVAL_S,
            "start_utc" => Clock.isoUtc(_startedAt),
            "values" => values.slice(0, last + 1)
        };
    }

    // Body Battery, stress and resting heart rate; null when none of them is known.
    hidden function snapshot(now as Number) as Dictionary or Null {
        var result = { "at_utc" => Clock.isoUtc(now) };
        var found = false;
        var battery = safeNumber(:bodyBattery, now);
        if (battery != null) {
            result["body_battery"] = battery;
            found = true;
        }
        var stress = safeNumber(:stress, now);
        if (stress != null) {
            result["stress"] = stress;
            found = true;
        }
        var resting = safeNumber(:restingHr, now);
        if (resting != null) {
            result["resting_hr"] = resting;
            found = true;
        }
        return found ? result : null;
    }

    hidden function safeNumber(which as Symbol, now as Number) as Number or Null {
        try {
            if (which == :bodyBattery) {
                return _source.bodyBattery(now);
            }
            if (which == :stress) {
                return _source.stress(now);
            }
            return _source.restingHr();
        } catch (e) {
            return null;   // one value failing leaves only that value empty
        }
    }

    hidden function extrasNow() as Dictionary or Null {
        var extras = {};
        try {
            var recovery = _source.recoveryTimeH();
            if (recovery != null) {
                extras["recovery_time_h"] = recovery;
            }
        } catch (e) {
        }
        try {
            var effect = _source.trainingEffect();
            if (effect != null && (effect as Numeric) <= 5) {
                extras["training_effect_aerobic"] = effect;
            }
        } catch (e) {
        }
        return extras.size() > 0 ? extras : null;
    }
}
