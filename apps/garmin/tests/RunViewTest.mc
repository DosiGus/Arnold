import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// The run display (RUN-016): pages per run type on every display, the keys, the questions, the energy saving
// picture. The navigation is recorded instead of driven (FakeRunNav), so the keys are tested without a screen stack.

(:test)
class FakeRunNav extends RunNav {
    var calls as Array<String> = [] as Array<String>;
    var choices as Array<RunChoices> = [] as Array<RunChoices>;

    function initialize() {
        RunNav.initialize();
    }

    function pop() as Void {
        calls.add("pop");
    }

    function openChoices(list as RunChoices) as Void {
        calls.add("open");
        choices.add(list);
    }

    function toSummary(saved as Boolean, afterPreStart as Boolean) as Void {
        calls.add("summary:" + saved + ":" + afterPreStart);
    }

    function leave(afterPreStart as Boolean) as Void {
        calls.add("leave:" + afterPreStart);
    }

    function last() as RunChoices {
        return choices[choices.size() - 1];
    }

    function said() as String {
        var text = "";
        for (var i = 0; i < calls.size(); i++) {
            text += (i > 0 ? "," : "") + calls[i];
        }
        return text;
    }
}

// A starter that records where the run display would open and never touches the real storage.
(:test)
class FakeStarter extends RunStarter {
    var given as RunParts;
    var opened as Array<RunSession> = [] as Array<RunSession>;
    var afterPreStart as Boolean = false;

    function initialize(runParts as RunParts, nav as RunNav) {
        RunStarter.initialize(null);
        given = runParts;
        useNav(nav);
    }

    function parts() as RunParts {
        return given;
    }

    function open(session as RunSession, after as Boolean) as Void {
        opened.add(session);
        afterPreStart = after;
    }
}

(:test)
module ViewRig {
    // [kind, duration type, value, target type, low, high]
    function seg(kind as Number, type as Number, value as Number, target as Number, low as Number, high as Number) as Array {
        return [kind, type, value, target, low, high] as Array;
    }

    function body(runKind as Number, segments as Array, repeats as Array or Null) as Dictionary {
        var out = { "k" => runKind, "n" => "T", "e" => 0, "s" => segments } as Dictionary;
        if (repeats != null) {
            out["rp"] = repeats;
        }
        return out;
    }

    // Every run type with the segments it brings: the pages of each are checked on each display.
    function sims() as Array<RunSim> {
        var out = [] as Array<RunSim>;
        out.add(new RunSim(body(1, [seg(1, 0, 0, 1, 2, 2)] as Array, null), 0, false));                 // base, one open segment
        out.add(new RunSim(body(0, [seg(1, 1, 1800, 0, 0, 0)] as Array, null), 0, false));              // recovery
        out.add(new RunSim(body(2, [seg(1, 2, 20000, 1, 2, 3)] as Array, null), 0, false));             // long run
        out.add(new RunSim(body(6, [seg(0, 1, 600, 0, 0, 0), seg(1, 1, 180, 2, 270, 285), seg(2, 1, 120, 0, 0, 0), seg(3, 1, 600, 0, 0, 0)] as Array, [[1, 2, 6]] as Array), 0, false));   // intervals, pace target
        out.add(new RunSim(body(7, [seg(1, 2, 400, 3, 160, 175), seg(2, 2, 200, 0, 0, 0)] as Array, [[0, 1, 8]] as Array), 1, false));   // repetitions by distance, bpm target, treadmill
        out.add(new RunSim(body(4, [seg(1, 0, 0, 4, 6, 7), seg(1, 1, 1200, 1, 3, 4)] as Array, null), 2, false));   // tempo: effort target, then zone range
        out.add(new RunSim(body(11, [seg(1, 1, 60, 0, 0, 0), seg(2, 1, 90, 0, 0, 0)] as Array, [[0, 1, 8]] as Array), 0, false));   // run-walk
        out.add(new RunSim(body(10, [seg(0, 1, 5, 0, 0, 0), seg(1, 1, 5, 0, 0, 0)] as Array, null), 0, false));   // fartlek, the plan ends below
        out.add(new RunSim(null, 0, true));                                                              // free run
        return out;
    }

    // Draws all pages of the session; each must fit the display and no word may be wider than the display.
    function check(dc as Dc, session as RunSession, label as String) as Void {
        var count = RunPages.pageCount(session);
        for (var p = 0; p < count; p++) {
            var page = RunPages.build(dc, session, p);
            var message = label + " page " + (p + 1);
            Test.assertMessage(LayoutRig.fits(dc, page.lines), message + " fits: " + ViewRig.heights(dc, page.lines));
            var drawn = PairingLayout.arrange(dc, page.lines);
            for (var i = 0; i < drawn.size(); i++) {
                Test.assertMessage(dc.getTextWidthInPixels(drawn[i].text, drawn[i].font) <= dc.getWidth(), message + " width of '" + drawn[i].text + "'");
            }
            RunLayout.draw(dc, page.lines, page.zone, 0, 0);
        }
    }

    // For a failing message: the display, the room (86 %) and the height of each line as it would be drawn.
    function heights(dc as Dc, lines as Array<PairingLine>) as String {
        var drawn = PairingLayout.arrange(dc, lines);
        var text = dc.getWidth() + "x" + dc.getHeight() + " max " + PairingLayout.maxBlockHeight(dc) + " has " + PairingLayout.blockHeight(dc, drawn) + ":";
        for (var i = 0; i < drawn.size(); i++) {
            text += " " + dc.getFontHeight(drawn[i].font) + "(" + drawn[i].text + ")";
        }
        return text;
    }

    function nav(rig as RunSim) as FakeRunNav {
        return new FakeRunNav();
    }
}

(:test)
function everyRunTypeFitsOnEveryDisplayOnAllPages(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var all = ViewRig.sims();
    for (var i = 0; i < all.size(); i++) {
        var sim = all[i];
        sim.seconds(7);
        ViewRig.check(dc, sim.session, "sim " + i + " running");
        sim.session.pause();
        ViewRig.check(dc, sim.session, "sim " + i + " paused");
        sim.session.resume();
        sim.source.hr = null;                        // no heart rate: every line says "--"
        sim.seconds(3);
        ViewRig.check(dc, sim.session, "sim " + i + " without heart rate");
    }
    return true;
}

(:test)
function longRunsAndAutoPauseFitToo(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var treadmill = new RunSim(ViewRig.body(1, [ViewRig.seg(1, 0, 0, 0, 0, 0)] as Array, null), PreStartModel.ENV_TREADMILL, false);
    treadmill.source.speed = 1000;
    treadmill.seconds(3700);                         // 1:01:40 and 37 km, estimated
    ViewRig.check(dc, treadmill.session, "treadmill");
    var free = new RunSim(null, 0, true);
    free.source.speed = 0;
    free.seconds(8);
    Test.assertEqual(free.session.state, RunSession.STATE_AUTO_PAUSED);
    ViewRig.check(dc, free.session, "auto pause");
    var done = new RunSim(ViewRig.body(10, [ViewRig.seg(1, 1, 3, 0, 0, 0)] as Array, null), 0, false);
    done.seconds(10);
    Test.assert(done.session.isPlanDone());
    ViewRig.check(dc, done.session, "plan done");
    return true;
}

(:test)
function pageOneShowsWhatTheRunTypeNeeds(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    // heart rate run: the big number is the heart rate, the zone bar follows
    var base = new RunSim(ViewRig.body(1, [ViewRig.seg(1, 0, 0, 0, 0, 0)] as Array, null), 0, false);
    base.seconds(5);
    var page = RunPages.build(dc, base.session, 0);
    Test.assert(LayoutRig.mainNumbersAreBig(dc, page.lines));
    Test.assertEqual(page.zone, 3);                  // 140 bpm with zones 100/120/140/... is zone 3
    Test.assertMessage(page.lines[0].text.equals("140"), "heart rate " + page.lines[0].text);
    // intervals: head "n/m · kind", time left big
    var intervals = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 180, 2, 270, 285), ViewRig.seg(2, 1, 120, 0, 0, 0)] as Array, [[0, 1, 6]] as Array), 0, false);
    intervals.seconds(20);
    var seg = RunPages.build(dc, intervals.session, 0);
    Test.assertEqual(seg.zone, -1);
    Test.assertMessage(seg.lines[0].text.equals("1/12 · " + HomeScreen.text(Rez.Strings.RunKind1)), seg.lines[0].text);
    Test.assertMessage(seg.lines[1].text.equals("02:40"), seg.lines[1].text);   // 180 s - 20 s
    Test.assert(seg.lines[2].text.find("4:30") != null && seg.lines[2].text.find("4:45") != null);
    // distance segment: metres left
    var reps = new RunSim(ViewRig.body(7, [ViewRig.seg(1, 2, 400, 0, 0, 0)] as Array, null), 0, false);
    reps.seconds(40);                                // 3 m/s: 120 m run
    Test.assertMessage(RunPages.remaining(reps.session).equals(RunText.meters(280)), RunPages.remaining(reps.session));
    // run-walk: label and round
    var walk = new RunSim(ViewRig.body(11, [ViewRig.seg(1, 1, 60, 0, 0, 0), ViewRig.seg(2, 1, 90, 0, 0, 0)] as Array, [[0, 1, 8]] as Array), 0, false);
    walk.seconds(10);
    var run = RunPages.build(dc, walk.session, 0);
    Test.assertMessage(run.lines[0].text.equals(Lang.format(HomeScreen.text(Rez.Strings.RunRoundOf), [1, 8])), run.lines[0].text);
    Test.assert(run.lines[1].text.equals(HomeScreen.text(Rez.Strings.RunRunNow)));
    Test.assert(LayoutRig.mainNumbersAreBig(dc, run.lines));
    walk.seconds(60);                                // now in the walking segment of round 1
    var gehen = RunPages.build(dc, walk.session, 0);
    Test.assert(gehen.lines[1].text.equals(HomeScreen.text(Rez.Strings.RunWalkNow)));
    Test.assertMessage(gehen.lines[2].text.equals("01:20"), gehen.lines[2].text);
    walk.seconds(90);                                // round 2 begins
    Test.assertMessage(RunPages.build(dc, walk.session, 0).lines[0].text.equals(Lang.format(HomeScreen.text(Rez.Strings.RunRoundOf), [2, 8])), "round 2");
    // free run: time first, then distance, pace, heart rate
    var free = new RunSim(null, 0, false);
    free.seconds(65);
    var f = RunPages.build(dc, free.session, 0);
    Test.assert(f.lines[0].text.equals("01:05"));
    Test.assert(LayoutRig.mainNumbersAreBig(dc, f.lines));
    return true;
}

(:test)
function otherPagesShowTheirValuesAndDashesWhereNothingIsKnown(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 600, 0, 0, 0), ViewRig.seg(2, 1, 60, 0, 0, 0)] as Array, null), 0, false);
    rig.source.hr = null;
    rig.seconds(5);
    Test.assertEqual(RunPages.pageCount(rig.session), 4);
    var two = RunPages.build(dc, rig.session, 1);
    Test.assert(two.lines[0].text.equals("00:05"));
    var joined = "";
    for (var i = 0; i < two.lines.size(); i++) {
        joined += two.lines[i].text + "|";
    }
    Test.assertMessage(joined.find(RunText.NONE) != null, "no heart rate shows --: " + joined);
    // page 3: before the first km the last km is "--"
    var three = RunPages.build(dc, rig.session, 2);
    Test.assert(three.lines[0].text.find(RunText.NONE) != null);
    // page 4: the next segment, then nothing more after the last
    var four = RunPages.build(dc, rig.session, 3);
    Test.assert(four.lines[0].text.equals(HomeScreen.text(Rez.Strings.RunNext)));
    Test.assert(four.lines[1].text.equals(RunText.kindName(2) + " " + RunText.clock(60)));
    Test.assertEqual(RunPages.build(dc, rig.session, 9).lines.size(), four.lines.size());    // a page beyond the end shows the last
    rig.session.nextSegment();
    Test.assert(RunPages.build(dc, rig.session, 3).lines[0].text.equals(HomeScreen.text(Rez.Strings.RunNextNone)));
    // a free run has three pages
    var free = new RunSim(null, 0, false);
    Test.assertEqual(RunPages.pageCount(free.session), 3);
    // the pace and the average
    Test.assert(RunText.pace(312).equals("5:12") && RunText.pace(null).equals(RunText.NONE) && RunText.pace(0).equals(RunText.NONE));
    return true;
}

(:test)
function pagesTurnAroundWithUpAndDown(logger as Logger) as Boolean {
    var free = new RunView(new RunSim(null, 0, false).session);
    Test.assertEqual(free.page(), 0);
    free.movePage(1);
    free.movePage(1);
    free.movePage(1);
    Test.assertEqual(free.page(), 0);                // three pages: DOWN thrice is back at page 1
    free.movePage(-1);
    Test.assertEqual(free.page(), 2);
    var planned = new RunView(new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 60, 0, 0, 0)] as Array, null), 0, false).session);
    planned.movePage(-1);
    Test.assertEqual(planned.page(), 3);             // four pages with segments
    return true;
}

(:test)
function theTargetShowsWhetherTheRunIsInIt(logger as Logger) as Boolean {
    var rig = new RunSim(ViewRig.body(4, [ViewRig.seg(1, 1, 600, 2, 270, 285)] as Array, null), 0, false);
    rig.source.speed = 370;                          // 270 s/km
    rig.seconds(12);
    Test.assertEqual(rig.session.targetFit(), RunSession.FIT_OK);
    rig.source.speed = 500;                          // 200 s/km, faster
    rig.seconds(40);
    Test.assertEqual(rig.session.targetFit(), RunSession.FIT_BELOW);
    rig.source.speed = 300;                          // 333 s/km, slower
    rig.seconds(40);
    Test.assertEqual(rig.session.targetFit(), RunSession.FIT_ABOVE);
    // zone 3 target at 140 bpm; no heart rate: no verdict
    var zone = new RunSim(ViewRig.body(4, [ViewRig.seg(1, 1, 600, 1, 3, 3)] as Array, null), 0, false);
    zone.seconds(3);
    Test.assertEqual(zone.session.targetFit(), RunSession.FIT_OK);
    zone.source.hr = null;
    zone.seconds(2);
    Test.assertEqual(zone.session.targetFit(), RunSession.FIT_NONE);
    Test.assert(zone.session.targetActual() == null);
    // the segment readers
    var plan = new RunSegments(ViewRig.body(6, [ViewRig.seg(1, 1, 180, 2, 270, 285), ViewRig.seg(2, 1, 120, 0, 0, 0)] as Array, [[0, 1, 3]] as Array));
    Test.assertEqual(plan.runKind(), 6);
    Test.assertEqual(plan.kindOf(1), 2);
    Test.assertEqual(plan.targetType(0), 2);
    Test.assertEqual(plan.targetLow(0), 270);
    Test.assertEqual(plan.targetHigh(0), 285);
    Test.assertEqual(plan.targetType(1), 0);
    Test.assertEqual((plan.roundOf(0) as Array<Number>)[0], 1);
    Test.assertEqual((plan.roundOf(3) as Array<Number>)[0], 2);
    Test.assertEqual((plan.roundOf(5) as Array<Number>)[0], 3);
    Test.assertEqual((plan.roundOf(5) as Array<Number>)[1], 3);
    Test.assert(plan.roundOf(6) == null);
    Test.assertEqual(new RunSegments(null).runKind(), 13);
    return true;
}

(:test)
function startAndStopOpenThePauseMenu(logger as Logger) as Boolean {
    var rig = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 600, 0, 0, 0)] as Array, null), 0, false);
    var nav = new FakeRunNav();
    var keys = new RunController(rig.session, nav, true, null);
    rig.seconds(10);
    keys.onStart();
    Test.assertEqual(rig.session.state, RunSession.STATE_PAUSED);
    Test.assertEqual(rig.backend.stops, 1);
    Test.assertEqual(nav.choices.size(), 1);
    var menu = nav.last();
    Test.assert(menu.title().equals(HomeScreen.text(Rez.Strings.RunPaused)));
    var labels = menu.labels();
    Test.assertEqual(labels.size(), 3);
    Test.assert(labels[0].equals(HomeScreen.text(Rez.Strings.RunContinue)) && labels[1].equals(HomeScreen.text(Rez.Strings.RunSave)) && labels[2].equals(HomeScreen.text(Rez.Strings.RunDiscard)));
    Test.assertEqual(menu.first(), 0);
    // BACK in the menu: it closes, the run stays paused (START opens the menu again)
    menu.onCancel();
    Test.assertEqual(rig.session.state, RunSession.STATE_PAUSED);
    Test.assertEqual(nav.said(), "open,pop");
    keys.onStart();
    Test.assertEqual(rig.session.state, RunSession.STATE_PAUSED);
    Test.assertEqual(nav.choices.size(), 2);
    // Continue
    nav.last().onChoose(0);
    Test.assertEqual(rig.session.state, RunSession.STATE_RUNNING);
    Test.assertEqual(rig.backend.starts, 1);
    Test.assertEqual(nav.said(), "open,pop,open,pop");
    return true;
}

(:test)
function saveEndsTheRunAndLeadsToTheSummary(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    var nav = new FakeRunNav();
    var keys = new RunController(rig.session, nav, true, null);
    rig.seconds(30);
    keys.onStart();
    nav.last().onChoose(1);
    Test.assertEqual(rig.backend.saves, 1);
    Test.assertEqual(rig.session.state, RunSession.STATE_FINISHED);
    Test.assertEqual(nav.said(), "open,pop,summary:true:true");
    Test.assert(!rig.parts.journal.hasInterrupted());          // saved: nothing to continue
    keys.onStart();                                            // a saved run does not open the menu again
    Test.assertEqual(nav.choices.size(), 1);
    return true;
}

(:test)
function discardNeedsAnAnswerAndNoIsTheDefault(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    var nav = new FakeRunNav();
    var keys = new RunController(rig.session, nav, false, null);
    rig.seconds(30);
    keys.onStart();
    nav.last().onChoose(2);                                    // Discard: only a question
    Test.assertEqual(rig.backend.discards, 0);
    Test.assertEqual(nav.choices.size(), 2);
    var ask = nav.last();
    Test.assert(ask.title().equals(HomeScreen.text(Rez.Strings.RunAskDiscard)));
    Test.assertEqual(ask.first(), 0);
    Test.assert(ask.labels()[0].equals(HomeScreen.text(Rez.Strings.RunNo)));
    ask.onChoose(0);                                           // No
    Test.assertEqual(rig.backend.discards, 0);
    Test.assert(rig.parts.journal.hasInterrupted());
    ask.onChoose(1);                                           // Yes
    Test.assertEqual(rig.backend.discards, 1);
    Test.assert(rig.session.isClosed());
    Test.assert(!rig.parts.journal.hasInterrupted());
    Test.assertMessage(nav.said().equals("open,open,pop,pop,pop,leave:false"), nav.said());
    return true;
}

(:test)
function theLapKeyMakesLapsAndMovesOnThroughOpenSegments(logger as Logger) as Boolean {
    var open = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 0, 0, 0, 0, 0), ViewRig.seg(2, 0, 0, 0, 0, 0)] as Array, null), 0, false);
    var nav = new FakeRunNav();
    var keys = new RunController(open.session, nav, true, null);
    open.seconds(20);
    Test.assertEqual(open.session.lapAction(), RunSession.LAP_OPEN);
    keys.onLap();                                              // an open segment ends at once, no question
    Test.assertEqual(open.session.segmentNumber(), 2);
    Test.assertEqual(open.backend.lapSegments.size(), 1);
    Test.assertEqual(nav.choices.size(), 0);
    keys.onLap();
    Test.assert(open.session.isPlanDone());
    // after the plan a lap is a plain lap and restarts the lap time
    open.seconds(10);
    Test.assertEqual(open.session.lapAction(), RunSession.LAP_MANUAL);
    keys.onLap();
    Test.assertEqual(open.backend.lapSegments.size(), 3);
    Test.assertEqual(open.backend.lapSegments[2], 0);
    Test.assertEqual(open.session.segmentSeconds(), 0);
    open.seconds(4);
    Test.assertEqual(open.session.segmentSeconds(), 4);
    // a free run: laps too (and the 1 km laps go on by themselves)
    var free = new RunSim(null, 0, false);
    var freeNav = new FakeRunNav();
    var freeKeys = new RunController(free.session, freeNav, true, null);
    free.seconds(15);
    freeKeys.onLap();
    freeKeys.onLap();
    Test.assertEqual(free.backend.lapSegments.size(), 2);
    Test.assertEqual(free.session.laps, 2);
    // a pause: the lap key does nothing
    free.session.pause();
    freeKeys.onLap();
    Test.assertEqual(free.backend.lapSegments.size(), 2);
    Test.assertEqual(free.session.lapAction(), RunSession.LAP_NONE);
    return true;
}

(:test)
function skippingATimedSegmentAsksFirst(logger as Logger) as Boolean {
    var rig = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 600, 0, 0, 0), ViewRig.seg(2, 2, 400, 0, 0, 0)] as Array, null), 0, false);
    var nav = new FakeRunNav();
    var keys = new RunController(rig.session, nav, true, null);
    rig.seconds(20);
    Test.assertEqual(rig.session.lapAction(), RunSession.LAP_SKIP);
    keys.onLap();
    Test.assertEqual(rig.session.segmentNumber(), 1);          // not yet
    Test.assertEqual(nav.choices.size(), 1);
    var ask = nav.last();
    Test.assert(ask.title().equals(HomeScreen.text(Rez.Strings.RunAskSkip)));
    Test.assertEqual(ask.first(), 0);
    ask.onChoose(0);                                           // No
    Test.assertEqual(rig.session.segmentNumber(), 1);
    keys.onLap();
    nav.last().onChoose(1);                                    // Yes
    Test.assertEqual(rig.session.segmentNumber(), 2);
    Test.assertEqual(rig.backend.lapSegments.size(), 1);
    Test.assertEqual(nav.said(), "open,pop,open,pop");
    // a distance segment is skipped the same way
    Test.assertEqual(rig.session.lapAction(), RunSession.LAP_SKIP);
    return true;
}

(:test)
function runSettingsSwitchAlarmsAndAutoPause(logger as Logger) as Boolean {
    var rig = new RunSim(null, 0, false);
    var nav = new FakeRunNav();
    var keys = new RunController(rig.session, nav, true, null);
    keys.onSettings();
    var menu = nav.last();
    Test.assert(menu.title().equals(HomeScreen.text(Rez.Strings.RunSettingsTitle)));
    Test.assert(menu.labels()[0].equals(HomeScreen.text(Rez.Strings.RunMuteOff)));
    Test.assert(menu.labels()[1].equals(HomeScreen.text(Rez.Strings.RunAutoOff)));
    menu.onChoose(0);
    Test.assert(rig.session.muted);
    Test.assert(menu.labels()[0].equals(HomeScreen.text(Rez.Strings.RunMuteOn)));
    menu.onChoose(1);
    Test.assert(rig.session.autoPauseOn());
    Test.assert(menu.labels()[1].equals(HomeScreen.text(Rez.Strings.RunAutoOn)));
    Test.assert(rig.parts.settings.isOn(Settings.AUTO_PAUSE));  // kept, also for the next run
    menu.onChoose(1);
    Test.assert(!rig.session.autoPauseOn());
    menu.onCancel();
    Test.assertEqual(nav.said(), "open,pop");
    Test.assertEqual(rig.session.state, RunSession.STATE_RUNNING);   // the run goes on while the settings are open
    return true;
}

(:test)
function anInterruptedRunIsAskedAboutBeforeANewOneStarts(logger as Logger) as Boolean {
    // a run that was cut off: running, paused by the crash, its journal is in the store
    var old = new RunSim(ViewRig.body(1, [ViewRig.seg(1, 0, 0, 0, 0, 0)] as Array, null), 0, false);
    old.seconds(45);
    old.session.pause();
    var oldId = old.session.uuid;
    Test.assert(old.parts.journal.hasInterrupted());
    var model = new PreStartModel(new PreStartRequest(PreStartRequest.MODE_FREE, "", null));
    var nav = new FakeRunNav();
    var starter = new FakeStarter(old.parts, nav);
    starter.start(model);
    Test.assertEqual(starter.opened.size(), 0);                // nothing starts before the answer
    Test.assertEqual(nav.choices.size(), 1);
    var ask = nav.last();
    Test.assert(ask.title().equals(HomeScreen.text(Rez.Strings.RunAskInterrupted)));
    Test.assert(ask.labels()[0].equals(HomeScreen.text(Rez.Strings.RunResumeIt)));
    Test.assert(ask.labels()[1].equals(HomeScreen.text(Rez.Strings.RunDiscard)));
    Test.assertEqual(ask.first(), 0);
    ask.onCancel();                                            // BACK: nothing happens, the marker stays
    Test.assert(old.parts.journal.hasInterrupted());
    Test.assertEqual(starter.opened.size(), 0);
    // continue: the same run, paused, on the run display
    starter.start(model);
    nav.last().onChoose(0);
    Test.assertEqual(starter.opened.size(), 1);
    Test.assert(starter.opened[0].uuid.equals(oldId));
    Test.assert(starter.opened[0].isPaused());
    Test.assert(starter.afterPreStart);
    Test.assertEqual(starter.opened[0].calc.timerS, old.session.calc.timerS);
    // discard: the old run is gone, a new one runs
    var second = new FakeStarter(old.parts, nav);
    second.start(model);
    nav.last().onChoose(1);
    Test.assertEqual(second.opened.size(), 1);
    Test.assert(!second.opened[0].uuid.equals(oldId));
    Test.assertEqual(second.opened[0].state, RunSession.STATE_RUNNING);
    Test.assert(old.parts.journal.readHead(oldId) == null);
    Test.assert((old.parts.journal.activeId() as String).equals(second.opened[0].uuid));
    // without an interrupted run START begins at once, no question
    var fresh = new RunSim(null, 0, false);
    fresh.session.save();
    var nav2 = new FakeRunNav();
    var third = new FakeStarter(fresh.parts, nav2);
    third.start(model);
    Test.assertEqual(nav2.choices.size(), 0);
    Test.assertEqual(third.opened.size(), 1);
    return true;
}

(:test)
function theEnergySavingPictureIsDarkSmallAndMoves(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new RunSim(null, 0, false);
    rig.seconds(754);
    var lines = RunPages.sleepLines(rig.session);
    var share = LayoutRig.litShare(dc, lines);
    logger.debug("energy saving picture: at most " + share + " % of the display lit on " + dc.getWidth() + " x " + dc.getHeight());
    Test.assertMessage(share <= 10, "lit share " + share);    // Garmin: under 10 % of the pixels in the low power mode
    Test.assert(LayoutRig.fits(dc, lines));
    // dark: only grey, never white
    for (var i = 0; i < lines.size(); i++) {
        Test.assert(lines[i].color != Graphics.COLOR_WHITE);
    }
    Test.assert(lines[0].text.equals(Lang.format(HomeScreen.text(Rez.Strings.HomeMinutes), [12])));
    // the picture moves a little each minute and stays inside the display
    var seen = {} as Dictionary;
    for (var minute = 0; minute < 10; minute++) {
        var dx = RunView.shift(minute, dc.getWidth());
        var dy = RunView.shift(minute / 5, dc.getHeight());
        Test.assert(dx.abs() <= dc.getWidth() / 20 && dy.abs() <= dc.getHeight() / 20);
        seen[dx] = true;
        RunLayout.draw(dc, lines, -1, dx, dy);
    }
    Test.assert(seen.size() >= 4);
    logger.debug("device needs burn-in protection: " + RunView.needsBurnInProtection());
    return true;
}

(:test)
function drawingTheRunTwiceASecondForAMinuteLeavesNothingBehind(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 3600, 2, 270, 285)] as Array, null), 0, false);
    rig.seconds(5);
    var view = new RunView(rig.session);
    for (var warm = 0; warm < 5; warm++) {
        view.onUpdate(dc);
    }
    var before = System.getSystemStats().usedMemory;
    for (var i = 0; i < 300; i++) {
        rig.session.tick();
        view.onUpdate(dc);
    }
    var after = System.getSystemStats().usedMemory;
    logger.debug("300 seconds drawn: memory " + before + " -> " + after);
    Test.assertMessage(after - before < 600, "memory grew by " + (after - before));
    return true;
}
