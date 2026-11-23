import Toybox.Application;
import Toybox.Lang;
import Toybox.Test;

// The few test doubles of the memory build (23.11.2026, MOB-010): copies of the ones of the normal test build, so
// that this build holds nothing but the app and the memory tests.

(:test)
class MemoryStore extends KeyValueStore {
    var values as Dictionary<String, Application.Storage.ValueType>;

    function initialize() {
        KeyValueStore.initialize();
        values = {} as Dictionary<String, Application.Storage.ValueType>;
    }

    function getValue(key as String) as Application.Storage.ValueType {
        return values[key];
    }

    function setValue(key as String, value as Application.Storage.ValueType) as Void {
        values[key] = value;
    }

    function deleteValue(key as String) as Void {
        values.remove(key);
    }
}

(:test)
class FakeClock extends PairingClock {
    var now as Number;

    function initialize() {
        PairingClock.initialize();
        now = 1000000;
    }

    function utcOffsetMinutes() as Number {
        return 0;
    }

    function nowSeconds() as Number {
        return now;
    }
}

// No vibration, no recording: the memory tests only run the state machines.
(:test)
class QuietSignals extends Signals {
    function initialize() {
        Signals.initialize(null);
    }

    function outputPattern(pattern as Number, steps as Array<Number>, loud as Boolean, vibrate as Boolean, tone as Boolean) as Void {
    }
}

(:test)
class QuietBackend extends RecorderBackend {
    function initialize() {
        RecorderBackend.initialize();
    }

    function open() as Boolean {
        return true;
    }

    function lap(reps as Number, loadG as Number or Null) as Boolean {
        return true;
    }

    function start() as Boolean {
        return true;
    }

    function stop() as Boolean {
        return true;
    }

    function save() as Boolean {
        return true;
    }

    function discard() as Boolean {
        return true;
    }
}
