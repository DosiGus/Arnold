import Toybox.Lang;

// The user's switches (key "settings", GAR-B3-08, RUN-025): vibration, tone and the warning ten
// seconds before the end of a rest, and for runs the kilometre signal, auto pause and heart
// rate alarms. All are on by default (07 D-31) except auto pause (RUN-025: off); a missing,
// damaged or unknown value counts as the default, so a broken entry can never silence a
// signal by accident. Read fresh on every use: a change takes effect at once.
class Settings {
    static const VIBRATION as String = "vib";
    static const TONE as String = "tone";
    static const WARNING as String = "warn";
    static const KM_SIGNAL as String = "km";
    static const AUTO_PAUSE as String = "ap";
    static const HR_ALARMS as String = "hra";

    private var _store as KeyValueStore or Null;

    function initialize(store as KeyValueStore or Null) {
        _store = store;
    }

    // What a switch is before the user touched it: on, except auto pause.
    static function defaultFor(key as String) as Boolean {
        return !key.equals(AUTO_PAUSE);
    }

    function isOn(key as String) as Boolean {
        var stored = stored();
        if (stored == null) {
            return defaultFor(key);
        }
        var value = (stored as Dictionary)[key];
        if (value instanceof Boolean) {
            return value as Boolean;
        }
        return defaultFor(key);
    }

    // Writes one switch and keeps the others as they are.
    function set(key as String, on as Boolean) as Void {
        if (_store == null) {
            return;
        }
        var updated = {
            VIBRATION => key.equals(VIBRATION) ? on : isOn(VIBRATION),
            TONE => key.equals(TONE) ? on : isOn(TONE),
            WARNING => key.equals(WARNING) ? on : isOn(WARNING),
            KM_SIGNAL => key.equals(KM_SIGNAL) ? on : isOn(KM_SIGNAL),
            AUTO_PAUSE => key.equals(AUTO_PAUSE) ? on : isOn(AUTO_PAUSE),
            HR_ALARMS => key.equals(HR_ALARMS) ? on : isOn(HR_ALARMS)
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
