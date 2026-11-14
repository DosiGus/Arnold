import Toybox.Lang;

// The line the display may show for a few seconds: what just happened and until when (`RunAlerts.seconds`).
class RunAlertHint {
    var text as String;
    var untilS as Number;

    function initialize(hintText as String, until as Number) {
        text = hintText;
        untilS = until;
    }
}

// Joins the alarm rules to the second-by-second tick of a run (RUN-017): once a second it fills the snapshot from the run
// session, asks `RunAlerts` what happened, vibrates or beeps through `Signals` and keeps the hint line. The only part of the
// alarms that touches the watch; `RunAlerts` itself stays pure.
class RunAlertLink {
    const HINT_S as Number = 5;

    var alerts as RunAlerts;
    var signals as Signals;        // tests replace its output
    var muted as Boolean;          // muted for this run: no vibration or tone, the hint line stays

    private var _input as RunAlertInput;
    private var _settings as Settings;
    private var _hint as RunAlertHint or Null;

    function initialize(prescription as Dictionary or Null, hrZones as Array<Number> or Null, settings as Settings) {
        alerts = new RunAlerts(new RunAlertParams(prescription, hrZones));
        signals = new Signals(null);
        signals.useSettings(settings);
        muted = false;
        _input = new RunAlertInput();
        _settings = settings;
        _hint = null;
    }

    // One second of running (called by the session after it followed the segments).
    function second(session as RunSession) as Void {
        fill(session);
        var count = alerts.update(_input);
        var shown = false;
        var played = false;
        for (var i = 0; i < count; i++) {
            var event = alerts.eventAt(i);
            if (event.shown && !shown) {
                shown = true;
                _hint = new RunAlertHint(RunAlertText.of(event), alerts.seconds() + HINT_S);
            }
            if (event.audible && !played) {
                played = true;
                signals.runAlert(pattern(event.type));
            }
        }
    }

    // The hint to show now, or null when the last one is over (or there was none).
    function currentHint() as RunAlertHint or Null {
        var hint = _hint;
        if (hint == null || alerts.seconds() >= (hint as RunAlertHint).untilS) {
            return null;
        }
        return hint;
    }

    hidden function pattern(type as Number) as Number {
        var table = [
            Signals.RUN_HR_HIGH, Signals.RUN_HR_LOW, Signals.RUN_PACE_FAST, Signals.RUN_PACE_SLOW, Signals.RUN_COUNTDOWN,
            Signals.RUN_CHANGE, Signals.RUN_KM, Signals.RUN_DRINK, Signals.RUN_NO_HEART_RATE
        ] as Array<Number>;
        return table[type];
    }

    hidden function fill(session as RunSession) as Void {
        var plan = session.plan;
        var calc = session.calc;
        var input = _input;
        var ordinal = session.ordinal;
        input.timerS = calc.timerS;
        input.distanceCm = calc.distanceCm;
        input.heartRate = session.reading.heartRate;
        input.paceSKm = calc.paceAlarm();
        input.ordinal = ordinal;
        input.durationType = plan.durationType(ordinal);
        input.durationValue = plan.durationValue(ordinal);
        input.segmentSeconds = session.segmentSeconds();
        input.segmentCm = session.segmentMeters() * 100;
        var segment = plan.at(ordinal);
        input.kind = segment == null ? -1 : (segment as Array)[0] as Number;
        input.targetType = segment == null ? 0 : (segment as Array)[3] as Number;
        input.targetLow = segment == null ? 0 : (segment as Array)[4] as Number;
        input.targetHigh = segment == null ? 0 : (segment as Array)[5] as Number;
        var next = plan.at(ordinal + 1);
        input.nextKind = next == null ? -1 : (next as Array)[0] as Number;
        input.nextTargetType = next == null ? 0 : (next as Array)[3] as Number;
        input.nextTargetLow = next == null ? 0 : (next as Array)[4] as Number;
        input.nextTargetHigh = next == null ? 0 : (next as Array)[5] as Number;
        input.kmSignal = _settings.isOn(Settings.KM_SIGNAL);
        input.hrAlarms = _settings.isOn(Settings.HR_ALARMS);
        input.muted = muted;
    }
}
