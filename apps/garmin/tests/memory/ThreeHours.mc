import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// The three hours of a run (RUN-015), moved here from RunSessionTest.mc: the memory build runs it with nothing else loaded.
// `peak` is the highest memory in use after a part.

(:test)
class FakeRunBackend extends RunBackend {
    var refuse as Boolean = false;
    var running as Boolean = false;
    var opened as Number = 0;
    var starts as Number = 0;
    var stops as Number = 0;
    var saves as Number = 0;
    var discards as Number = 0;
    var env as Number = -1;
    var lapSegments as Array<Number> = [] as Array<Number>;
    var lapSeconds as Array<Number> = [] as Array<Number>;
    var lapMeters as Array<Number> = [] as Array<Number>;
    var source as ScriptSource or Null = null;

    function initialize() {
        RunBackend.initialize();
    }

    function open(environment as Number) as Boolean {
        if (refuse) {
            return false;
        }
        opened++;
        env = environment;
        running = true;
        return true;
    }

    function lap(segment as Number) as Boolean {
        lapSegments.add(segment);
        if (source != null) {
            lapSeconds.add((source as ScriptSource).timer);
            lapMeters.add((source as ScriptSource).distance / 100);
        }
        return true;
    }

    function start() as Boolean {
        starts++;
        running = true;
        return true;
    }

    function stop() as Boolean {
        stops++;
        running = false;
        return true;
    }

    function save() as Boolean {
        saves++;
        return true;
    }

    function discard() as Boolean {
        discards++;
        return true;
    }
}

// Synthetic readings: one second per read while the recording runs, at the speed the test sets.
(:test)
class ScriptSource extends RunSource {
    var backend as FakeRunBackend;
    var timer as Number = 0;
    var distance as Number = 0;
    var speed as Number = 300;
    var hr as Number or Null = 140;

    function initialize(recording as FakeRunBackend) {
        RunSource.initialize();
        backend = recording;
        recording.source = self;
    }

    function read(into as RunReading) as Void {
        if (backend.running) {
            timer++;
            distance += speed;
        }
        into.timerS = timer;
        into.distanceCm = distance;
        into.speedCmS = speed;
        into.heartRate = hr;
        into.cadence = 170;
        into.ascentM = distance / 10000;
    }
}

(:test)
class RunSim {
    var store as MemoryStore;
    var backend as FakeRunBackend;
    var source as ScriptSource;
    var parts as RunParts;
    var session as RunSession;

    function initialize(body as Dictionary or Null, environment as Number, autoPause as Boolean) {
        store = new MemoryStore();
        var settings = new Settings(store);
        settings.set(Settings.AUTO_PAUSE, autoPause);
        backend = new FakeRunBackend();
        source = new ScriptSource(backend);
        parts = new RunParts(new RunJournal(store), new FakeClock(), settings, source, backend, null,
            [100, 120, 140, 160, 180, 200] as Array<Number>);
        var model = new PreStartModel(new PreStartRequest(body == null ? PreStartRequest.MODE_FREE : PreStartRequest.MODE_PLANNED, body == null ? "" : "run-1", body));
        model.environment = environment;
        session = RunSession.start(model, parts) as RunSession;
    }

    function seconds(n as Number) as Void {
        for (var i = 0; i < n; i++) {
            session.tick();
        }
    }

    // A prescription: segments [kind, duration type, value, 0, 0, 0] and repeats.
    static function prescription(segments as Array, repeats as Array or Null) as Dictionary {
        var body = { "k" => 1, "n" => "T", "e" => 0, "s" => segments } as Dictionary;
        if (repeats != null) {
            body["rp"] = repeats;
        }
        return body;
    }

    static function timed(seconds as Number) as Array {
        return [1, 1, seconds, 0, 0, 0] as Array;
    }

    static function metres(meters as Number) as Array {
        return [1, 2, meters, 0, 0, 0] as Array;
    }

    static function open() as Array {
        return [1, 0, 0, 0, 0, 0] as Array;
    }
}

(:test)
module ThreeHours {
    const PARTS as Number = 1;
    const PART_SECONDS as Number = 10800 / PARTS;
    var rig as RunSim or Null = null;
    var next as Number = 0;
    var peakUsed as Number = 0;
    const LIMIT as Number = 524288;   // memory of a watch app on the smallest device class (fr255, fr255s) by the SDK's device files; the simulator's totalMemory is not that
    var total as Number = 0;
    var baseline as Number = 0;
    // The peak limit of this build is the old 90 % (it was 94 % for a day while the build also carried all other tests): the run
    // is measured alone, so this is what a three-hour run costs. 23.11.2026, MOB-010.
    const PEAK_PERCENT as Number = 90;

    function part(index as Number, logger as Logger) as Boolean {
        if (index == 0) {
            var body = RunSim.prescription([RunSim.timed(60), RunSim.timed(60)] as Array, [[0, 1, 40]] as Array);
            rig = new RunSim(body, 0, true);
            (rig as RunSim).source.speed = 400;
            next = 0;
            baseline = System.getSystemStats().usedMemory;
        }
        Test.assertEqual(next, index);
        var run = rig as RunSim;
        for (var i = 0; i < PART_SECONDS; i++) {
            run.source.hr = 120 + (run.source.timer / 7) % 60;
            run.session.tick();
            if (i % 100 == 99) {
                sample();
            }
        }
        sample();
        next++;
        if (next == PARTS) {
            check(run, logger);
        }
        return true;
    }

    function sample() as Void {
        var stats = System.getSystemStats();
        total = LIMIT;
        if (stats.usedMemory > peakUsed) {
            peakUsed = stats.usedMemory;
        }
    }

    function check(run as RunSim, logger as Logger) as Void {
        logger.debug("3 h: peak memory " + peakUsed + " of " + total + " bytes = " + (peakUsed * 100 / total) + " % (before the run " + baseline + ", the run added " + (peakUsed - baseline) + ")");
        // The test build carries the code of all tests (the watch app is about 45 % smaller: 404 KB against 733 KB of the
        // test file on the fr255), so the run's own growth is what is limited tightly; the whole stays under PEAK_PERCENT.
        Test.assertMessage(peakUsed - baseline < total * 6 / 100, "the run added " + (peakUsed - baseline) + " bytes");
        Test.assertMessage(peakUsed * 100 / total < PEAK_PERCENT, "peak " + peakUsed + " of " + total);
        Test.assertEqual(run.session.calc.timerS, 10800);
        Test.assert(run.session.isPlanDone());
        Test.assertEqual(run.backend.lapSegments.size() >= 80 ? 80 : 0, 80);
        Test.assertEqual(run.session.calc.splitCount, 432);      // 43.2 km at 4 m/s
        Test.assertEqual(run.session.calc.zoneSeconds[0] + run.session.calc.zoneSeconds[1] + run.session.calc.zoneSeconds[2] + run.session.calc.zoneSeconds[3] + run.session.calc.zoneSeconds[4] > 0 ? 1 : 0, 1);
        // the journal at the end still reads
        var head = run.parts.journal.readHead(run.session.uuid) as Dictionary;
        Test.assert(head["t"] as Number >= 10770);
    }
}

(:test)
function threeHoursOfARun(logger as Logger) as Boolean {
    return ThreeHours.part(0, logger);
}
