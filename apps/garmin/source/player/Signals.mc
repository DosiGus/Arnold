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

    // Run alerts (RUN-017). Each pattern is a list of on/off times in ms (on, off, on, ...); the rest timer's signals above stay as they are.
    // Same switches: vibration and tone.
    static const RUN_HR_HIGH as Number = 0;        // two long
    static const RUN_HR_LOW as Number = 1;         // one short: a bit faster
    static const RUN_PACE_FAST as Number = 2;      // short-short: faster
    static const RUN_PACE_SLOW as Number = 3;      // one long: slower
    static const RUN_COUNTDOWN as Number = 4;      // one short
    static const RUN_CHANGE as Number = 5;         // three short and one long
    static const RUN_KM as Number = 6;             // one short
    static const RUN_DRINK as Number = 7;          // one short
    static const RUN_NO_HEART_RATE as Number = 8;  // short-short

    function runAlert(pattern as Number) as Void {
        var steps = [150] as Array<Number>;
        var loud = false;
        if (pattern == RUN_HR_HIGH) {
            steps = [500, 150, 500] as Array<Number>;
            loud = true;
        } else if (pattern == RUN_PACE_FAST || pattern == RUN_NO_HEART_RATE) {
            steps = [150, 150, 150] as Array<Number>;
        } else if (pattern == RUN_PACE_SLOW) {
            steps = [500] as Array<Number>;
        } else if (pattern == RUN_CHANGE) {
            steps = [150, 100, 150, 100, 150, 100, 500] as Array<Number>;
            loud = true;
        }
        outputPattern(pattern, steps, loud, _settings.isOn(Settings.VIBRATION), _settings.isOn(Settings.TONE));
    }

    // Lets the run use the run's settings object (one place to read the switches from).
    function useSettings(settings as Settings) as Void {
        _settings = settings;
    }

    // What the watch does for a run pattern; tests replace it to see the pattern and the switches.
    function outputPattern(pattern as Number, steps as Array<Number>, loud as Boolean, vibrate as Boolean, tone as Boolean) as Void {
        if (vibrate && Attention has :vibrate) {
            var profiles = [] as Array<Attention.VibeProfile>;
            for (var i = 0; i < steps.size(); i++) {
                profiles.add(new Attention.VibeProfile(i % 2 == 0 ? (loud ? 100 : 60) : 0, steps[i]));
            }
            Attention.vibrate(profiles);
        }
        if (tone && Attention has :playTone) {
            var long = pattern == RUN_HR_HIGH || pattern == RUN_CHANGE;
            Attention.playTone(long ? Attention.TONE_ALERT_HI : (pattern == RUN_PACE_SLOW ? Attention.TONE_ALERT_LO : Attention.TONE_KEY));
        }
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
