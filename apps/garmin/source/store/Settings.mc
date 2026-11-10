import Toybox.Lang;

// The user's switches (key "settings", GAR-B3-08): vibration, tone and the warning ten
// seconds before the end of a rest. All three are on by default (07 D-31); a missing,
// damaged or unknown value counts as on, so a broken entry can never silence the signal
// by accident. Read fresh on every use: a change takes effect at once.
class Settings {
    static const VIBRATION as String = "vib";
    static const TONE as String = "tone";
    static const WARNING as String = "warn";

    private var _store as KeyValueStore or Null;

    function initialize(store as KeyValueStore or Null) {
        _store = store;
    }

    function isOn(key as String) as Boolean {
        var stored = stored();
        if (stored == null) {
            return true;
        }
        var value = (stored as Dictionary)[key];
        if (value instanceof Boolean) {
            return value as Boolean;
        }
        return true;
    }

    // Writes one switch and keeps the others as they are.
    function set(key as String, on as Boolean) as Void {
        if (_store == null) {
            return;
        }
        var updated = {
            VIBRATION => key.equals(VIBRATION) ? on : isOn(VIBRATION),
            TONE => key.equals(TONE) ? on : isOn(TONE),
            WARNING => key.equals(WARNING) ? on : isOn(WARNING)
        };
        (_store as KeyValueStore).setValue(StoreKeys.SETTINGS, updated);
    }

    hidden function stored() as Dictionary or Null {
        if (_store == null) {
            return null;
        }
        var value = (_store as KeyValueStore).getValue(StoreKeys.SETTINGS);
        return value instanceof Dictionary ? value as Dictionary : null;
    }
}
