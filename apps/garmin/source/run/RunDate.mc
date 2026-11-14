import Toybox.Lang;

// Calendar dates as day numbers (days since 1970-01-01), without Gregorian objects,
// so the same code runs in the simulator tests and on the watch. The server names
// "today" (GET /runs/upcoming); between two answers the watch only counts days.
module RunDate {

    // Day number of "2026-11-14", or null when the text is not a date.
    function dayNumber(iso as String) as Number or Null {
        if (iso.length() != 10) {
            return null;
        }
        var year = (iso.substring(0, 4) as String).toNumber();
        var month = (iso.substring(5, 7) as String).toNumber();
        var day = (iso.substring(8, 10) as String).toNumber();
        if (year == null || month == null || day == null) {
            return null;
        }
        if (!(iso.substring(4, 5) as String).equals("-") || !(iso.substring(7, 8) as String).equals("-")) {
            return null;
        }
        var y = year as Number;
        var m = month as Number;
        var d = day as Number;
        if (m < 1 || m > 12 || d < 1 || d > 31) {
            return null;
        }
        if (m <= 2) {
            y -= 1;
        }
        var era = (y >= 0 ? y : y - 399) / 400;
        var yoe = y - era * 400;
        var doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        var doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    // "2026-11-14" for a day number.
    function iso(dayNumberValue as Number) as String {
        var z = dayNumberValue + 719468;
        var era = (z >= 0 ? z : z - 146096) / 146097;
        var doe = z - era * 146097;
        var yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        var y = yoe + era * 400;
        var doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        var mp = (5 * doy + 2) / 153;
        var d = doy - (153 * mp + 2) / 5 + 1;
        var m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) {
            y += 1;
        }
        return Lang.format("$1$-$2$-$3$", [y.format("%04d"), m.format("%02d"), d.format("%02d")]);
    }

    // The local calendar day of a moment (offset in minutes east of UTC).
    function localDay(epochSeconds as Number, offsetMinutes as Number) as Number {
        var shifted = epochSeconds + offsetMinutes * 60;
        return (shifted >= 0 ? shifted : shifted - 86399) / 86400;
    }
}
