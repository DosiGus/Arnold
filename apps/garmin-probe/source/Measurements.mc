import Toybox.Activity;
import Toybox.ActivityMonitor;
import Toybox.Lang;
import Toybox.SensorHistory;
import Toybox.System;
import Toybox.Time;
import Toybox.UserProfile;

// Never print personal metric values: availability and history geometry suffice.
module Measurements {
    function available(label as String, value as Object?) as Void {
        Log.line(label + (value == null ? ": null" : ": vorhanden"));
    }
    function history(label as String, it as SensorHistory.SensorHistoryIterator) as Void {
        var count = 0;
        var valid = 0;
        var newest = 0;
        var oldest = 0;
        var previous = 0;
        var minGap = 2147483647;
        var maxGap = 0;
        var sample = it.next();
        while (sample != null && count < 10000) {
            var when = sample.when.value();
            if (count == 0) { newest = when; }
            oldest = when;
            if (sample.data != null) { valid++; }
            if (count > 0) {
                var gap = previous - when;
                if (gap < minGap) { minGap = gap; }
                if (gap > maxGap) { maxGap = gap; }
            }
            previous = when;
            count++;
            sample = it.next();
        }
        Log.line(label + " n=" + count + " valid=" + valid);
        Log.line("Spanne=" + (newest - oldest) + "s");
        if (count > 1) { Log.line("Intervall=" + minGap + ".." + maxGap + "s"); }
        if (sample != null) { Log.line("ABGESCHNITTEN bei 10000"); }
    }
    function runAll() as Void {
        Log.start("Basis 1,3-10,21");
        var ids = [1,3,4,5,6,7,8,9,10,21];
        for (var i = 0; i < ids.size(); i++) {
            try { measure(ids[i]); } catch (e instanceof Lang.Exception) { Log.line("Messung " + ids[i] + ": Ausnahme"); }
        }
    }
    function runOne(id as Number) as Void {
        Log.start("Messung " + id);
        try { measure(id); } catch (e instanceof Lang.Exception) { Log.line("Messung " + id + ": Ausnahme"); }
    }
    function measure(id as Number) as Void {
        var opt = { :order => SensorHistory.ORDER_NEWEST_FIRST };
        var profile = UserProfile.getProfile();
        var day = ActivityMonitor.getInfo();
        if (id == 1) {
        var stats = System.getSystemStats();
        Log.line("1 Heap ges=" + stats.totalMemory);
        Log.line("frei=" + stats.freeMemory + " belegt=" + stats.usedMemory);
        }
        if (id == 3) {
        Log.line("3 UTC-Offset=" + System.getClockTime().timeZoneOffset + "s");
        Log.line("IANA: keine SDK-API");
        }
        if (id == 4) {
        if (SensorHistory has :getBodyBatteryHistory) { history("4 BodyBattery", SensorHistory.getBodyBatteryHistory(opt)); }
        else { Log.line("4 API fehlt"); }
        }
        if (id == 5) {
        if (SensorHistory has :getStressHistory) { history("5 Stress", SensorHistory.getStressHistory(opt)); }
        else { Log.line("5 API fehlt"); }
        }
        if (id == 6) {
        if (SensorHistory has :getHeartRateHistory) { history("6 Herzfrequenz", SensorHistory.getHeartRateHistory(opt)); }
        else { Log.line("6 API fehlt"); }
        }
        if (id == 7) {
        if (profile has :restingHeartRate) { available("7 Ruhepuls", profile.restingHeartRate); }
        else { Log.line("7 API fehlt"); }
        }
        if (id == 8) {
        if (day has :steps) { available("8 Schritte", day.steps); }
        if (day has :activeMinutesDay) { available("8 Intensitaetsmin", day.activeMinutesDay); }
        }
        if (id == 9) {
        if (SensorHistory has :getOxygenSaturationHistory) { history("9 Sauerstoff", SensorHistory.getOxygenSaturationHistory(opt)); }
        else { Log.line("9 Sauerstoff API fehlt"); }
        if (SensorHistory has :getTemperatureHistory) { history("9 Temperatur", SensorHistory.getTemperatureHistory(opt)); }
        else { Log.line("9 Temperatur API fehlt"); }
        }
        if (id == 10) {
        if (day has :timeToRecovery) { available("10 Erholung", day.timeToRecovery); }
        else { Log.line("10 Erholung API fehlt"); }
        if (profile has :vo2maxRunning) { available("10 VO2max", profile.vo2maxRunning); }
        else { Log.line("10 VO2max API fehlt"); }
        var activity = Activity.getActivityInfo();
        if (activity has :trainingEffect) { available("10 Trainingseffekt", activity.trainingEffect); }
        else { Log.line("10 Effekt API fehlt"); }
        }
        if (id == 10) { Log.line("Complications: watch-app nicht erlaubt"); }
        if (id == 21) {
        var settings = System.getDeviceSettings();
        Log.line("21 SDK-Ziel fr255");
        Log.line("Teil=" + settings.partNumber);
        Log.line("FW=" + settings.firmwareVersion.toString());
        }
    }
}
