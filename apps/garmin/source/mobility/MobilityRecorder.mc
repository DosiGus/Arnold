import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Lang;
import Toybox.WatchUi;

// The Garmin activity of a mobility routine (MOB-009): sport Training, sub sport flexibility training, one lap per
// exercise. The Recorder of the player package drives it (the same guarded start, pause, save and discard as for
// strength); only the session options and the lap differ. Tests replace the backend, like for strength.
class MobilityBackend extends RecorderBackend {
    private var _session as ActivityRecording.Session or Null;

    function initialize() {
        RecorderBackend.initialize();
        _session = null;
    }

    // What the watch is asked for; a test reads sport and sub sport here.
    function sessionOptions() as { :name as String, :sport as Activity.Sport, :subSport as Activity.SubSport } {
        return {
            :name => WatchUi.loadResource(Rez.Strings.RecMobilityName) as String,
            :sport => Activity.SPORT_TRAINING,
            :subSport => Activity.SUB_SPORT_FLEXIBILITY_TRAINING
        };
    }

    function open() as Boolean {
        var session = ActivityRecording.createSession(sessionOptions());
        _session = session;
        return session.start();
    }

    function lap(reps as Number, loadG as Number or Null) as Boolean {
        return _session != null && (_session as ActivityRecording.Session).addLap();
    }

    function start() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).start();
    }

    function stop() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).stop();
    }

    function save() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).save();
    }

    function discard() as Boolean {
        return _session != null && (_session as ActivityRecording.Session).discard();
    }
}
