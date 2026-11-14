import Toybox.Lang;
import Toybox.Test;

// The alarm rules of a run and their signals (RUN-017): heart rate high and low, pace, countdown and change,
// kilometre, drinking, no sensor, switches and muting.

// Steps the pure rules second by second and writes down every event with the second it came in.
(:test)
class AlertRig {
    var alerts as RunAlerts;
    var input as RunAlertInput;
    var t as Number = 0;                       // seconds stepped
    var cmPerSecond as Number = 0;
    var types as Array<Number> = [] as Array<Number>;
    var times as Array<Number> = [] as Array<Number>;
    var last as RunAlertEvent or Null = null;

    function initialize(prescription as Dictionary or Null, zones as Array<Number> or Null) {
        alerts = new RunAlerts(new RunAlertParams(prescription, zones));
        input = new RunAlertInput();
        input.kind = 1;
        input.heartRate = 120;                 // a sensor that is there and well under every bound
    }

    // A work segment with a heart rate target in bpm.
    function bpm(low as Number, high as Number) as AlertRig {
        input.targetType = 3;
        input.targetLow = low;
        input.targetHigh = high;
        return self;
    }

    // A work segment with a pace band in s/km.
    function paceBand(fast as Number, slow as Number, durationType as Number, value as Number) as AlertRig {
        input.targetType = 2;
        input.targetLow = fast;
        input.targetHigh = slow;
        input.durationType = durationType;
        input.durationValue = value;
        return self;
    }

    // One second.
    function step() as Void {
        t++;
        input.timerS++;
        input.segmentSeconds++;
        input.distanceCm += cmPerSecond;
        input.segmentCm += cmPerSecond;
        record();
    }

    // One second where the clock is set by the test.
    function stepAt(timer as Number) as Void {
        t++;
        input.timerS = timer;
        record();
    }

    hidden function record() as Void {
        var n = alerts.update(input);
        for (var i = 0; i < n; i++) {
            var event = alerts.eventAt(i);
            types.add(event.type);
            times.add(t);
            last = event;
        }
    }

    function run(seconds as Number) as Void {
        for (var i = 0; i < seconds; i++) {
            step();
        }
    }

    function count(type as Number) as Number {
        var n = 0;
        for (var i = 0; i < types.size(); i++) {
            if (types[i] == type) {
                n++;
            }
        }
        return n;
    }

    // The second the n-th (0 based) event of this type came in, -1 if there was none.
    function at(type as Number, n as Number) as Number {
        var seen = 0;
        for (var i = 0; i < types.size(); i++) {
            if (types[i] == type) {
                if (seen == n) {
                    return times[i];
                }
                seen++;
            }
        }
        return -1;
    }

    // Past the run-in time, so only the dwell time counts.
    function pastRunIn() as AlertRig {
        input.timerS = 1000;
        return self;
    }
}

(:test)
function defaultsApplyOnlyWhereThePrescriptionIsSilent(logger as Logger) as Boolean {
    var free = new RunAlertParams(null, null);
    Test.assertEqual(free.hi.dwellS, 20);
    Test.assertEqual(free.hi.warmupS, 0);              // a free run is not a continuous run with a target
    Test.assertEqual(free.hi.lockS, 60);
    Test.assertEqual(free.lo.dwellS, 30);
    Test.assertEqual(free.pace.dwellS, 15);
    Test.assertEqual(free.pace.warmupS, 20);
    Test.assertEqual(free.drinkEveryMin, 0);
    var base = new RunAlertParams({ "k" => 1, "s" => [] } as Dictionary, null);
    Test.assertEqual(base.hi.warmupS, 300);            // 5 min run-in of a continuous run
    var interval = new RunAlertParams({ "k" => 6, "s" => [] } as Dictionary, null);
    Test.assertEqual(interval.hi.warmupS, 0);
    var long = new RunAlertParams({ "k" => 2, "s" => [] } as Dictionary, null);
    Test.assertEqual(long.drinkFromMin, 60);
    Test.assertEqual(long.drinkEveryMin, 30);
    var given = new RunAlertParams({ "k" => 1, "a" => { "hi" => [40, 5, 120, 90] } as Dictionary, "dr" => [30, 10] as Array } as Dictionary, null);
    Test.assertEqual(given.hi.dwellS, 40);
    Test.assertEqual(given.hi.tolerance, 5);
    Test.assertEqual(given.hi.warmupS, 120);
    Test.assertEqual(given.hi.lockS, 90);
    Test.assertEqual(given.lo.dwellS, 30);             // the alarm the prescription does not name keeps its defaults
    Test.assertEqual(given.drinkFromMin, 30);
    Test.assertEqual(given.drinkEveryMin, 10);
    // damaged values do not count
    var broken = new RunAlertParams({ "k" => 1, "a" => { "hi" => [40, 5] } as Dictionary, "dr" => "x" } as Dictionary, null);
    Test.assertEqual(broken.hi.dwellS, 20);
    Test.assertEqual(broken.drinkEveryMin, 0);
    return true;
}

(:test)
function heartRateTooHighFiresAfterTheDwellTime(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    rig.input.heartRate = 151;
    rig.run(19);
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH), 0);
    rig.step();
    Test.assertEqual(rig.at(RunAlertEvent.HR_HIGH, 0), 20);
    // exactly on the bound is not over it
    var edge = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    edge.input.heartRate = 150;
    edge.run(120);
    Test.assertEqual(edge.count(RunAlertEvent.HR_HIGH), 0);
    // a dip under the bound before the dwell time starts the count again
    var dip = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    dip.input.heartRate = 160;
    dip.run(19);
    dip.input.heartRate = 150;
    dip.step();
    dip.input.heartRate = 160;
    dip.run(19);
    Test.assertEqual(dip.count(RunAlertEvent.HR_HIGH), 0);
    dip.step();
    Test.assertEqual(dip.at(RunAlertEvent.HR_HIGH, 0), 40);
    return true;
}

(:test)
function heartRateToleranceAndZoneTargetsSetTheBound(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 1, "a" => { "hi" => [20, 5, 0, 60] } as Dictionary } as Dictionary, null).bpm(140, 150).pastRunIn();
    rig.input.heartRate = 155;                         // inside 150 + 5
    rig.run(60);
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH), 0);
    rig.input.heartRate = 156;
    rig.run(20);
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH), 1);
    // zones 2 to 3 end where zone 4 starts (the fourth bound)
    var zones = [100, 120, 140, 160, 180, 200] as Array<Number>;
    var zone = new AlertRig({ "k" => 1 } as Dictionary, zones).pastRunIn();
    zone.input.targetType = 1;
    zone.input.targetLow = 2;
    zone.input.targetHigh = 3;
    zone.input.heartRate = 160;
    zone.run(60);
    Test.assertEqual(zone.count(RunAlertEvent.HR_HIGH), 0);
    zone.input.heartRate = 161;
    zone.run(20);
    Test.assertEqual(zone.count(RunAlertEvent.HR_HIGH), 1);
    // no zones of the watch, no target, no bound: no alarm
    var none = new AlertRig({ "k" => 1 } as Dictionary, null).pastRunIn();
    none.input.targetType = 1;
    none.input.targetLow = 2;
    none.input.targetHigh = 3;
    none.input.heartRate = 220;
    none.run(120);
    var free = new AlertRig(null, null).pastRunIn();
    free.input.heartRate = 220;
    free.run(120);
    Test.assertEqual(none.count(RunAlertEvent.HR_HIGH) + free.count(RunAlertEvent.HR_HIGH), 0);
    return true;
}

(:test)
function heartRateTooHighIsSilentInTheRunInTimeAndInWarmUp(logger as Logger) as Boolean {
    // base run: the first 5 minutes are silent, the count starts when they are over
    var rig = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150);
    rig.input.heartRate = 175;
    rig.run(299);
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH), 0);
    rig.run(19);                                       // timer 300 .. 318: 19 seconds over
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH), 0);
    rig.step();
    Test.assertEqual(rig.at(RunAlertEvent.HR_HIGH, 0), 319);
    // a warm-up segment never alarms, however long and high
    var warm = new AlertRig({ "k" => 6 } as Dictionary, null).bpm(140, 150).pastRunIn();
    warm.input.kind = 0;
    warm.input.heartRate = 190;
    warm.run(900);
    Test.assertEqual(warm.count(RunAlertEvent.HR_HIGH), 0);
    // the segment after it counts from its own start
    warm.input.kind = 1;
    warm.input.ordinal = 1;
    warm.input.segmentSeconds = 0;
    warm.run(20);
    Test.assertEqual(warm.count(RunAlertEvent.HR_HIGH), 1);
    // the prescription's own run-in time wins over the default
    var own = new AlertRig({ "k" => 1, "a" => { "hi" => [20, 0, 60, 60] } as Dictionary } as Dictionary, null).bpm(140, 150);
    own.input.heartRate = 175;
    own.run(78);
    Test.assertEqual(own.count(RunAlertEvent.HR_HIGH), 0);
    own.step();
    Test.assertEqual(own.at(RunAlertEvent.HR_HIGH, 0), 79);   // silent until 60 s, then 20 s
    return true;
}

(:test)
function heartRateTooHighRepeatsAfterTheLockAndEndsThreeBeatsUnder(logger as Logger) as Boolean {
    // staying over the bound: 20, then every 60 s
    var rig = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    rig.input.heartRate = 160;
    rig.run(150);
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH), 3);
    Test.assertEqual(rig.at(RunAlertEvent.HR_HIGH, 0), 20);
    Test.assertEqual(rig.at(RunAlertEvent.HR_HIGH, 1), 80);
    Test.assertEqual(rig.at(RunAlertEvent.HR_HIGH, 2), 140);
    // 2 beats under the bound is not "down again": back over, the alarm is due as soon as the lock is over
    var shallow = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    shallow.input.heartRate = 160;
    shallow.run(20);
    shallow.input.heartRate = 148;
    shallow.run(50);
    shallow.input.heartRate = 160;
    shallow.run(20);
    Test.assertEqual(shallow.at(RunAlertEvent.HR_HIGH, 1), 80);
    // 3 beats under is the end: the next alarm needs the whole dwell time again
    var deep = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    deep.input.heartRate = 160;
    deep.run(20);
    deep.input.heartRate = 147;
    deep.run(50);
    deep.input.heartRate = 160;
    deep.run(30);
    Test.assertEqual(deep.count(RunAlertEvent.HR_HIGH), 2);
    Test.assertEqual(deep.at(RunAlertEvent.HR_HIGH, 1), 90);   // 71 .. 90 is the dwell time
    // never inside the lock: an episode that is over again within 60 s waits for the lock
    var quick = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    quick.input.heartRate = 160;
    quick.run(20);
    quick.input.heartRate = 140;
    quick.run(5);
    quick.input.heartRate = 160;
    quick.run(60);
    Test.assertEqual(quick.count(RunAlertEvent.HR_HIGH), 2);
    Test.assertEqual(quick.at(RunAlertEvent.HR_HIGH, 1), 80);
    return true;
}

(:test)
function withoutHeartRateThereIsNoHeartRateAlarmAndOneHint(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    rig.input.heartRate = null;
    rig.run(59);
    Test.assertEqual(rig.count(RunAlertEvent.NO_HEART_RATE), 0);
    rig.step();
    Test.assertEqual(rig.at(RunAlertEvent.NO_HEART_RATE, 0), 60);
    rig.run(600);
    // the heart rate comes and goes: the hint stays a single one
    rig.input.heartRate = 120;
    rig.run(30);
    rig.input.heartRate = null;
    rig.run(300);
    Test.assertEqual(rig.count(RunAlertEvent.NO_HEART_RATE), 1);
    Test.assertEqual(rig.count(RunAlertEvent.HR_HIGH) + rig.count(RunAlertEvent.HR_LOW), 0);
    // 0 is no reading either
    var zero = new AlertRig({ "k" => 4 } as Dictionary, null).bpm(150, 160).pastRunIn();
    zero.input.heartRate = 0;
    zero.run(200);
    Test.assertEqual(zero.count(RunAlertEvent.HR_LOW), 0);
    Test.assertEqual(zero.count(RunAlertEvent.NO_HEART_RATE), 1);
    // a gap shorter than 60 s does not count and starts again
    var gaps = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    gaps.input.heartRate = null;
    gaps.run(59);
    gaps.input.heartRate = 130;
    gaps.step();
    gaps.input.heartRate = null;
    gaps.run(59);
    Test.assertEqual(gaps.count(RunAlertEvent.NO_HEART_RATE), 0);
    // a heart rate that fell away while over the bound ends the count
    var lost = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    lost.input.heartRate = 170;
    lost.run(19);
    lost.input.heartRate = null;
    lost.step();
    lost.input.heartRate = 170;
    lost.step();
    Test.assertEqual(lost.count(RunAlertEvent.HR_HIGH), 0);
    return true;
}

(:test)
function heartRateTooLowOnlyWithHeartRateTargetsInTempoWork(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 4 } as Dictionary, null).bpm(150, 160).pastRunIn();
    rig.input.heartRate = 140;
    rig.run(29);
    Test.assertEqual(rig.count(RunAlertEvent.HR_LOW), 0);
    rig.step();
    Test.assertEqual(rig.at(RunAlertEvent.HR_LOW, 0), 30);
    rig.run(60);
    Test.assertEqual(rig.at(RunAlertEvent.HR_LOW, 1), 90);    // after the lock
    // on the bound is not under it
    var edge = new AlertRig({ "k" => 4 } as Dictionary, null).bpm(150, 160).pastRunIn();
    edge.input.heartRate = 150;
    edge.run(100);
    Test.assertEqual(edge.count(RunAlertEvent.HR_LOW), 0);
    // threshold intervals count as well; a base run, a recovery segment, a pace target do not
    var threshold = new AlertRig({ "k" => 5 } as Dictionary, null).bpm(150, 160).pastRunIn();
    threshold.input.heartRate = 140;
    threshold.run(30);
    Test.assertEqual(threshold.count(RunAlertEvent.HR_LOW), 1);
    var base = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(150, 160).pastRunIn();
    base.input.heartRate = 100;
    base.run(100);
    var recovery = new AlertRig({ "k" => 4 } as Dictionary, null).bpm(150, 160).pastRunIn();
    recovery.input.kind = 2;
    recovery.input.heartRate = 100;
    recovery.run(100);
    var byPace = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600).pastRunIn();
    byPace.input.heartRate = 100;
    byPace.run(100);
    Test.assertEqual(base.count(RunAlertEvent.HR_LOW) + recovery.count(RunAlertEvent.HR_LOW) + byPace.count(RunAlertEvent.HR_LOW), 0);
    // zone targets give the lower bound of the zone
    var zone = new AlertRig({ "k" => 4 } as Dictionary, [100, 120, 140, 160, 180, 200] as Array<Number>).pastRunIn();
    zone.input.targetType = 1;
    zone.input.targetLow = 3;
    zone.input.targetHigh = 4;
    zone.input.heartRate = 139;
    zone.run(30);
    Test.assertEqual(zone.count(RunAlertEvent.HR_LOW), 1);
    return true;
}

(:test)
function paceOutsideTheBandNeedsLongWorkAndFifteenSeconds(logger as Logger) as Boolean {
    // too slow (more s/km than the slow end) = "faster": counted from the 20th second of the segment, 15 s long
    var slow = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600);
    slow.input.paceSKm = 300;
    slow.run(33);
    Test.assertEqual(slow.count(RunAlertEvent.PACE_FAST), 0);
    slow.step();
    Test.assertEqual(slow.at(RunAlertEvent.PACE_FAST, 0), 34);
    Test.assertEqual(slow.count(RunAlertEvent.PACE_SLOW), 0);
    // too fast = "slower"
    var fast = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600);
    fast.input.paceSKm = 250;
    fast.run(34);
    Test.assertEqual(fast.at(RunAlertEvent.PACE_SLOW, 0), 34);
    Test.assertEqual(fast.count(RunAlertEvent.PACE_FAST), 0);
    // on the edges of the band: nothing
    var edge = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600);
    edge.input.paceSKm = 290;
    edge.run(100);
    edge.input.paceSKm = 270;
    edge.run(100);
    Test.assertEqual(edge.types.size(), 0);
    // no pace (standing) is no alarm and starts the count again
    var still = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600);
    still.input.paceSKm = 300;
    still.run(30);
    still.input.paceSKm = null;
    still.step();
    still.input.paceSKm = 300;
    still.run(14);
    Test.assertEqual(still.count(RunAlertEvent.PACE_FAST), 0);
    still.step();
    Test.assertEqual(still.count(RunAlertEvent.PACE_FAST), 1);
    // tolerance widens the band
    var tolerant = new AlertRig({ "k" => 4, "a" => { "pace" => [15, 10, 20, 60] } as Dictionary } as Dictionary, null).paceBand(270, 290, 1, 600);
    tolerant.input.paceSKm = 300;
    tolerant.run(100);
    Test.assertEqual(tolerant.types.size(), 0);
    // repeats only after the lock
    slow.run(100);
    Test.assertEqual(slow.at(RunAlertEvent.PACE_FAST, 1), 94);
    return true;
}

(:test)
function shortWorkSegmentsHaveNoPaceAlarm(logger as Logger) as Boolean {
    var values = [[1, 119], [1, 0], [2, 399], [2, 0]] as Array<Array<Number>>;
    for (var i = 0; i < values.size(); i++) {
        var rig = new AlertRig({ "k" => 6 } as Dictionary, null).paceBand(270, 290, values[i][0], values[i][1]);
        rig.input.paceSKm = 400;
        rig.run(200);
        Test.assertEqual(rig.count(RunAlertEvent.PACE_FAST) + rig.count(RunAlertEvent.PACE_SLOW), 0);
    }
    // exactly 2 min and exactly 400 m are long enough
    var edges = [[1, 120], [2, 400]] as Array<Array<Number>>;
    for (var j = 0; j < edges.size(); j++) {
        var rig = new AlertRig({ "k" => 6 } as Dictionary, null).paceBand(270, 290, edges[j][0], edges[j][1]);
        rig.input.paceSKm = 400;
        rig.run(40);
        Test.assertEqual(rig.count(RunAlertEvent.PACE_FAST), 1);
    }
    // only work: a recovery segment with a pace target is silent
    var recovery = new AlertRig({ "k" => 6 } as Dictionary, null).paceBand(270, 290, 1, 600);
    recovery.input.kind = 2;
    recovery.input.paceSKm = 400;
    recovery.run(200);
    Test.assertEqual(recovery.count(RunAlertEvent.PACE_FAST) + recovery.count(RunAlertEvent.PACE_SLOW), 0);
    return true;
}

(:test)
function theCountdownComesThreeSecondsOrFiftyMetresBeforeTheEnd(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 6 } as Dictionary, null);
    rig.input.durationType = 1;
    rig.input.durationValue = 60;
    rig.input.nextKind = 2;
    rig.input.nextTargetType = 3;
    rig.input.nextTargetLow = 110;
    rig.input.nextTargetHigh = 130;
    rig.run(56);
    Test.assertEqual(rig.count(RunAlertEvent.COUNTDOWN), 0);
    rig.step();
    Test.assertEqual(rig.at(RunAlertEvent.COUNTDOWN, 0), 57);
    var event = rig.last as RunAlertEvent;
    Test.assertEqual(event.value, 3);
    Test.assertEqual(event.kind, 2);
    Test.assertEqual(event.targetLow, 110);
    rig.run(2);
    Test.assertEqual(rig.count(RunAlertEvent.COUNTDOWN), 1);     // once, not every second
    // distance: the last 50 m
    var run = new AlertRig({ "k" => 6 } as Dictionary, null);
    run.cmPerSecond = 400;
    run.input.durationType = 2;
    run.input.durationValue = 400;
    run.run(87);                                                   // 348 m: 52 m left
    Test.assertEqual(run.count(RunAlertEvent.COUNTDOWN), 0);
    run.step();                                                    // 352 m: 48 m left
    Test.assertEqual(run.count(RunAlertEvent.COUNTDOWN), 1);
    Test.assertEqual((run.last as RunAlertEvent).value, 48);
    var onTheMark = new AlertRig({ "k" => 6 } as Dictionary, null);
    onTheMark.cmPerSecond = 1000;
    onTheMark.input.durationType = 2;
    onTheMark.input.durationValue = 400;
    onTheMark.run(34);                                             // 340 m
    Test.assertEqual(onTheMark.count(RunAlertEvent.COUNTDOWN), 0);
    onTheMark.run(1);                                              // 350 m: exactly 50 m left
    Test.assertEqual(onTheMark.count(RunAlertEvent.COUNTDOWN), 1);
    // an open segment has none; a plan that ends says so
    var open = new AlertRig({ "k" => 6 } as Dictionary, null);
    open.run(500);
    Test.assertEqual(open.types.size(), 0);
    var last = new AlertRig({ "k" => 6 } as Dictionary, null);
    last.input.durationType = 1;
    last.input.durationValue = 10;
    last.run(8);
    Test.assertEqual((last.last as RunAlertEvent).kind, -1);
    return true;
}

(:test)
function aSegmentChangeIsOneEventWithTheNewSegmentAndItsTarget(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 6 } as Dictionary, null);
    rig.run(5);
    Test.assertEqual(rig.types.size(), 0);                         // the first second is no change
    rig.input.ordinal = 1;
    rig.input.kind = 2;
    rig.input.targetType = 3;
    rig.input.targetLow = 110;
    rig.input.targetHigh = 130;
    rig.step();
    Test.assertEqual(rig.count(RunAlertEvent.CHANGE), 1);
    var event = rig.last as RunAlertEvent;
    Test.assertEqual(event.kind, 2);
    Test.assertEqual(event.targetType, 3);
    Test.assertEqual(event.targetHigh, 130);
    rig.run(10);
    Test.assertEqual(rig.count(RunAlertEvent.CHANGE), 1);
    // the end of the plan: kind -1
    rig.input.ordinal = 2;
    rig.input.kind = -1;
    rig.step();
    Test.assertEqual(rig.count(RunAlertEvent.CHANGE), 2);
    Test.assertEqual((rig.last as RunAlertEvent).kind, -1);
    // a run taken up again does not announce the segment it is in
    var again = new AlertRig({ "k" => 6 } as Dictionary, null);
    again.input.ordinal = 7;
    again.run(5);
    Test.assertEqual(again.types.size(), 0);
    return true;
}

(:test)
function everyFullKilometreIsOneEventWithItsTimeOnlyIfTheSettingIsOn(logger as Logger) as Boolean {
    var rig = new AlertRig(null, null);
    rig.input.kind = -1;
    rig.cmPerSecond = 300;                                         // 5:33 per km
    rig.run(332);
    Test.assertEqual(rig.count(RunAlertEvent.KM), 0);
    rig.step();                                                    // 333 s: 999.0 m
    Test.assertEqual(rig.count(RunAlertEvent.KM), 0);
    rig.step();                                                    // 1002 m
    Test.assertEqual(rig.at(RunAlertEvent.KM, 0), 334);
    var event = rig.last as RunAlertEvent;
    Test.assertEqual(event.value, 1);
    Test.assertEqual(event.timeS, 334);
    rig.run(334);
    Test.assertEqual(rig.count(RunAlertEvent.KM), 2);
    Test.assertEqual((rig.last as RunAlertEvent).value, 2);
    Test.assertEqual((rig.last as RunAlertEvent).timeS, 333);   // 2 km at 667 s
    // the setting off: no event, and switching it on later does not catch up
    var off = new AlertRig(null, null);
    off.input.kind = -1;
    off.input.kmSignal = false;
    off.cmPerSecond = 1000;
    off.run(250);                                                  // 2.5 km
    Test.assertEqual(off.count(RunAlertEvent.KM), 0);
    off.input.kmSignal = true;
    off.run(60);                                                   // past 3 km (300 s)
    Test.assertEqual(off.count(RunAlertEvent.KM), 1);
    Test.assertEqual((off.last as RunAlertEvent).value, 3);
    Test.assertEqual((off.last as RunAlertEvent).timeS, 100);       // the km before went by silently, its mark was kept
    // a run that is taken up again at 4.2 km knows no time for the km it is in, and says nothing for the earlier ones
    var back = new AlertRig(null, null);
    back.input.kind = -1;
    back.input.distanceCm = 420000;
    back.input.timerS = 2000;
    back.cmPerSecond = 1000;
    back.run(79);
    Test.assertEqual(back.count(RunAlertEvent.KM), 0);
    back.step();
    Test.assertEqual(back.count(RunAlertEvent.KM), 1);
    Test.assertEqual((back.last as RunAlertEvent).value, 5);
    Test.assertEqual((back.last as RunAlertEvent).timeS, -1);
    return true;
}

(:test)
function longRunsDrinkFromMinuteSixtyEveryThirtyMinutes(logger as Logger) as Boolean {
    var rig = new AlertRig({ "k" => 2 } as Dictionary, null);
    rig.input.kind = -1;
    rig.stepAt(1);
    rig.stepAt(3599);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 0);
    rig.stepAt(3600);
    rig.stepAt(3601);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 1);
    Test.assertEqual((rig.last as RunAlertEvent).value, 60);
    rig.stepAt(5399);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 1);
    rig.stepAt(5400);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 2);
    Test.assertEqual((rig.last as RunAlertEvent).value, 90);
    rig.stepAt(7200);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 3);
    // a second that skipped the mark does not fire twice
    rig.stepAt(9100);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 4);
    rig.stepAt(9101);
    Test.assertEqual(rig.count(RunAlertEvent.DRINK), 4);
    // other runs have none, unless the prescription asks for one
    var base = new AlertRig({ "k" => 1 } as Dictionary, null);
    base.stepAt(1);
    base.stepAt(7300);
    Test.assertEqual(base.count(RunAlertEvent.DRINK), 0);
    var asked = new AlertRig({ "k" => 1, "dr" => [30, 10] as Array } as Dictionary, null);
    asked.stepAt(1);
    asked.stepAt(1800);
    asked.stepAt(2400);
    asked.stepAt(2401);
    Test.assertEqual(asked.count(RunAlertEvent.DRINK), 2);
    // taken up again after 100 minutes: the reminders that passed are not made up
    var back = new AlertRig({ "k" => 2 } as Dictionary, null);
    back.stepAt(6000);
    Test.assertEqual(back.count(RunAlertEvent.DRINK), 0);
    back.stepAt(7199);
    Test.assertEqual(back.count(RunAlertEvent.DRINK), 0);
    back.stepAt(7200);
    Test.assertEqual(back.count(RunAlertEvent.DRINK), 1);
    return true;
}

(:test)
function switchedOffHeartRateAlarmsAndMutingSilenceButStillLog(logger as Logger) as Boolean {
    var off = new AlertRig({ "k" => 1 } as Dictionary, null).bpm(140, 150).pastRunIn();
    off.input.hrAlarms = false;
    off.input.heartRate = 170;
    off.run(20);
    Test.assertEqual(off.count(RunAlertEvent.HR_HIGH), 1);          // logged
    var event = off.last as RunAlertEvent;
    Test.assert(!event.shown);
    Test.assert(!event.audible);
    Test.assertEqual(off.alerts.countOf(RunAlertEvent.HR_HIGH), 1);
    // the setting is for the heart rate alarms: pace and kilometres still speak
    var pace = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600);
    pace.input.hrAlarms = false;
    pace.input.paceSKm = 300;
    pace.run(34);
    Test.assert((pace.last as RunAlertEvent).audible);
    // muted: no sound, the hint may stay
    var muted = new AlertRig({ "k" => 4 } as Dictionary, null).paceBand(270, 290, 1, 600);
    muted.input.muted = true;
    muted.input.paceSKm = 300;
    muted.run(34);
    Test.assertEqual(muted.count(RunAlertEvent.PACE_FAST), 1);
    Test.assert((muted.last as RunAlertEvent).shown);
    Test.assert(!(muted.last as RunAlertEvent).audible);
    return true;
}

(:test)
class RunPatternSignals extends Signals {
    var patterns as Array<Number> = [] as Array<Number>;
    var vibrated as Array<Boolean> = [] as Array<Boolean>;
    var toned as Array<Boolean> = [] as Array<Boolean>;
    var lengths as Array<Number> = [] as Array<Number>;

    function initialize(store as KeyValueStore or Null) {
        Signals.initialize(store);
    }

    function outputPattern(pattern as Number, steps as Array<Number>, loud as Boolean, vibrate as Boolean, tone as Boolean) as Void {
        patterns.add(pattern);
        lengths.add(steps.size());
        vibrated.add(vibrate);
        toned.add(tone);
    }
}

(:test)
function everyAlertHasItsOwnPatternAndTheSwitchesApply(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var signals = new RunPatternSignals(store);
    signals.runAlert(Signals.RUN_HR_HIGH);
    signals.runAlert(Signals.RUN_HR_LOW);
    signals.runAlert(Signals.RUN_PACE_FAST);
    signals.runAlert(Signals.RUN_PACE_SLOW);
    signals.runAlert(Signals.RUN_CHANGE);
    signals.runAlert(Signals.RUN_KM);
    // two long = 3 steps (long, gap, long); one short = 1; short-short = 3; one long = 1; three short and one long = 7
    Test.assert(Same.numbers(signals.lengths, [3, 1, 3, 1, 7, 1] as Array<Number>));
    Test.assert(signals.vibrated[0] && signals.toned[0]);
    var settings = new Settings(store);
    settings.set(Settings.VIBRATION, false);
    signals.runAlert(Signals.RUN_KM);
    Test.assert(!signals.vibrated[6] && signals.toned[6]);
    settings.set(Settings.VIBRATION, true);
    settings.set(Settings.TONE, false);
    signals.runAlert(Signals.RUN_KM);
    Test.assert(signals.vibrated[7] && !signals.toned[7]);
    // the strength recorder's signals are the old ones
    var old = new RunPatternSignals(null);
    old.runAlert(Signals.RUN_DRINK);
    Test.assertEqual(old.patterns.size(), 1);
    return true;
}

// A run session with the alarms wired in, the signals recorded.
(:test)
class AlertSim extends RunSim {
    var signals as RunPatternSignals;

    function initialize(body as Dictionary or Null) {
        RunSim.initialize(body, 0, false);
        signals = new RunPatternSignals(null);
        signals.useSettings(parts.settings);
        session.alerts.signals = signals;
    }
}

(:test)
function theSessionTicksTheAlarmsAndVibratesOnTheKilometre(logger as Logger) as Boolean {
    var rig = new AlertSim(null);
    rig.source.speed = 1000;
    rig.seconds(99);
    Test.assertEqual(rig.signals.patterns.size(), 0);
    Test.assert(rig.session.alerts.currentHint() == null);
    rig.seconds(1);
    Test.assert(Same.numbers(rig.signals.patterns, [Signals.RUN_KM] as Array<Number>));
    var hint = rig.session.alerts.currentHint();
    Test.assert(hint != null);
    Test.assert((hint as RunAlertHint).text.find("1") != null);
    // the hint is there for five seconds
    rig.seconds(4);
    Test.assert(rig.session.alerts.currentHint() != null);
    rig.seconds(1);
    Test.assert(rig.session.alerts.currentHint() == null);
    // the km signal off: the km goes by silently
    rig.parts.settings.set(Settings.KM_SIGNAL, false);
    rig.seconds(100);
    Test.assertEqual(rig.signals.patterns.size(), 1);
    return true;
}

(:test)
function aPausedRunCountsNoAlarmSecondsAndTheHeartRateAlarmComesFromThePlan(logger as Logger) as Boolean {
    // a base run, heart rate 150 with a bound of 120: after the run-in time (300 s) and the dwell time (20 s)
    var body = RunSim.prescription([[1, 1, 1200, 3, 100, 120] as Array] as Array, null);
    var rig = new AlertSim(body);
    rig.source.hr = 150;
    rig.seconds(318);
    Test.assertEqual(rig.signals.patterns.size(), 0);
    rig.session.pause();
    rig.seconds(50);
    Test.assertEqual(rig.session.alerts.alerts.seconds(), 318);   // standing still: no second counted
    rig.session.resume();
    rig.seconds(1);
    Test.assertEqual(rig.session.alerts.alerts.seconds(), 319);
    Test.assert(Same.numbers(rig.signals.patterns, [Signals.RUN_HR_HIGH] as Array<Number>));
    Test.assert(rig.session.alerts.currentHint() != null);
    return true;
}

(:test)
function mutedAndSwitchedOffRunsMakeNoSignal(logger as Logger) as Boolean {
    var body = RunSim.prescription([[1, 1, 1200, 3, 100, 120] as Array] as Array, null);
    // muted: no signal, the hint line stays
    var muted = new AlertSim(body);
    muted.source.speed = 200;                                      // under 1 km: no km signal in this test
    muted.source.hr = 150;
    muted.session.setMuted(true);
    Test.assert(muted.session.isMuted());
    muted.seconds(330);
    Test.assertEqual(muted.signals.patterns.size(), 0);
    Test.assert(muted.session.alerts.alerts.countOf(RunAlertEvent.HR_HIGH) >= 1);
    // unmuted again: the next repeat is heard
    muted.session.setMuted(false);
    muted.seconds(60);
    Test.assert(muted.signals.patterns.size() >= 1);
    // heart rate alarms off: nothing, not even a hint
    var off = new AlertSim(body);
    off.parts.settings.set(Settings.HR_ALARMS, false);
    off.source.speed = 200;
    off.source.hr = 150;
    off.seconds(400);
    Test.assertEqual(off.signals.patterns.size(), 0);
    Test.assert(off.session.alerts.currentHint() == null);
    Test.assert(off.session.alerts.alerts.countOf(RunAlertEvent.HR_HIGH) >= 1);
    return true;
}

(:test)
function theChangeIsHeardOnceWithTheNextSegmentAsText(logger as Logger) as Boolean {
    var body = RunSim.prescription([RunSim.timed(10), [1, 1, 10, 2, 270, 290] as Array] as Array, null);
    var rig = new AlertSim(body);
    rig.seconds(7);                                                // countdown at 7 s (3 s left)
    Test.assert(Same.numbers(rig.signals.patterns, [Signals.RUN_COUNTDOWN] as Array<Number>));
    var hint = rig.session.alerts.currentHint() as RunAlertHint;
    Test.assert(hint.text.find("4:30") != null);
    rig.seconds(4);                                                // the change
    Test.assert(Same.numbers(rig.signals.patterns, [Signals.RUN_COUNTDOWN, Signals.RUN_CHANGE] as Array<Number>));
    return true;
}
