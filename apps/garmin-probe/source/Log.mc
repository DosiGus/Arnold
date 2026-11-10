import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

// Result lines for the screen and the log file.
module Log {
    var lines as Array<String> = [] as Array<String>;

    function start(title as String) as Void {
        lines = [] as Array<String>;
        var now = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        System.println("=== " + title + " " + now.hour.format("%02d") + ":" + now.min.format("%02d") + ":" + now.sec.format("%02d"));
    }

    function line(text as String) as Void {
        var rest = text;
        while (rest.length() > 24) {
            lines.add(rest.substring(0, 24) as String);
            rest = rest.substring(24, rest.length()) as String;
        }
        lines.add(rest);
        System.println(text);
    }
}
