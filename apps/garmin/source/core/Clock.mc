import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

// Time helpers. The server wants UTC timestamps with Z, the local calendar date
// and the UTC offset in minutes (07 D-10).
(:background)
module Clock {

    function nowUtcSeconds() as Number {
        return Time.now().value();
    }

    // Offset of local time to UTC in minutes, including daylight saving time.
    function utcOffsetMinutes() as Number {
        return System.getClockTime().timeZoneOffset / 60;
    }

    // "2026-11-10T07:05:09Z"
    function isoUtc(epochSeconds as Number) as String {
        var info = Gregorian.utcInfo(new Time.Moment(epochSeconds), Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$Z", [
            (info.year as Number).format("%04d"),
            (info.month as Number).format("%02d"),
            (info.day as Number).format("%02d"),
            (info.hour as Number).format("%02d"),
            (info.min as Number).format("%02d"),
            (info.sec as Number).format("%02d")
        ]);
    }

    // Calendar date in the given UTC offset, "2026-11-10". The offset is passed in
    // so a saved workout keeps the date it was trained on.
    function localDate(epochSeconds as Number, offsetMinutes as Number) as String {
        var info = Gregorian.utcInfo(new Time.Moment(epochSeconds + offsetMinutes * 60), Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$", [
            (info.year as Number).format("%04d"),
            (info.month as Number).format("%02d"),
            (info.day as Number).format("%02d")
        ]);
    }
}
