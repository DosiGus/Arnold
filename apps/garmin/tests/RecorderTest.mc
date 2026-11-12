import Toybox.Lang;
import Toybox.Test;

// Writes down what the recorder asked for instead of recording.
(:test)
class FakeBackend extends RecorderBackend {
    var calls as Array<String>;
    var lastReps as Number or Null;
    var lastLoad as Number or Null;
    var failOn as String;        // name of the call that throws
    var refuseOpen as Boolean;
    var saveResult as Boolean;

    function initialize() {
        RecorderBackend.initialize();
        calls = [] as Array<String>;
        lastReps = null;
        lastLoad = null;
        failOn = "";
        refuseOpen = false;
        saveResult = true;
    }

    function note(name as String) as Void {
        calls.add(name);
        if (failOn.equals(name)) {
            throw new StepFailed();
        }
    }

    function count(name as String) as Number {
        var n = 0;
        for (var i = 0; i < calls.size(); i++) {
            if (calls[i].equals(name)) {
                n++;
            }
        }
        return n;
    }

    function open() as Boolean {
        note("open");
        return !refuseOpen;
    }

    function lap(reps as Number, loadG as Number or Null) as Boolean {
        note("lap");
        lastReps = reps;
        lastLoad = loadG;
        return true;
    }

    function start() as Boolean {
        note("start");
        return true;
    }

    function stop() as Boolean {
        note("stop");
        return true;
    }

    function save() as Boolean {
        note("save");
        return saveResult;
    }

    function discard() as Boolean {
        note("discard");
        return true;
    }
}

(:test)
class RecorderRig {
    var rig as PlayerRig;
    var backend as FakeBackend;
    var recorder as Recorder;

    function initialize() {
        rig = new PlayerRig(false);
        backend = new FakeBackend();
        recorder = new Recorder(rig.session.uuid, backend);
        rig.session.attachRecorder(recorder);
    }
}

(:test)
function recorderStartsWithTheWorkout(logger as Logger) as Boolean {
    var r = new RecorderRig();
    Test.assert(r.recorder.isRunning());
    Test.assertEqual(1, r.backend.count("open"));
    return true;
}

(:test)
function recorderWritesOneLapPerConfirmedSet(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.rig.toFirstSet();
    Test.assert(r.rig.session.confirmSet());
    Test.assertEqual(1, r.recorder.lapCount());
    Test.assertEqual(8, r.backend.lastReps);
    Test.assertEqual(60000, r.backend.lastLoad);
    r.rig.session.endRest();
    Test.assert(r.rig.session.confirmSet());
    Test.assertEqual(2, r.recorder.lapCount());
    return true;
}

(:test)
function recorderLapsNothingForASetThatIsNotConfirmed(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.rig.toFirstSet();
    Test.assertEqual(0, r.recorder.lapCount());   // a set on screen is no lap yet
    r.rig.session.skipExercise();
    Test.assertEqual(0, r.recorder.lapCount());
    return true;
}

(:test)
function recorderStandsStillInAPauseAndGoesOnAfterIt(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.rig.toFirstSet();
    r.rig.session.pause();
    Test.assert(!r.recorder.isRunning());
    Test.assertEqual(1, r.backend.count("stop"));
    r.rig.session.continueWorkout();
    Test.assert(r.recorder.isRunning());
    Test.assertEqual(1, r.backend.count("start"));
    Test.assertEqual(1, r.backend.count("open"));   // the same recording, not a new one
    return true;
}

(:test)
function recorderStopsOnTheSummaryAndSavesWithTheWorkout(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.rig.finishDay();
    Test.assert(r.rig.session.isFinished());
    Test.assert(!r.recorder.isRunning());
    Test.assertEqual(0, r.backend.count("save"));   // not before START on the summary
    Test.assert(r.rig.session.save(r.rig.outbox));
    Test.assertEqual(1, r.backend.count("save"));
    Test.assert(r.recorder.isClosed());
    r.rig.session.save(r.rig.outbox);               // a second tap does not save twice
    Test.assertEqual(1, r.backend.count("save"));
    return true;
}

(:test)
function recorderIsDiscardedWithTheWorkout(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.rig.toFirstSet();
    r.rig.session.confirmSet();
    r.rig.session.discard();
    Test.assertEqual(1, r.backend.count("discard"));
    Test.assertEqual(0, r.backend.count("save"));
    Test.assert(r.recorder.isClosed());
    return true;
}

(:test)
function recorderRunsAgainAfterUndoOnTheSummary(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.rig.finishDay();
    Test.assert(!r.recorder.isRunning());
    Test.assert(r.rig.session.undoLastSet());
    Test.assert(r.recorder.isRunning());
    return true;
}

(:test)
function recorderFailuresNeverReachThePlayer(logger as Logger) as Boolean {
    var names = ["open", "lap", "stop", "start", "save", "discard"];
    for (var i = 0; i < names.size(); i++) {
        var r = new RecorderRig();
        r.backend.failOn = names[i];
        r.rig.toFirstSet();
        Test.assert(r.rig.session.confirmSet());       // the workout goes on whatever the recording does
        r.rig.session.pause();
        r.rig.session.continueWorkout();
        r.rig.finishDay();
        Test.assert(r.rig.session.isFinished());
        Test.assert(r.rig.session.save(r.rig.outbox)); // and is saved for the upload
        r.rig.session.discard();
    }
    return true;
}

(:test)
function recorderGivenUpStaysQuiet(logger as Logger) as Boolean {
    var r = new RecorderRig();
    r.backend.failOn = "lap";
    r.rig.toFirstSet();
    r.rig.session.confirmSet();
    Test.assert(r.recorder.isClosed());
    var before = r.backend.calls.size();
    r.rig.session.endRest();
    r.rig.session.confirmSet();
    r.rig.session.pause();
    Test.assertEqual(before, r.backend.calls.size());   // a given-up recording is not touched again
    return true;
}

(:test)
function recorderRefusedByTheWatchLeavesTheWorkoutAlone(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    var backend = new FakeBackend();
    backend.refuseOpen = true;
    var recorder = new Recorder(rig.session.uuid, backend);
    rig.session.attachRecorder(recorder);
    Test.assert(recorder.isClosed());
    rig.toFirstSet();
    Test.assert(rig.session.confirmSet());
    Test.assertEqual(0, recorder.lapCount());
    return true;
}

(:test)
function recorderUnknownWeightIsPassedOnAsUnknown(logger as Logger) as Boolean {
    var backend = new FakeBackend();
    var recorder = new Recorder("w1", backend);
    recorder.resume();
    recorder.lap(8, null);
    Test.assertEqual(1, recorder.lapCount());
    Test.assertEqual(8, backend.lastReps);
    Test.assert(backend.lastLoad == null);   // not 0
    return true;
}

// The real recording in the simulator: sport, fields and laps are accepted, and it can be thrown away.
(:test)
function fitBackendRecordsInTheSimulator(logger as Logger) as Boolean {
    var recorder = new Recorder("w1", new FitBackend());
    recorder.resume();
    Test.assertMessage(recorder.isRunning(), "recording did not start");
    recorder.lap(8, 60000);
    Test.assertEqual(1, recorder.lapCount());
    // a second lap in the same instant may be refused by the watch; that is no failure of the recorder
    recorder.lap(6, null);
    Test.assert(!recorder.isClosed());
    recorder.pause();
    recorder.resume();
    recorder.discard();
    Test.assert(recorder.isClosed());
    return true;
}

(:test)
function launcherKeepsTheRecordingOfTheSameWorkoutAfterAPause(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    var launcher = new TestLauncher(rig.journal, rig.clock, rig.signals, rig.sender);
    Test.assert(launcher.begin(rig.day));
    var session = launcher.shown[0];
    session.confirmPreview();
    session.confirmSet();
    session.pause();
    Test.assert(launcher.begin(null));           // "Continue" in the same run of the app
    var again = launcher.shown[1];
    Test.assert(!again.uuid.equals("") && again.uuid.equals(session.uuid));
    var first = launcher.recorderFor(session.uuid);
    Test.assert(first.isRunning());
    Test.assertEqual(1, first.lapCount());       // same recording, its lap is still there
    return true;
}

(:test)
function launcherStartsANewRecordingAfterARestart(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    var first = new TestLauncher(rig.journal, rig.clock, rig.signals, rig.sender);
    first.begin(rig.day);
    var session = first.shown[0];
    session.confirmPreview();
    session.confirmSet();
    var crashed = new TestLauncher(rig.journal, rig.clock, rig.signals, rig.sender);   // new run of the app
    Test.assert(crashed.begin(null));
    var recorder = crashed.recorderFor(crashed.shown[0].uuid);
    Test.assert(recorder.isRunning());
    Test.assertEqual(0, recorder.lapCount());    // a new recording for the remaining sets
    return true;
}
