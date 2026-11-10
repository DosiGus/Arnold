import Toybox.Attention;
import Toybox.Lang;

// Vibration and tone for the rest timer: a short warning ten seconds before the
// end and a clear signal at the end (PRD T-06). Both are on by default and can
// be switched off one by one in the settings (key "settings", GAR-B3-08:
// "vib", "tone", "warn"; anything missing counts as on). Tests replace this class.
class Signals {
    private var _store as KeyValueStore or Null;

    function initialize(store as KeyValueStore or Null) {
        _store = store;
    }

    // Ten seconds before the end of the rest.
    function warn() as Void {
        if (!enabled("warn")) {
            return;
        }
        play(150, false);
    }

    // The rest is over.
    function restOver() as Void {
        play(500, true);
    }

    hidden function enabled(key as String) as Boolean {
        if (_store == null) {
            return true;
        }
        var settings = (_store as KeyValueStore).getValue(StoreKeys.SETTINGS);
        if (!(settings instanceof Dictionary)) {
            return true;
        }
        var value = (settings as Dictionary)[key];
        if (value instanceof Boolean && !(value as Boolean)) {
            return false;
        }
        return true;
    }

    hidden function play(durationMs as Number, loud as Boolean) as Void {
        if (enabled("vib") && Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(loud ? 100 : 50, durationMs)] as Array<Attention.VibeProfile>);
        }
        if (enabled("tone") && Attention has :playTone) {
            Attention.playTone(loud ? Attention.TONE_ALERT_HI : Attention.TONE_KEY);
        }
    }
}
