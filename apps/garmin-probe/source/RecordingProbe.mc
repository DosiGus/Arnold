import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Lang;

// Explicit owner menu actions only. No recording on app startup.
module RecordingProbe {
    var session as ActivityRecording.Session?;
    var reps as FitContributor.Field?;
    var load as FitContributor.Field?;
    function start() as Void {
        Log.start("13/19/20 Test-FIT");
        if (session != null) { Log.line("Bereits gestartet"); return; }
        var s = ActivityRecording.createSession({:name => "Arnold PROBE", :sport => Activity.SPORT_TRAINING,
            :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING});
        reps = s.createField("Probe reps", 0, FitContributor.DATA_TYPE_UINT16,
            {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "reps"});
        load = s.createField("Probe load", 1, FitContributor.DATA_TYPE_UINT16,
            {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "kg"});
        session = s;
        Log.line("Start=" + s.start());
        Log.line("Synthetisch: 8 Wdh / 20kg");
        Log.line("BACK -> Runde / Absturz");
    }
    function lap() as Void {
        Log.start("19/20 Runde");
        if (session == null) { Log.line("Erst Aufzeichnung starten"); return; }
        (reps as FitContributor.Field).setData(8);
        (load as FitContributor.Field).setData(20);
        Log.line("addLap=" + (session as ActivityRecording.Session).addLap());
        Log.line("Connect-Anzeige NICHT geprueft");
    }
    function save() as Void {
        Log.start("13/19/20 Speichern");
        if (session == null) { Log.line("Keine laufende Aufzeichnung"); return; }
        var s = session as ActivityRecording.Session;
        Log.line("Stop=" + s.stop());
        var saved = s.save();
        Log.line("FIT save=" + saved);
        if (saved) { session = null; }
        Log.line("Connect-Anzeige manuell pruefen");
    }
    function discard() as Void {
        Log.start("Test-FIT verwerfen");
        if (session != null) {
            var s = session as ActivityRecording.Session;
            s.stop();
            if (s.discard()) { session = null; Log.line("Verworfen"); }
        }
    }
    function crash() as Void {
        if (session == null) { Log.start("13"); Log.line("Erst Aufzeichnung starten"); return; }
        throw new Lang.Exception();
    }
}
