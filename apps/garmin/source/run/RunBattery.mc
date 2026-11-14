import Toybox.Lang;

// Battery check of the pre-start screen (RUN-025): does the battery last for the planned run?
//
// ESTIMATE, not a measurement: one rate per hour of running, the same for every device, kept
// here as the only place. 8 % per hour outdoors (position with several satellite systems and
// the display on) is deliberately on the high side, so the warning comes early rather than late;
// 4 % per hour on a treadmill (no position). When Kevin's runs show real values for the
// devices, only these two numbers change.
module RunBattery {
    const OUTDOOR_PERCENT_PER_HOUR as Number = 8;
    const INDOOR_PERCENT_PER_HOUR as Number = 4;

    function percentPerHour(usesGps as Boolean) as Number {
        return usesGps ? OUTDOOR_PERCENT_PER_HOUR : INDOOR_PERCENT_PER_HOUR;
    }

    // How many minutes of running the battery level lasts by the estimate.
    function minutesLeft(batteryPercent as Number, usesGps as Boolean) as Number {
        return batteryPercent * 60 / percentPerHour(usesGps);
    }

    // True if the planned duration is more than the battery lasts. An unknown duration (free
    // run, or a prescription without time) never warns.
    function isShort(plannedMinutes as Number or Null, batteryPercent as Number, usesGps as Boolean) as Boolean {
        if (plannedMinutes == null) {
            return false;
        }
        return (plannedMinutes as Number) > minutesLeft(batteryPercent, usesGps);
    }
}
