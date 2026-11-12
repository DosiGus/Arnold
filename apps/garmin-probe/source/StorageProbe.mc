import Toybox.Application;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

module StorageProbe {
    var timer as Timer.Timer?;
    var seq as Number = 0;
    var remaining as Number = 0;
    var bootResult as String = "Noch kein Schreibtest";
    function valid(value as Object?) as Boolean {
        if (!(value instanceof Dictionary)) { return false; }
        var n = value["seq"];
        var m = value["mirror"];
        var marker = value["marker"];
        if (!(n instanceof Number) || !(m instanceof Number) || !(marker instanceof String)) { return false; }
        return m == -n && marker.equals("probe-v1");
    }
    function checkOnStart() as Void {
        var value = Application.Storage.getValue("atomic");
        bootResult = value == null ? "14 kein gespeicherter Wert" :
            (valid(value) ? "14 Start: Wert konsistent" : "14 Start: WERT DEFEKT");
        Log.start("Neustart");
        Log.line(bootResult);
        Log.line("13 FIT-Wiederaufnahme offen");
        // No getSession/resume API: inspect the watch's recovery prompt manually.
        Log.line("Garmin Recovery manuell pruefen");
    }
    function start() as Void {
        Log.start("14 Schreibtest");
        Log.line(bootResult);
        var value = Application.Storage.getValue("atomic");
        if (value != null && !valid(value)) { Log.line("Defekt erhalten / kein Ueberschreiben"); return; }
        if (value instanceof Dictionary && valid(value)) { seq = value["seq"] as Number; }
        remaining = 200;
        if (timer != null) { (timer as Timer.Timer).stop(); }
        timer = new Timer.Timer();
        (timer as Timer.Timer).start(new StorageTicker().method(:tick), 50, true);
        Log.line("200 Einzelwerte / 10s");
        Log.line("BACK: Menue, Absturz 14");
    }
    function tick() as Void {
        seq++;
        Application.Storage.setValue("atomic", {"seq" => seq, "mirror" => -seq, "marker" => "probe-v1"});
        if (!valid(Application.Storage.getValue("atomic"))) {
            Log.line("14 FEHLER read-back");
            remaining = 1;
        }
        remaining--;
        if (remaining <= 0) {
            (timer as Timer.Timer).stop();
            Log.line("14 Schreiben beendet");
            Log.line("Noch KEIN Stromausfall-Beweis");
            WatchUi.requestUpdate();
        }
    }
    function crash() as Void {
        throw new Lang.Exception();
    }
}

class StorageTicker {
    function initialize() {}
    function tick() as Void { StorageProbe.tick(); }
}
