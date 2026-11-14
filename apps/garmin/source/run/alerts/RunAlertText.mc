import Toybox.Lang;
import Toybox.WatchUi;

// The words of the hint line for an alarm event (RUN-017), in the language of the watch.
module RunAlertText {
    function text(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }

    // Seconds per km as "m:ss".
    function pace(secondsPerKm as Number) as String {
        return (secondsPerKm / 60).toString() + ":" + (secondsPerKm % 60).format("%02d");
    }

    function range(low as Number, high as Number, formatted as Boolean) as String {
        var a = formatted ? pace(low) : low.toString();
        var b = formatted ? pace(high) : high.toString();
        return low == high ? a : a + "-" + b;
    }

    // "Work 4:30-4:50", "Recovery", "End" for the end of the plan.
    function segment(kind as Number, targetType as Number, low as Number, high as Number) as String {
        if (kind < 0 || kind > 4) {
            return text(Rez.Strings.RunAlEnd);
        }
        var names = [
            Rez.Strings.RunAlKind0, Rez.Strings.RunAlKind1, Rez.Strings.RunAlKind2, Rez.Strings.RunAlKind3, Rez.Strings.RunAlKind4
        ] as Array<ResourceId>;
        var name = text(names[kind]);
        if (targetType == 1) {
            return name + " Z" + range(low, high, false);
        } else if (targetType == 2) {
            return name + " " + range(low, high, true);
        } else if (targetType == 3) {
            return name + " " + range(low, high, false);
        } else if (targetType == 4) {
            return name + " " + Lang.format(text(Rez.Strings.RunAlEffort), [range(low, high, false)]);
        }
        return name;
    }

    function of(event as RunAlertEvent) as String {
        var type = event.type;
        if (type == RunAlertEvent.HR_HIGH) {
            return text(Rez.Strings.RunAlHrHigh);
        } else if (type == RunAlertEvent.HR_LOW) {
            return text(Rez.Strings.RunAlHrLow);
        } else if (type == RunAlertEvent.PACE_FAST) {
            return text(Rez.Strings.RunAlFaster);
        } else if (type == RunAlertEvent.PACE_SLOW) {
            return text(Rez.Strings.RunAlSlower);
        } else if (type == RunAlertEvent.COUNTDOWN) {
            return Lang.format(text(Rez.Strings.RunAlNext), [segment(event.kind, event.targetType, event.targetLow, event.targetHigh)]);
        } else if (type == RunAlertEvent.CHANGE) {
            return Lang.format(text(Rez.Strings.RunAlNow), [segment(event.kind, event.targetType, event.targetLow, event.targetHigh)]);
        } else if (type == RunAlertEvent.KM) {
            if (event.timeS < 0) {
                return Lang.format(text(Rez.Strings.RunAlKmOnly), [event.value]);
            }
            return Lang.format(text(Rez.Strings.RunAlKm), [event.value, pace(event.timeS)]);
        } else if (type == RunAlertEvent.DRINK) {
            return text(Rez.Strings.RunAlDrink);
        }
        return text(Rez.Strings.RunAlNoHr);
    }
}
