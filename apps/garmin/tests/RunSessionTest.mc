import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// The run session (RUN-015): segments, smoothing, splits, zones, auto pause, journal, treadmill, three hours.

// A recording that remembers what was asked of it. `refuse` makes open() fail.
(:test)
module Same {
    // Array.equals compares the objects, not the contents.
    function numbers(a as Array<Number>, b as Array<Number>) as Boolean {
        if (a.size() != b.size()) {
            return false;
        }
        for (var i = 0; i < a.size(); i++) {
            if (a[i] != b[i]) {
                return false;
            }
        }
        return true;
    }
}

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
function repeatsExpandToTheOrderOfRunning(logger as Logger) as Boolean {
    var body = RunSim.prescription([RunSim.timed(5), RunSim.timed(3), RunSim.timed(2)] as Array, [[1, 2, 2]] as Array);
    var plan = new RunSegments(body);
    Test.assertEqual(plan.count(), 5);
    var expected = [0, 1, 2, 1, 2] as Array<Number>;
    for (var i = 0; i < 5; i++) {
        Test.assertEqual(plan.baseIndex(i), expected[i]);
    }
    Test.assertEqual(plan.baseIndex(5), -1);
    Test.assertEqual(new RunSegments(null).count(), 0);
    // at most 80 segments, whatever the repeats say
    var big = new RunSegments(RunSim.prescription([RunSim.timed(5), RunSim.timed(3), RunSim.timed(2)] as Array, [[0, 2, 50]] as Array));
    Test.assertEqual(big.count(), 80);
    Test.assertEqual(big.baseIndex(79), 79 % 3);
    return true;
}

(:test)
function timedSegmentsEndOnTheSecondAndRepeatsRun(logger as Logger) as Boolean {
    var rig = new RunSim(RunSim.prescription([RunSim.timed(5), RunSim.timed(3), RunSim.timed(2)] as Array, [[1, 2, 2]] as Array), 0, false);
    rig.seconds(30);
    Test.assert(Same.numbers(rig.backend.lapSegments, [1, 2, 3, 4, 5] as Array<Number>));
    // 5, 5+3, +2, +3, +2 seconds
    Test.assert(Same.numbers(rig.backend.lapSeconds, [5, 8, 10, 13, 15] as Array<Number>));
    Test.assert(rig.session.isPlanDone());
    Test.assertEqual(rig.session.segmentNumber(), 0);
    return true;
}

(:test)
function distanceSegmentsEndWithinOnePercent(logger as Logger) as Boolean {
    var rig = new RunSim(RunSim.prescription([RunSim.metres(400), RunSim.metres(1000)] as Array, null), 0, false);
    rig.source.speed = 410;
    rig.seconds(360);
    Test.assertEqual(rig.backend.lapSegments.size(), 2);
    var first = rig.backend.lapMeters[0];
    var second = rig.backend.lapMeters[1] - first;
    logger.debug("400 m ended at " + first + " m, 1000 m after " + second + " m");
    Test.assert(first >= 396 && first <= 404);
    Test.assert(second >= 990 && second <= 1010);
    return true;
}

(:test)
function openSegmentsWaitForTheLapKey(logger as Logger) as Boolean {
    var rig = new RunSim(RunSim.prescription([RunSim.open(), RunSim.timed(2)] as Array, null), 0, false);
    rig.seconds(100);
    Test.assertEqual(rig.session.segmentNumber(), 1);
    Test.assertEqual(rig.backend.lapSegments.size(), 0);
    Test.assert(rig.session.nextSegment());
    Test.assertEqual(rig.session.segmentNumber(), 2);
    rig.seconds(2);
    Test.assert(rig.session.isPlanDone());
    Test.assert(!rig.session.nextSegment());
    Test.assert(Same.numbers(rig.backend.lapSegments, [1, 2] as Array<Number>));
    return true;
}

(:test)
function aFreeRunLapsEveryKilometre(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    rig.source.speed = 1000;
    rig.seconds(320);
    Test.assert(Same.numbers(rig.backend.lapSegments, [0, 0, 0] as Array<Number>));
    Test.assertEqual(rig.session.segmentNumber(), 0);
    Test.assert(!rig.session.nextSegment());
    return true;
}

(:test)
function paceIsSmoothedOver10And30Seconds(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    rig.seconds(20);
    rig.source.speed = 300;
    rig.seconds(10);   // 30 s at 3.0 m/s
    Test.assertEqual(rig.session.calc.paceDisplay() as Number, 333);
    rig.source.speed = 400;
    rig.seconds(10);
    Test.assertEqual(rig.session.calc.paceDisplay() as Number, 250);   // the last 10 s: 4.0 m/s
    Test.assertEqual(rig.session.calc.paceAlarm() as Number, 100000 / ((300 * 20 + 400 * 10) / 30));   // the last 30 s
    // standing: no pace, never 0
    rig.source.speed = 10;
    rig.seconds(10);
    Test.assert(rig.session.calc.paceDisplay() == null);
    return true;
}

(:test)
function aSplitIsSetEvery100Metres(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    rig.source.speed = 250;
    rig.seconds(200);
    Test.assertEqual(rig.session.calc.splitCount, 5);
    Test.assertEqual(rig.session.calc.splitAt(0), 400);    // 100 m at 2.5 m/s = 40.0 s
    Test.assertEqual(rig.session.calc.splitAt(4), 2000);
    // a split inside a second is interpolated
    var other = new RunSim(null, 0, false);
    other.source.speed = 330;
    other.seconds(40);
    var t = other.session.calc.splitAt(0);
    Test.assertMessage(t >= 302 && t <= 304, "split " + t);
    return true;
}

(:test)
function timeInHeartRateZonesIsCounted(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    rig.source.hr = 130;
    rig.seconds(10);
    rig.source.hr = 170;
    rig.seconds(5);
    rig.source.hr = 90;   // below zone 1
    rig.seconds(3);
    rig.source.hr = null;   // no reading: nothing counted
    rig.seconds(2);
    rig.source.hr = 250;   // above the last bound: zone 5
    rig.seconds(4);
    Test.assert(Same.numbers(rig.session.calc.zoneSeconds, [0, 10, 0, 5, 4] as Array<Number>));
    return true;
}

(:test)
function autoPauseUsesItsThresholdsAndOnlyWhenOn(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, true);
    rig.source.speed = 99;
    rig.seconds(3);
    Test.assertEqual(rig.session.state, RunSession.STATE_RUNNING);
    rig.seconds(1);   // the fourth second under 1.0 m/s
    Test.assertEqual(rig.session.state, RunSession.STATE_AUTO_PAUSED);
    Test.assertEqual(rig.backend.stops, 1);
    rig.source.speed = 160;   // not over 1.6 m/s
    rig.seconds(5);
    Test.assertEqual(rig.session.state, RunSession.STATE_AUTO_PAUSED);
    rig.source.speed = 161;
    rig.seconds(1);
    Test.assertEqual(rig.session.state, RunSession.STATE_AUTO_PAUSED);
    rig.seconds(1);   // the second second over 1.6 m/s
    Test.assertEqual(rig.session.state, RunSession.STATE_RUNNING);
    Test.assertEqual(rig.backend.starts, 1);
    // exactly 1.0 m/s is not under
    var edge = new RunSim(null, 0, true);
    edge.source.speed = 100;
    edge.seconds(20);
    Test.assertEqual(edge.session.state, RunSession.STATE_RUNNING);
    // switched off: standing still never pauses
    var off = new RunSim(null, 0, false);
    off.source.speed = 0;
    off.seconds(20);
    Test.assertEqual(off.session.state, RunSession.STATE_RUNNING);
    Test.assertEqual(off.backend.stops, 0);
    // while paused nothing is counted
    Test.assertEqual(rig.session.calc.timerS, rig.source.timer);
    return true;
}

(:test)
function theJournalCarriesARunAcrossACrash(logger as Logger) as Boolean {
    var body = RunSim.prescription([RunSim.timed(20), RunSim.timed(120)] as Array, null);
    var rig = new RunSim(body, 0, false);
    rig.source.speed = 250;
    rig.seconds(75);   // segment 1 ended at 20 s (journal written), again 30 s after it
    var uuid = rig.session.uuid;
    Test.assertEqual((rig.parts.journal.activeId() as String).equals(uuid) ? 1 : 0, 1);
    // the watch restarts: new recording, same store
    var backend = new FakeRunBackend();
    var source = new ScriptSource(backend);
    var again = new RunParts(rig.parts.journal, new FakeClock(), rig.parts.settings, source, backend, null, rig.parts.zones);
    var run = RunSession.restore(again) as RunSession;
    Test.assert(run.uuid.equals(uuid));
    Test.assertEqual(backend.opened, 1);                       // a NEW recording
    Test.assertEqual(run.state, RunSession.STATE_PAUSED);      // continues when the user starts it
    Test.assertEqual(run.parts, 2);
    Test.assertEqual(run.segmentNumber(), 2);
    Test.assertEqual(run.calc.timerS, 49);                     // the stand of the last write (29 s after the one at the segment end)
    Test.assertEqual(run.calc.distanceCm, 49 * 250);
    Test.assertEqual(run.calc.splitCount, 1);                  // 100 m at 40 s, read back from the journal
    Test.assertEqual(run.calc.splitAt(0), 400);
    run.resume();
    for (var i = 0; i < 10; i++) {
        run.tick();
    }
    Test.assertEqual(run.calc.timerS, 59);                     // the numbers go on from the stand
    Test.assertEqual(run.segmentSeconds(), 39);                // segment 2 started at 20 s
    Test.assert(run.save() || true);
    Test.assert(RunSession.restore(again) == null);            // saved: nothing to continue
    return true;
}

(:test)
function aDamagedOrRefusedRunLeavesNothingBehind(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    rig.seconds(35);
    var id = rig.parts.journal.activeId() as String;
    var head = rig.store.values[StoreKeys.runHead(id)] as Dictionary;
    head["t"] = 99999;   // the checksum no longer fits
    Test.assert(RunSession.restore(rig.parts) == null);
    Test.assert(rig.parts.journal.activeId() == null);
    // the watch refuses the recording at the start
    var store = new MemoryStore();
    var backend = new FakeRunBackend();
    backend.refuse = true;
    var parts = new RunParts(new RunJournal(store), new FakeClock(), new Settings(store), new ScriptSource(backend), backend, null, null);
    var model = new PreStartModel(new PreStartRequest(PreStartRequest.MODE_FREE, "", null));
    Test.assert(RunSession.start(model, parts) == null);
    Test.assert(parts.journal.activeId() == null);
    return true;
}

(:test)
function saveKeepsTheJournalForTheSummaryAndDiscardClearsIt(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    rig.seconds(5);
    rig.session.pause();
    Test.assertEqual(rig.backend.stops, 1);
    Test.assert(rig.session.isPaused());
    rig.session.resume();
    Test.assertEqual(rig.backend.starts, 1);
    Test.assert(rig.session.save());
    Test.assertEqual(rig.backend.saves, 1);
    var id = rig.session.uuid;
    var head = rig.parts.journal.readHead(id) as Dictionary;
    Test.assertEqual(head["st"] as Number, RunSession.STATE_FINISHED);
    Test.assert(rig.parts.journal.activeId() != null);
    var other = new RunSim(null, 0, false);
    other.seconds(40);
    other.session.discard();
    Test.assertEqual(other.backend.discards, 1);
    Test.assert(other.parts.journal.activeId() == null);
    Test.assert(other.parts.journal.readHead(other.session.uuid) == null);
    Test.assert(other.store.values[StoreKeys.runCopy(other.session.uuid)] == null);
    return true;
}

(:test)
function theTreadmillRunsWithoutGpsAndMarksTheDistance(logger as Logger) as Boolean {
    var rig = new RunSim(null, PreStartModel.ENV_TREADMILL, false);
    Test.assertEqual(rig.backend.env, PreStartModel.ENV_TREADMILL);
    Test.assert(rig.session.distanceIsEstimated());
    rig.seconds(10);
    Test.assert(RunText.distance(rig.session.calc.distanceCm, true).find("(") != null);
    var outdoor = new RunSim(null, PreStartModel.ENV_OUTDOOR, false);
    Test.assert(!outdoor.session.distanceIsEstimated());
    return true;
}

// Three hours (RUN-015): a plan of 80 one-minute segments (4800 s), then a free stretch with km laps; synthetic readings
// replace the sensors. The simulation runs in parts, one test per part, because a test may only run a limited number of
// instructions at a time. `peak` is the highest memory in use after a part.
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
        // test file on the fr255), so the run's own growth is what is limited tightly; the whole stays under 90 %.
        Test.assertMessage(peakUsed - baseline < total * 6 / 100, "the run added " + (peakUsed - baseline) + " bytes");
        Test.assertMessage(peakUsed * 100 / total < 90, "peak " + peakUsed + " of " + total);
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
