import Toybox.Attention;
import Toybox.Lang;

// Vibration and tone for the rest timer: a short warning ten seconds before the
// end and a clear signal at the end (PRD T-06). Both are on by default and can
// be switched off one by one in the settings (see Settings, GAR-B3-08). Tests replace this class.
class Signals {
    private var _settings as Settings;

    function initialize(store as KeyValueStore or Null) {
        _settings = new Settings(store);
    }

    // Ten seconds before the end of the rest.
    function warn() as Void {
        if (!_settings.isOn(Settings.WARNING)) {
            return;
        }
        play(150, false);
    }

    // The rest is over.
    function restOver() as Void {
        play(500, true);
    }

    hidden function play(durationMs as Number, loud as Boolean) as Void {
        output(durationMs, loud, _settings.isOn(Settings.VIBRATION), _settings.isOn(Settings.TONE));
    }

    // What the watch does; tests replace it to see which switches are on.
    function output(durationMs as Number, loud as Boolean, vibrate as Boolean, tone as Boolean) as Void {
        if (vibrate && Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(loud ? 100 : 50, durationMs)] as Array<Attention.VibeProfile>);
        }
        if (tone && Attention has :playTone) {
            Attention.playTone(loud ? Attention.TONE_ALERT_HI : Attention.TONE_KEY);
        }
    }
}
