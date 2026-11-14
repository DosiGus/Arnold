import Toybox.Lang;

// Texts of a run on the display. No state, no arithmetic of the run: the numbers come in as parameters.
module RunText {
    const NONE as String = "--";   // a value the watch does not have (never 0)

    // "mm:ss", from one hour "h:mm:ss".
    function clock(seconds as Number) as String {
        var s = seconds < 0 ? 0 : seconds;
        var h = s / 3600;
        var m = (s % 3600) / 60;
        if (h > 0) {
            return h.toString() + ":" + m.format("%02d") + ":" + (s % 60).format("%02d");
        }
        return m.format("%02d") + ":" + (s % 60).format("%02d");
    }

    // Distance in km with two decimals and the decimal sign of the language.
    function km(cm as Number) as String {
        var hundredths = cm / 1000;
        return (hundredths / 100).toString() + HomeScreen.text(Rez.Strings.RunSep) + (hundredths % 100).format("%02d");
    }

    // "5,42 km", or "5,42 km (geschätzt)" when the distance is the watch's estimate.
    function distance(cm as Number, estimated as Boolean) as String {
        return Lang.format(HomeScreen.text(estimated ? Rez.Strings.RunKmEst : Rez.Strings.RunKm), [km(cm)]);
    }

    // A pace in seconds per km as "5:12"; "--" without one.
    function pace(secondsPerKm as Number or Null) as String {
        if (secondsPerKm == null || (secondsPerKm as Number) <= 0) {
            return NONE;
        }
        var s = secondsPerKm as Number;
        if (s >= 6000) {
            return NONE;      // slower than 100 min/km is standing still
        }
        return (s / 60).toString() + ":" + (s % 60).format("%02d");
    }

    // "5:12 /km"
    function paceLine(secondsPerKm as Number or Null) as String {
        return Lang.format(HomeScreen.text(Rez.Strings.RunPace), [pace(secondsPerKm)]);
    }

    function heartLine(heartRate as Number or Null) as String {
        return Lang.format(HomeScreen.text(Rez.Strings.RunHeartLine), [heartRate == null ? NONE : (heartRate as Number).toString()]);
    }

    function meters(m as Number) as String {
        return Lang.format(HomeScreen.text(Rez.Strings.RunMeters), [m < 0 ? 0 : m]);
    }

    // Duration of a segment: "03:00", "400 m" or "offen".
    function duration(type as Number, value as Number) as String {
        if (type == RunSegments.DURATION_SECONDS) {
            return clock(value);
        }
        if (type == RunSegments.DURATION_METERS) {
            return meters(value);
        }
        return HomeScreen.text(Rez.Strings.RunOpenSeg);
    }

    // Name of a segment kind (0 warm-up ... 4 rest).
    function kindName(kind as Number) as String {
        var ids = [Rez.Strings.RunKind0, Rez.Strings.RunKind1, Rez.Strings.RunKind2, Rez.Strings.RunKind3, Rez.Strings.RunKind4] as Array<ResourceId>;
        return HomeScreen.text(ids[kind >= 0 && kind < 5 ? kind : 1]);
    }

    // The target of a segment as the plan states it: "Ziel 4:30-4:45 /km", "Ziel Zone 3", ...
    function target(type as Number, low as Number, high as Number) as String {
        if (type == 1) {
            return low == high ? Lang.format(HomeScreen.text(Rez.Strings.RunTargetZone), [low]) : Lang.format(HomeScreen.text(Rez.Strings.RunTargetZones), [low, high]);
        }
        if (type == 2) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunTargetPace), [pace(low), pace(high)]);
        }
        if (type == 3) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunTargetBpm), [low, high]);
        }
        return Lang.format(HomeScreen.text(Rez.Strings.RunTargetRpe), [low, high]);
    }
}
