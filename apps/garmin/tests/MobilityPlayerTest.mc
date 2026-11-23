import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// MOB-009: the mobility player (time, transitions, pause, skip, end), the recording and the result.
// Kept short like MobilityTest.mc: the test build of the fr255 may use 90 % of the memory (RunSessionTest.mc).

// A routine on a fake clock, fake recording and recording signals. Each exercise: [sides, seconds per side, reps or null].
(:test)
class MobPlayRig {
    var clock as FakeClock;
    var backend as FakeBackend;
    var signals as RunPatternSignals;
    var store as MemoryStore;
    var player as MobilityPlayer;

    function initialize(specs as Array) {
        clock = new FakeClock();
        clock.now = 1700000000;   // 2023-11-14 22:13:20 UTC
        backend = new FakeBackend();
        store = new MemoryStore();
        signals = new RunPatternSignals(store);
        var all = [] as Array;
        for (var i = 0; i < specs.size(); i++) {
            var spec = specs[i] as Array;
            var ex = { "c" => "mob_cat_cow", "n" => "Übung " + i, "h" => "Ruhig atmen", "s" => spec[0], "t" => spec[1], "r" => spec[2] };
            all.add(ex);
        }
        var routine = { "id" => "s_1", "tot" => 600, "ex" => all };
        player = new MobilityPlayer("s_1", "session", routine, clock, new MobilitySignals(signals, new Settings(store)), new Recorder("u1", backend));
        player.begin();
    }

    // The clock runs for this many seconds, one tick each.
    function go(seconds as Number) as Void {
        for (var i = 0; i < seconds; i++) {
            clock.now++;
            player.tick();
        }
    }

    function phase() as Number {
        return player.phase;
    }

    function statuses() as String {
        var out = "";
        var all = player.result()["ex"] as Array;
        for (var i = 0; i < all.size(); i++) {
            out += ((all[i] as Dictionary)["st"] as String) + ":" + ((all[i] as Dictionary)["t"] as Number) + " ";
        }
        return out;
    }
}

(:test)
function sidesAndTransitionsRunOnTheClock(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[2, 10, null], [1, 6, null]] as Array);
    var p = rig.player;
    Test.assert(p.phase == MobilityPlayer.PH_NEXT && p.remain == 5 && p.exIdx == 0);   // 5 s before the first exercise
    rig.go(4);
    Test.assert(p.phase == MobilityPlayer.PH_NEXT && p.remain == 1);
    rig.go(1);
    Test.assert(p.phase == MobilityPlayer.PH_SIDE && p.remain == 10 && p.side == 0);
    rig.go(10);
    Test.assert(p.phase == MobilityPlayer.PH_SWITCH && p.remain == 3);                // 3 s to change the side
    rig.go(3);
    Test.assert(p.phase == MobilityPlayer.PH_SIDE && p.remain == 10 && p.side == 1);
    rig.go(10);
    Test.assert(p.phase == MobilityPlayer.PH_NEXT && p.exIdx == 1 && p.remain == 5);  // 5 s, then the next exercise
    rig.go(5 + 6);
    Test.assert(p.phase == MobilityPlayer.PH_END && !p.endedEarly);
    Expect.equal(rig.statuses(), "done:20 done:6 ");
    Expect.equal(p.timerSeconds(), 26);
    Expect.equal(p.elapsedSeconds(), 5 + 10 + 3 + 10 + 5 + 6);
    // buzz: next (the first one), side, next, end (long, loud)
    Test.assert(Same.numbers(rig.signals.patterns, [MobilitySignals.NEXT, MobilitySignals.SIDE, MobilitySignals.NEXT, MobilitySignals.FINISHED] as Array<Number>));
    Test.assert(Same.numbers(rig.signals.lengths, [3, 1, 3, 1] as Array<Number>));   // double, short, double, one long
    return true;
}

(:test)
function aLateTickDoesNotLoseTimeAndAPauseFreezesIt(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[1, 10, null]] as Array);
    var p = rig.player;
    rig.go(5 + 3);
    Expect.equal(p.remain, 7);
    rig.clock.now += 3;   // the timer came late
    p.tick();
    Expect.equal(p.remain, 4);
    p.toggle();           // START: pause
    Test.assert(p.isPaused());
    rig.go(30);
    Expect.equal(p.remain, 4);
    Expect.equal(p.elapsedSeconds(), 5 + 6);
    p.toggle();           // START: on
    rig.go(2);
    Expect.equal(p.remain, 2);
    Expect.equal(rig.backend.count("stop"), 1);   // the recording stood still in the pause
    Expect.equal(rig.backend.count("start"), 1);
    return true;
}

(:test)
function skipMarksTheExerciseSkippedAndGoesOn(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[1, 10, null], [1, 10, null], [1, 10, null]] as Array);
    var p = rig.player;
    rig.go(5 + 4);
    p.skip();             // DOWN while the first runs: skipped after 4 s
    Test.assert(p.phase == MobilityPlayer.PH_NEXT && p.exIdx == 1 && p.remain == 5);
    p.skip();             // DOWN while the second is announced: skipped without time
    Test.assert(p.exIdx == 2);
    rig.go(5);
    p.skip();             // the last one: the routine ends, not early
    Test.assert(p.phase == MobilityPlayer.PH_END && !p.endedEarly);
    Expect.equal(rig.statuses(), "skipped:4 skipped:0 skipped:0 ");
    Expect.equal(rig.backend.count("lap"), 1);    // only the exercise that ran for some time
    Test.assert(rig.signals.patterns[rig.signals.patterns.size() - 1] == MobilitySignals.FINISHED);
    return true;
}

(:test)
function backEndsTheRoutineEarlyAndTheRunningExerciseIsPartial(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[1, 10, null], [2, 10, null], [1, 10, null]] as Array);
    var p = rig.player;
    rig.go(5 + 10 + 5 + 4);
    p.endEarly();         // BACK, yes: in the first side of the second exercise
    Test.assert(p.phase == MobilityPlayer.PH_END && p.endedEarly);
    Expect.equal(rig.statuses(), "done:10 partial:4 ");   // the third was not reached
    Test.assert(p.canSave());
    Expect.equal(rig.backend.count("lap"), 2);
    Test.assert(rig.signals.patterns[rig.signals.patterns.size() - 1] != MobilitySignals.FINISHED);
    // before anything was done there is nothing to save
    var none = new MobPlayRig([[1, 10, null]] as Array);
    none.go(2);
    none.player.endEarly();
    Test.assert(none.player.phase == MobilityPlayer.PH_END && !none.player.canSave());
    return true;
}

(:test)
function savedResultHasTheFieldsOfTheWatchRequest(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[1, 10, null], [1, 8, 12]] as Array);
    rig.clock.offsetMinutes = 120;
    rig.player.begin();   // the offset is read when the routine begins
    var p = rig.player;
    rig.go(5 + 10 + 5 + 3);
    p.endEarly();
    Test.assert(p.save(rig.store));
    Test.assert(!p.save(rig.store));              // once
    Expect.equal(rig.backend.count("save"), 1);
    var saved = rig.store.getValue(MobilityPlayer.LAST_KEY) as Dictionary;
    Expect.field(saved, "kind", "session");
    Expect.field(saved, "session_id", "s_1");
    Test.assert(Uuid.isV4(saved["session_uuid"] as String));
    Expect.field(saved, "started_at_utc", "2023-11-14T22:13:20Z");
    Expect.field(saved, "ended_at_utc", "2023-11-14T22:13:43Z");
    Expect.field(saved, "workout_date_local", "2023-11-15");   // 22:13 UTC is already the next day at +02:00
    Expect.field(saved, "utc_offset_min", 120);
    Expect.field(saved, "timer_s", 13);
    Expect.field(saved, "elapsed_s", 23);
    Expect.field(saved, "ended_early", true);
    var ex = saved["ex"] as Array;
    Expect.equal(ex.size(), 2);
    var second = ex[1] as Dictionary;
    Expect.equal(second.size(), 3);               // c, st, t and nothing else
    Expect.field(second, "c", "mob_cat_cow");
    Expect.field(second, "st", "partial");
    Expect.field(second, "t", 3);
    // thrown away instead: no result, the recording is dropped
    var other = new MobPlayRig([[1, 10, null]] as Array);
    other.go(5 + 10);
    other.player.discard();
    Expect.equal(other.backend.count("discard"), 1);
    Test.assert(other.store.getValue(MobilityPlayer.LAST_KEY) == null);
    return true;
}

(:test)
function theRecordingIsFlexibilityTrainingWithALapForEachExercise(logger as Logger) as Boolean {
    var options = new MobilityBackend().sessionOptions();
    Expect.equal(options[:sport] as Number, 10);       // Activity.SPORT_TRAINING
    Expect.equal(options[:subSport] as Number, 19);    // Activity.SUB_SPORT_FLEXIBILITY_TRAINING
    Expect.equal(options[:name] as String, "Arnold Mobility");
    var rig = new MobPlayRig([[2, 5, null], [1, 5, null], [1, 5, null]] as Array);
    rig.go(5 + 5 + 3 + 5 + 5 + 5 + 5 + 5);
    Test.assert(rig.player.phase == MobilityPlayer.PH_END);
    Expect.equal(rig.backend.count("open"), 1);
    Expect.equal(rig.backend.count("lap"), 3);         // one lap for each exercise
    Test.assert(rig.backend.calls[rig.backend.calls.size() - 1].equals("stop"));   // the timer stands still on the summary
    return true;
}

(:test)
function signalsFollowTheSwitchesOfTheSettings(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[2, 5, null]] as Array);
    Test.assert(rig.signals.vibrated[0] && rig.signals.toned[0]);   // on by default
    var settings = new Settings(rig.store);
    settings.set(Settings.VIBRATION, false);
    rig.go(5 + 5);        // the side switch
    Test.assert(!rig.signals.vibrated[1] && rig.signals.toned[1]);
    settings.set(Settings.VIBRATION, true);
    settings.set(Settings.TONE, false);
    rig.go(3 + 5);        // the end
    Expect.equal(rig.signals.patterns.size(), 3);
    Test.assert(rig.signals.vibrated[2] && !rig.signals.toned[2]);
    return true;
}

(:test)
function theFaceShowsNameSideCountdownAndARingThatRunsDown(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[2, 10, null], [1, 20, 12]] as Array);
    var p = rig.player;
    var next = MobilityScreen.face(p);                   // 5 s before the first exercise
    Expect.equal(next.hero, "5");
    Expect.equal(next.sub, "Übung 0");
    Expect.equal(next.timeLength, 360);
    rig.go(3);
    Expect.equal(MobilityScreen.face(p).timeLength, 144);   // 2 of 5 s left
    Expect.equal(MobilityScreen.face(p).timeFrom, 216);
    rig.go(2 + 4);
    var side = MobilityScreen.face(p);
    Expect.equal(side.hero, "0:06");
    Expect.equal(side.top[0], "Übung 0");
    Expect.equal(side.sub, TrainingText.sideText(PlannedSet.SIDE_LEFT));
    Expect.equal(side.bottom, "Ruhig atmen");
    Expect.equal(side.timeLength, 216);                  // 6 of 10 s
    rig.go(6 + 3 + 4);
    Expect.equal(MobilityScreen.face(p).sub, TrainingText.sideText(PlannedSet.SIDE_RIGHT));
    rig.go(6 + 5 + 5);                                   // the second exercise: repetitions with the ring over the time
    var reps = MobilityScreen.face(p);
    Expect.equal(reps.hero, "12");
    Expect.equal(reps.sub, TrainingText.text(Rez.Strings.TrRepsUnit));
    Expect.equal(reps.timeLength, 270);                  // 15 of 20 s
    p.toggle();
    var paused = MobilityScreen.face(p);
    Expect.equal(paused.bottom, MobilityPreviewScreen.text(Rez.Strings.MobPaused));
    Expect.equal(paused.heroColor, Instrument.LABEL);
    return true;
}

(:test)
function aThirtyMinuteRoutineLeavesNothingBehindAndRedrawsAreFree(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var specs = [] as Array;
    for (var i = 0; i < 15; i++) {
        specs.add([2, 60, null] as Array);   // 15 exercises, two sides of a minute: 30 minutes of movement
    }
    var baseline = System.getSystemStats().usedMemory;
    var rig = new MobPlayRig(specs);
    var view = new MobilityView(rig.player);
    var peak = 0;
    for (var s = 0; s < 1800 + 15 * 8 + 1; s++) {
        rig.go(1);
        if (s % 100 == 99) {
            view.onUpdate(dc);
            peak = System.getSystemStats().usedMemory > peak ? System.getSystemStats().usedMemory : peak;
        }
    }
    Test.assert(rig.player.phase == MobilityPlayer.PH_END);
    Expect.equal(rig.player.countOf("done"), 15);
    Test.assert(rig.player.save(rig.store));
    var limit = ThreeHours.LIMIT;
    logger.debug("30 min: peak " + peak + " of " + limit + " (before " + baseline + ")");
    Test.assertMessage(peak - baseline < limit * 6 / 100, "grew by " + (peak - baseline));
    Test.assertMessage(peak * 100 / limit < ThreeHours.PEAK_PERCENT, "peak " + peak);
    // 300 redraws while the routine would run: the memory stays flat
    var again = new MobPlayRig([[2, 600, null]] as Array);
    var live = new MobilityView(again.player);
    for (var warm = 0; warm < 5; warm++) {
        live.onUpdate(dc);
    }
    var before = System.getSystemStats().usedMemory;
    for (var i = 0; i < 300; i++) {
        again.go(1);
        live.onUpdate(dc);
    }
    var after = System.getSystemStats().usedMemory;
    Test.assertMessage(after - before < 600, "memory grew by " + (after - before));
    return true;
}
