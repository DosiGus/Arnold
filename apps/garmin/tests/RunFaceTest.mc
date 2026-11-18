import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Test;

// Page 1 of the run display as an Instrument face (UHR-03): what it says for each run type and state.
// The face is plain data, so the tests read it; colours: 0x55FF55 in target, 0xFFAA00 only with a word.
// Zones of the rig: 100/120/140/160/180/200, so 130 bpm is zone 2, 140 zone 3, 162 zone 4, 105 zone 1.
(:test)
module FaceRig {
    // A planned heart rate run: 45 minutes, target zone 2.
    function zoneRun(hr as Number or Null) as RunSim {
        var sim = new RunSim(ViewRig.body(1, [ViewRig.seg(1, 1, 2700, 1, 2, 2)] as Array, null), 0, false);
        sim.source.hr = hr;
        return sim;
    }

    // A work/recovery plan of `works` repetitions: 180 s work with a pace target, 120 s recovery.
    function intervals(speed as Number) as RunSim {
        var sim = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 180, 2, 270, 285), ViewRig.seg(2, 1, 120, 0, 0, 0)] as Array, [[0, 1, 6]] as Array), 0, false);
        sim.source.speed = speed;
        return sim;
    }

    function s(value as String or Null) as String {
        return value == null ? "null" : value as String;
    }

    function text(id as ResourceId) as String {
        return HomeScreen.text(id);
    }
}

(:test)
function zoneRunInTargetShowsGreenStatusTimeAndRing(logger as Logger) as Boolean {
    var sim = FaceRig.zoneRun(130);
    sim.seconds(738);                                       // 12:18
    var f = RunFaces.first(sim.session);
    Test.assertMessage(f.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunActualZone), [2])), f.top[0]);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunInTarget).equals(f.status), FaceRig.s(f.status));
    Test.assertEqual(f.statusColor, 0x55FF55);
    Test.assertMessage("130".equals(f.left) && "bpm".equals(f.leftUnit) && "/km".equals(f.rightUnit), f.left + "|" + f.leftUnit);
    Test.assertMessage("5:33".equals(f.right), FaceRig.s(f.right));
    Test.assertEqual(f.leftColor, Graphics.COLOR_WHITE);
    Test.assertMessage(Lang.format(FaceRig.text(Rez.Strings.RunOfTotal), ["12:18", "45:00"]).equals(f.bottom), FaceRig.s(f.bottom));
    Test.assertEqual(f.ring, InstrumentFace.RING_TIME);
    Test.assertEqual(f.timeFrom, 0);
    Test.assertMessage(f.timeLength == 98, "ring " + f.timeLength);       // 738 of 2700 s = 27.3 % of 360 degrees
    return true;
}

(:test)
function zoneRunTooHighAndTooLowSayItInWords(logger as Logger) as Boolean {
    var high = FaceRig.zoneRun(162);
    high.seconds(30);
    var f = RunFaces.first(high.session);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunTooHigh).equals(f.status), FaceRig.s(f.status));
    Test.assertEqual(f.statusColor, 0xFFAA00);
    Test.assertEqual(f.leftColor, 0xFFAA00);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunAlSlower).equals(f.bottom), FaceRig.s(f.bottom));
    Test.assertEqual(f.bottomColor, 0xFFAA00);
    var low = FaceRig.zoneRun(105);
    low.seconds(30);
    var g = RunFaces.first(low.session);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunTooLow).equals(g.status), FaceRig.s(g.status));
    Test.assertEqual(g.leftColor, 0xFFAA00);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunAlFaster).equals(g.bottom), FaceRig.s(g.bottom));
    return true;
}

(:test)
function zoneRunWithoutHeartRateIsHonest(logger as Logger) as Boolean {
    var sim = FaceRig.zoneRun(null);
    sim.seconds(30);
    var f = RunFaces.first(sim.session);
    Test.assertMessage(RunFaces.DASH.equals(f.left), FaceRig.s(f.left));
    Test.assertMessage(f.status == null, "no 'in target' without a heart rate");
    Test.assertEqual(f.leftColor, Graphics.COLOR_WHITE);
    Test.assertEqual(f.bottomColor, Graphics.COLOR_LT_GRAY);
    // the free zone 2 run has no plan: zone 2 is its target, the ring needs a duration and is off
    var free = new RunSim(null, 0, false);
    free.session.mode = PreStartRequest.MODE_ZONE2;
    free.seconds(75);
    var z = RunFaces.first(free.session);
    Test.assertMessage(z.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunActualZone), [2])), z.top[0]);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunTooHigh).equals(z.status), FaceRig.s(z.status));    // 140 bpm is zone 3
    Test.assertEqual(z.ring, InstrumentFace.RING_NONE);
    free.source.hr = 130;
    free.seconds(1);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunInTarget).equals(RunFaces.first(free.session).status), "130 bpm is zone 2");
    return true;
}

(:test)
function intervalWorkShowsRestPaceTargetAndPartialRing(logger as Logger) as Boolean {
    var sim = FaceRig.intervals(360);                       // 3.6 m/s = 4:37 /km, inside 4:30-4:45
    sim.seconds(20);                                        // 20 s into the first work segment
    var f = RunFaces.first(sim.session);
    Test.assertMessage(f.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunNOfM), [RunText.kindName(1), 1, 6])), f.top[0]);
    Test.assertMessage(f.status == null, "intervals have no state in the top line");
    Test.assertMessage("2:40".equals(f.left) && FaceRig.text(Rez.Strings.RunUnitLeft).equals(f.leftUnit), f.left + "|" + f.leftUnit);
    Test.assertMessage("4:37".equals(f.right), FaceRig.s(f.right));
    Test.assertEqual(f.rightColor, 0x55FF55);
    Test.assertMessage(RunFaces.targetShort(2, 270, 285).equals(f.bottom), FaceRig.s(f.bottom));
    Test.assertEqual(f.bottomColor, Graphics.COLOR_LT_GRAY);
    Test.assertEqual(f.ring, InstrumentFace.RING_SEGMENTS);
    Test.assertEqual(f.segments, 6);
    Test.assertEqual(f.done, 0);
    Test.assertMessage(f.part == 111, "part " + f.part);       // 20 of 180 s
    sim.seconds(70);
    Test.assertMessage(RunFaces.first(sim.session).part == 500, "half way: " + RunFaces.first(sim.session).part);
    return true;
}

(:test)
function intervalPaceOutsideTheTargetIsOrangeWithAWord(logger as Logger) as Boolean {
    var slow = FaceRig.intervals(300);                      // 5:33 is slower than 4:30-4:45
    slow.seconds(20);
    var f = RunFaces.first(slow.session);
    Test.assertEqual(f.rightColor, 0xFFAA00);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunAlFaster).equals(f.bottom), FaceRig.s(f.bottom));
    Test.assertEqual(f.bottomColor, 0xFFAA00);
    var fast = FaceRig.intervals(450);                      // 3:42 is faster
    fast.seconds(20);
    var g = RunFaces.first(fast.session);
    Test.assertEqual(g.rightColor, 0xFFAA00);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunAlSlower).equals(g.bottom), FaceRig.s(g.bottom));
    return true;
}

(:test)
function intervalRecoveryCountsTheFinishedWork(logger as Logger) as Boolean {
    var sim = FaceRig.intervals(360);
    sim.seconds(180 + 10);                                  // work 1 is over, 10 s into the recovery
    var f = RunFaces.first(sim.session);
    Test.assertMessage(f.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunNOfM), [RunText.kindName(2), 1, 6])), f.top[0]);
    Test.assertMessage("1:50".equals(f.left), FaceRig.s(f.left));
    Test.assertEqual(f.done, 1);
    Test.assertEqual(f.part, 0);
    Test.assertEqual(f.segments, 6);
    Test.assertEqual(f.rightColor, Graphics.COLOR_WHITE);     // the recovery has no pace target
    Test.assertMessage(Lang.format(FaceRig.text(Rez.Strings.RunHeartLine), ["140"]).equals(f.bottom), FaceRig.s(f.bottom));
    return true;
}

(:test)
function distanceIntervalCountsMetersLeft(logger as Logger) as Boolean {
    var sim = new RunSim(ViewRig.body(7, [ViewRig.seg(1, 2, 400, 3, 160, 175), ViewRig.seg(2, 2, 200, 0, 0, 0)] as Array, [[0, 1, 8]] as Array), 0, false);
    sim.seconds(40);                                        // 3 m/s: 120 m of 400 m
    var f = RunFaces.first(sim.session);
    Test.assertMessage("280".equals(f.left) && "m".equals(f.leftUnit), f.left + "|" + f.leftUnit);
    Test.assertMessage(f.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunNOfM), [RunText.kindName(1), 1, 8])), f.top[0]);
    Test.assertMessage(f.part == 300, "part " + f.part);
    // 140 bpm is under the 160-175 asked: "Schneller", orange
    Test.assertMessage(FaceRig.text(Rez.Strings.RunAlFaster).equals(f.bottom), FaceRig.s(f.bottom));
    Test.assertEqual(f.bottomColor, 0xFFAA00);
    return true;
}

(:test)
function runWalkNamesThePhaseAndCountsTheRuns(logger as Logger) as Boolean {
    var sim = new RunSim(ViewRig.body(11, [ViewRig.seg(1, 1, 60, 0, 0, 0), ViewRig.seg(2, 1, 90, 0, 0, 0)] as Array, [[0, 1, 8]] as Array), 0, false);
    sim.seconds(10);
    var run = RunFaces.first(sim.session);
    Test.assertMessage(run.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunNOfM), [FaceRig.text(Rez.Strings.RunPhaseRun), 1, 8])), run.top[0]);
    Test.assertMessage("0:50".equals(run.left), FaceRig.s(run.left));
    Test.assertEqual(run.segments, 8);
    Test.assertEqual(run.done, 0);
    sim.seconds(60);                                        // 10 s into the walking part of round 1
    var walk = RunFaces.first(sim.session);
    Test.assertMessage(walk.top[0].equals(Lang.format(FaceRig.text(Rez.Strings.RunNOfM), [FaceRig.text(Rez.Strings.RunPhaseWalk), 1, 8])), walk.top[0]);
    Test.assertMessage("1:20".equals(walk.left), FaceRig.s(walk.left));
    Test.assertEqual(walk.done, 1);
    Test.assertEqual(walk.part, 0);
    return true;
}

(:test)
function freeRunShowsTimeAndDistanceWithoutStateOrRing(logger as Logger) as Boolean {
    var sim = new RunSim(null, 0, false);
    sim.seconds(65);                                        // 195 m
    var f = RunFaces.first(sim.session);
    Test.assertMessage(f.top[0].equals(FaceRig.text(Rez.Strings.RunType13)), f.top[0]);
    Test.assertMessage("1:05".equals(f.left), FaceRig.s(f.left));
    Test.assertMessage(RunText.km(19500).equals(f.right) && "km".equals(f.rightUnit), f.right + "|" + f.rightUnit);
    Test.assertMessage(f.status == null, "no state");
    Test.assertEqual(f.ring, InstrumentFace.RING_NONE);
    Test.assertMessage(Lang.format(FaceRig.text(Rez.Strings.RunPace), ["5:33"]).equals(f.bottom), FaceRig.s(f.bottom));
    // on a treadmill the distance is the watch's estimate and says so
    var tread = new RunSim(null, PreStartModel.ENV_TREADMILL, false);
    tread.seconds(10);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunUnitKmEst).equals(RunFaces.first(tread.session).rightUnit), FaceRig.s(RunFaces.first(tread.session).rightUnit));
    return true;
}

(:test)
function pausedAndAutoPauseSayItAndKeepTheValues(logger as Logger) as Boolean {
    var sim = FaceRig.zoneRun(162);
    sim.seconds(30);
    sim.session.pause();
    var f = RunFaces.first(sim.session);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunPaused).equals(f.bottom), FaceRig.s(f.bottom));
    Test.assertEqual(f.bottomColor, 0xFFAA00);
    Test.assertMessage(f.status == null, "no state while paused");
    Test.assertEqual(f.leftColor, Graphics.COLOR_WHITE);
    Test.assertMessage("162".equals(f.left), FaceRig.s(f.left));          // the values stay
    var free = new RunSim(null, 0, true);
    free.source.speed = 0;
    free.seconds(8);
    Test.assertEqual(free.session.state, RunSession.STATE_AUTO_PAUSED);
    var a = RunFaces.first(free.session);
    Test.assertMessage(FaceRig.text(Rez.Strings.RunAutoPaused).equals(a.bottom), FaceRig.s(a.bottom));
    Test.assertEqual(a.bottomColor, 0xFFAA00);
    return true;
}

(:test)
function clockHasNoLeadingZero(logger as Logger) as Boolean {
    Test.assert("0:08".equals(RunFaces.clock(8)) && "12:18".equals(RunFaces.clock(738)) && "1:01:40".equals(RunFaces.clock(3700)));
    Test.assert(RunFaces.DASH.equals(RunFaces.pace(null)) && "5:12".equals(RunFaces.pace(312)));
    return true;
}
