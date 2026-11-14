import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Test;

// Records which pre-start screens were opened (instead of pushing a view).
(:test)
class RecordingOpener extends PreStartLauncher {
    var requests as Array<PreStartRequest>;
    var resumes as Number;

    function initialize() {
        PreStartLauncher.initialize();
        requests = [] as Array<PreStartRequest>;
        resumes = 0;
    }

    function resume() as Void {
        resumes++;
    }

    function open(request as PreStartRequest) as Void {
        requests.add(request);
    }
}

// Planned runs on the watch: cache, loader and start screen on top of the plan rig (fake network,
// timers, storage). The clock stands on 2026-11-14 10:00 UTC.
(:test)
class RunRig {
    const TODAY as String = "2026-11-14";
    var plan as PlanRig;
    var cache as RunCache;
    var sync as RunSync;
    var rejected as CallCounter;
    var changes as CallCounter;
    var opener as RecordingOpener;
    var home as RunHome;

    function initialize() {
        plan = new PlanRig();
        rejected = new CallCounter();
        changes = new CallCounter();
        cache = new RunCache(plan.pairing.store);
        sync = new RunSync(plan.pairing.client, cache, plan.pairing.clock, rejected.method(:onCall));
        sync.setObserver(changes.method(:onCall));
        opener = new RecordingOpener();
        home = new RunHome(sync, plan.pairing.clock, opener);
        plan.pairing.clock.now = (RunDate.dayNumber(TODAY) as Number) * 86400 + 36000;
    }

    // A home screen for tests that only need one to exist.
    static function homeFor(pairing as PairingRig) as RunHome {
        var sync = new RunSync(pairing.client, new RunCache(pairing.store), pairing.clock, new CallCounter().method(:onCall));
        return new RunHome(sync, pairing.clock, new RecordingOpener());
    }

    function tag(id as String, version as Number) as String {
        return id + "v" + version.toString();
    }

    // dates and minutes of the entries: [[id, date offset in days, name, minutes or null]]
    function entry(id as String, days as Number, name as String, minutes as Number or Null, version as Number) as Dictionary {
        var run = { "id" => id, "d" => RunDate.iso((RunDate.dayNumber(TODAY) as Number) + days), "n" => name, "k" => 1, "m" => minutes, "dm" => null, "e" => 0, "tag" => tag(id, version) };
        return run;
    }

    function upcoming(runs as Array, consent as Boolean) as Dictionary {
        return { "api_version" => 1, "min_app_version" => "1.0.0", "d" => TODAY, "hc" => consent, "runs" => runs, "next" => null };
    }

    function prescription(id as String, name as String) as Dictionary {
        return {
            "api_version" => 1, "min_app_version" => "1.0.0", "id" => id,
            "p" => { "k" => 1, "n" => name, "e" => 0, "s" => [[0, 1, 300, 0, 0, 0], [1, 1, 1200, 1, 2, 2], [3, 1, 300, 0, 0, 0]] }
        };
    }

    // The connected watch opens the app: the run loader starts and the list is answered.
    function open(runs as Array, consent as Boolean) as Void {
        plan.pairing.restartPaired();
        sync.start();
        plan.pairing.transport.respond(200, upcoming(runs, consent));
    }

    function threeRuns(version as Number) as Array {
        return [entry("r1", 0, "Zone 2", 45, version), entry("r2", 1, "Intervalle", 50, version), entry("r3", 6, "Langer Lauf", null, version)] as Array;
    }

    // Answers the prescriptions of the queue in order (ids as the loader asks for them).
    function answerAll(version as Number) as Void {
        var names = { "r1" => "Zone 2", "r2" => "Intervalle", "r3" => "Langer Lauf" };
        var guard = 0;
        while (sync.state == RunSync.RUN_LOADING && guard < 10) {
            var url = plan.pairing.transport.urls[plan.pairing.transport.sentCount() - 1];
            var id = url.substring(url.length() - 2, url.length()) as String;
            plan.pairing.transport.respond(200, prescription(id, names[id] as String));
            guard++;
        }
    }

    function lastUrl() as String {
        return plan.pairing.transport.urls[plan.pairing.transport.sentCount() - 1];
    }

    function lastHeader(name as String) as String or Null {
        var headers = plan.pairing.transport.headers[plan.pairing.transport.sentCount() - 1];
        return headers[name];
    }

    function texts(dc as Dc) as String {
        return PlanScreens.joined(HomeScreen.stopLines(dc, plan.sync, home, new SessionPicker(), plan.pairing.clock.nowSeconds()));
    }
}

(:test)
function runDatesCountDaysAndRoundTrip(logger as Logger) as Boolean {
    Expect.equal(RunDate.dayNumber("1970-01-01"), 0);
    Expect.equal(RunDate.dayNumber("1970-01-02"), 1);
    Expect.equal(RunDate.iso(20453), "2025-12-31");
    Expect.equal(RunDate.dayNumber("2026-01-01"), 20454);
    var day = RunDate.dayNumber("2026-11-14") as Number;
    Expect.equal(RunDate.iso(day), "2026-11-14");
    Expect.equal(RunDate.iso(day + 17), "2026-12-01");
    Expect.equal(RunDate.iso((RunDate.dayNumber("2028-02-28") as Number) + 1), "2028-02-29");
    Expect.equal(RunDate.iso((RunDate.dayNumber("2028-02-28") as Number) + 2), "2028-03-01");
    Expect.equal(RunDate.iso((RunDate.dayNumber("2027-02-28") as Number) + 1), "2027-03-01");
    Test.assert(RunDate.dayNumber("2026-13-01") == null);
    Test.assert(RunDate.dayNumber("14.11.2026") == null);
    Test.assert(RunDate.dayNumber("") == null);
    // the local day: 23:30 UTC is already the next day in Berlin (+60 min), not in London
    var late = day * 86400 + 23 * 3600 + 1800;
    Expect.equal(RunDate.localDay(late, 0), day);
    Expect.equal(RunDate.localDay(late, 60), day + 1);
    Expect.equal(RunDate.localDay(late, -300), day);
    Expect.equal(RunDate.localDay(day * 86400 + 60, -120), day - 1);
    return true;
}

(:test)
function openingLoadsTheListAndThenEveryPrescription(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.open(rig.threeRuns(1), true);
    Test.assert(rig.plan.url(0).find("/runs/upcoming") != null);
    Test.assert(rig.lastHeader("If-None-Match") == null);
    Expect.equal(rig.sync.state, RunSync.RUN_LOADING);
    // today and six days ahead: one request per run, nearest first
    Test.assert(rig.lastUrl().find("/runs/r1") != null);
    rig.plan.pairing.transport.respond(200, rig.prescription("r1", "Zone 2"));
    Test.assert(rig.lastUrl().find("/runs/r2") != null);
    Test.assert(rig.lastHeader("If-None-Match") == null);
    rig.plan.pairing.transport.respond(200, rig.prescription("r2", "Intervalle"));
    Test.assert(rig.lastUrl().find("/runs/r3") != null);
    rig.plan.pairing.transport.respond(200, rig.prescription("r3", "Langer Lauf"));
    Expect.equal(rig.sync.state, RunSync.RUN_DONE);
    Expect.equal(rig.plan.pairing.transport.sentCount(), 4);
    // stored and readable for all seven days
    Expect.equal(rig.cache.runs().size(), 3);
    Expect.equal((rig.cache.prescription("r3") as Dictionary)["n"] as String, "Langer Lauf");
    Expect.equal(rig.cache.prescriptionTag("r2"), "r2v1");
    Expect.equal(rig.cache.healthConsent(), true);
    Expect.equal(rig.cache.today(rig.plan.pairing.clock.now, 0), "2026-11-14");
    // the envelope is not kept
    Test.assert(!(rig.cache.prescription("r1") as Dictionary).hasKey("api_version"));
    // only the list and the three prescriptions are in storage (plus the pairing's own keys)
    var runKeys = 0;
    var keys = rig.plan.pairing.store.values.keys();
    for (var i = 0; i < keys.size(); i++) {
        if ((keys[i] as String).find("run:") == 0) {
            runKeys++;
        }
    }
    Expect.equal(runKeys, 4);
    return true;
}

(:test)
function unchangedTagsNeedNoPrescriptionRequests(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.open(rig.threeRuns(1), true);
    rig.answerAll(1);
    Expect.equal(rig.sync.state, RunSync.RUN_DONE);
    var sent = rig.plan.pairing.transport.sentCount();
    rig.sync.start();                                                  // the app opens again
    Expect.equal(rig.plan.pairing.transport.sentCount(), sent + 1);    // only the list
    rig.plan.pairing.transport.respond(200, rig.upcoming(rig.threeRuns(1), true));
    Expect.equal(rig.plan.pairing.transport.sentCount(), sent + 1);
    Expect.equal(rig.sync.state, RunSync.RUN_DONE);
    return true;
}

(:test)
function changedTagLoadsThatPrescriptionWithIfNoneMatch(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.open(rig.threeRuns(1), true);
    rig.answerAll(1);
    var changed = [rig.entry("r1", 0, "Zone 2", 45, 1), rig.entry("r2", 1, "Intervalle", 55, 2), rig.entry("r3", 6, "Langer Lauf", null, 1)] as Array;
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.upcoming(changed, true));
    // exactly the changed run is asked for, with the stored tag in quotes
    Test.assert(rig.lastUrl().find("/runs/r2") != null);
    Expect.equal(rig.lastHeader("If-None-Match"), "\"r2v1\"");
    rig.plan.pairing.transport.respond(200, rig.prescription("r2", "Intervalle 55"));
    Expect.equal(rig.sync.state, RunSync.RUN_DONE);
    Expect.equal(rig.cache.prescriptionTag("r2"), "r2v2");
    Expect.equal((rig.cache.prescription("r2") as Dictionary)["n"] as String, "Intervalle 55");
    Expect.equal(rig.cache.runs()[1]["m"] as Number, 55);
    // 304: the stored copy stays and takes the new tag
    var again = [rig.entry("r1", 0, "Zone 2", 45, 3), rig.entry("r2", 1, "Intervalle", 55, 2), rig.entry("r3", 6, "Langer Lauf", null, 1)] as Array;
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.upcoming(again, true));
    Expect.equal(rig.lastHeader("If-None-Match"), "\"r1v1\"");
    rig.plan.pairing.transport.respond(304, null);
    Expect.equal(rig.sync.state, RunSync.RUN_DONE);
    Expect.equal(rig.cache.prescriptionTag("r1"), "r1v3");
    Expect.equal((rig.cache.prescription("r1") as Dictionary)["n"] as String, "Zone 2");
    return true;
}

(:test)
function errorsKeepWhatIsStoredAndNameTheProblem(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.open(rig.threeRuns(1), false);
    rig.answerAll(1);
    Expect.equal(rig.cache.healthConsent(), false);
    // no answer after the retries: unreachable, the runs stay
    rig.sync.start();
    rig.plan.exhaustRetries();
    Expect.equal(rig.sync.state, RunSync.RUN_FAILED);
    Expect.equal(rig.sync.problem, RunSync.RUN_PROBLEM_UNREACHABLE);
    Expect.equal(rig.cache.runs().size(), 3);
    Test.assert(rig.cache.prescription("r1") != null);
    // a malformed list is refused and changes nothing
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, { "api_version" => 1, "d" => "x", "hc" => true, "runs" => [] });
    Expect.equal(rig.sync.state, RunSync.RUN_FAILED);
    Expect.equal(rig.sync.problem, RunSync.RUN_PROBLEM_INVALID);
    Expect.equal(rig.cache.runs().size(), 3);
    // a run that vanished meanwhile (404): the others are still loaded, the state says one is missing
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.upcoming([rig.entry("r1", 0, "Zone 2", 45, 2), rig.entry("r2", 1, "Intervalle", 50, 2)] as Array, true));
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("VALIDATION_ERROR", false));
    rig.plan.pairing.transport.respond(200, rig.prescription("r2", "Intervalle"));
    Expect.equal(rig.sync.state, RunSync.RUN_FAILED);
    Expect.equal(rig.sync.missing, 1);
    Test.assert(rig.cache.prescription("r3") == null);   // no longer in the list: its copy is gone
    // 426 and 401
    rig.sync.start();
    rig.plan.pairing.transport.respond(426, rig.plan.errorBody("UPGRADE_REQUIRED", false));
    Expect.equal(rig.sync.problem, RunSync.RUN_PROBLEM_UPGRADE);
    rig.sync.start();
    rig.plan.pairing.transport.respond(401, rig.plan.errorBody("AUTH_REQUIRED", false));
    Expect.equal(rig.sync.problem, RunSync.RUN_PROBLEM_AUTH);
    Expect.equal(rig.rejected.count, 1);
    // setup not finished: nothing of the account stays
    rig.sync.start();
    rig.plan.pairing.transport.respond(409, rig.plan.errorBody("SETUP_REQUIRED", false));
    Expect.equal(rig.sync.problem, RunSync.RUN_PROBLEM_SETUP);
    Test.assert(!rig.cache.hasUpcoming());
    return true;
}

(:test)
function offlineTheStoredRunsAreStillThereAndTodayMovesOn(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.open(rig.threeRuns(1), true);
    rig.answerAll(1);
    // the app opens next day without any answer: the stored list and prescriptions serve the start
    var tomorrow = rig.plan.pairing.clock.now + 86400;
    rig.plan.pairing.clock.now = tomorrow;
    var fresh = new RunCache(rig.plan.pairing.store);
    Expect.equal(fresh.today(tomorrow, 0), "2026-11-15");
    var today = fresh.todayRuns(tomorrow, 0);
    Expect.equal(today.size(), 1);
    Expect.equal(today[0]["n"] as String, "Intervalle");
    Test.assert(fresh.prescription(today[0]["id"] as String) != null);
    // the day that passed is cleaned up with its prescription
    fresh.prune(tomorrow, 0);
    Expect.equal(fresh.runs().size(), 2);
    Test.assert(fresh.prescription("r1") == null);
    Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.runPrescription("r1")));
    // the heart rate consent stays as last told
    Expect.equal(fresh.healthConsent(), true);
    // the watch's time zone counts: an evening in Berlin is already the next day there
    rig.plan.pairing.clock.now = (RunDate.dayNumber("2026-11-14") as Number) * 86400 + 23 * 3600;
    Expect.equal(fresh.today(rig.plan.pairing.clock.now, 120), "2026-11-15");
    return true;
}

(:test)
function listLimitsAndForeignRunsAreNotStored(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.pairing.restartPaired();
    var eight = [] as Array;
    for (var i = 0; i < 8; i++) {
        eight.add(rig.entry("q" + i.toString(), i, "Lauf", 30, 1));
    }
    Test.assert(!rig.cache.putUpcoming(rig.upcoming(eight, true), 5000, 0));
    Test.assert(!rig.cache.hasUpcoming());
    var seven = [] as Array;
    for (var j = 0; j < 7; j++) {
        seven.add(rig.entry("q" + j.toString(), j, "Lauf", 30, 1));
    }
    Test.assert(rig.cache.putUpcoming(rig.upcoming(seven, true), 5000, 0));
    // a prescription only for a run of the list, with 1 to 80 segments
    Test.assert(!rig.cache.putPrescription("zz", "t", rig.prescription("zz", "x"), 5000));
    Test.assert(rig.cache.putPrescription("q0", "t", rig.prescription("q0", "x"), 5000));
    var many = rig.prescription("q1", "x");
    var segments = [] as Array;
    for (var k = 0; k < 81; k++) {
        segments.add([1, 1, 60, 0, 0, 0]);
    }
    var inner = many["p"] as Dictionary;
    inner["s"] = segments;
    Test.assert(!rig.cache.putPrescription("q1", "t", many, 5000));
    Test.assert(!rig.cache.putPrescription("q2", "t", rig.prescription("q3", "x"), 5000));   // other id inside
    // a new list drops the copies of runs that left it
    Test.assert(rig.cache.putUpcoming(rig.upcoming([rig.entry("q5", 0, "Lauf", 30, 1)] as Array, true), 5001, 0));
    Test.assert(rig.cache.prescription("q0") == null);
    Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.runPrescription("q0")));
    return true;
}

(:test)
function signingOutWipesThePlannedRuns(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.open(rig.threeRuns(1), true);
    rig.answerAll(1);
    new AccountWipe(rig.plan.cache, rig.cache, new HealthConsent(rig.plan.pairing.store), new HealthOutbox(rig.plan.pairing.store)).wipe();
    Test.assert(!rig.cache.hasUpcoming());
    Test.assert(rig.cache.healthConsent() == null);
    Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.runPrescription("r2")));
    return true;
}

(:test)
function startScreenShowsTodaysRunNextToTheTraining(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    // only a run today (plan loaded): both rows, the run is selected
    var rig = new RunRig();
    rig.plan.loadAll();
    Test.assert(rig.cache.putUpcoming(rig.upcoming(rig.threeRuns(1), true), rig.plan.pairing.clock.now, 0));
    var texts = rig.texts(dc);
    logger.debug(dc.getWidth() + " px, text width " + PairingLayout.textWidth(dc) + ": " + texts);
    Test.assert(texts.find("Heute") != null || texts.find("Today") != null);
    Test.assert(texts.find("Zone 2 · 45") != null);
    Test.assert(texts.find("Day d2") != null);                         // the training is there too
    Test.assert(texts.find("Intervalle") == null);                      // tomorrow's run is not "today"
    var rows = rig.home.stops(rig.plan.sync, new SessionPicker());
    Expect.equal(rows.size(), 4);                                       // training, free run, run, zone 2 (the free runs flank the run)
    Expect.equal(rows[0].kind, HomeStop.STOP_STRENGTH);
    Expect.equal(rows[1].kind, HomeStop.STOP_FREE);
    Expect.equal(rows[2].kind, HomeStop.STOP_RUN);
    Expect.equal(rows[3].kind, HomeStop.STOP_ZONE2);
    Expect.equal(rig.home.selectedIndex(rows, rig.plan.sync), 2);
    Test.assert(rows[1].labeled && rows[3].labeled && !rows[2].labeled);   // the free rows name themselves: no section header between them
    Test.assert(texts.find("Free run · Open") != null || texts.find("Freier Lauf · Frei") != null);
    Test.assert(texts.find("> ") != null);
    // minutes unknown stay unknown, never "0"
    Test.assert(rig.cache.putUpcoming(rig.upcoming([rig.entry("r9", 0, "Langer Lauf", null, 1)] as Array, true), rig.plan.pairing.clock.now, 0));
    var unknown = PlanScreens.joined(HomeScreen.stopLines(dc, rig.plan.sync, rig.home, new SessionPicker(), 0));
    Test.assert(unknown.find("Langer Lauf") != null);
    Test.assert(unknown.find("Langer Lauf ·") == null);
    return true;
}

(:test)
function startScreenWithoutPlanOrRunsStillOffersFreeRuns(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new RunRig();
    rig.plan.begin();
    rig.plan.exhaustRetries();                                          // no plan loaded, offline
    var rows = rig.home.stops(rig.plan.sync, new SessionPicker());
    Expect.equal(rows.size(), 3);                                       // (training row says why), free, zone 2
    Expect.equal(rig.home.selectedIndex(rows, rig.plan.sync), 1);       // free run is the default without a plan
    var texts = rig.texts(dc);
    Test.assert(texts.find("Frei") != null || texts.find("Open") != null);
    Test.assert(texts.find("Zone 2") != null);
    Expect.equal(rig.plan.sync.state, PlanSync.SYNC_FAILED);
    // setup open: same
    var setup = new RunRig();
    setup.plan.begin();
    setup.plan.pairing.transport.respond(409, setup.plan.errorBody("SETUP_REQUIRED", false));
    Expect.equal(setup.home.stops(setup.plan.sync, new SessionPicker()).size(), 3);
    return true;
}

(:test)
function startScreenKeepsItsSelectionWhenTheRunsRefresh(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.loadAll();
    var picker = new SessionPicker();
    Test.assert(rig.cache.putUpcoming(rig.upcoming(rig.threeRuns(1), true), rig.plan.pairing.clock.now, 0));
    var rows = rig.home.stops(rig.plan.sync, picker);
    rig.home.move(rows, rig.plan.sync, -1);                             // UP: free run (it sits above the run)
    Expect.equal(rig.home.selectedStop(rows, rig.plan.sync).kind, HomeStop.STOP_FREE);
    // new list without a run today: the selection stays on the free run
    Test.assert(rig.cache.putUpcoming(rig.upcoming([rig.entry("r2", 1, "Intervalle", 50, 1)] as Array, true), rig.plan.pairing.clock.now, 0));
    var after = rig.home.stops(rig.plan.sync, picker);
    Expect.equal(after.size(), 3);
    Expect.equal(rig.home.selectedStop(after, rig.plan.sync).kind, HomeStop.STOP_FREE);
    return true;
}

// A start screen delegate over the rig; keys are pressed as the watch does.
(:test)
class RunKeys {
    var rig as RunRig;
    var delegate as HomeDelegate;
    var launcher as TestLauncher;
    var presses as Number;

    function initialize(runRig as RunRig) {
        rig = runRig;
        var pairing = runRig.plan.pairing;
        launcher = new TestLauncher(new Journal(pairing.store), pairing.clock, new RecordingSignals(), PlayerRig.senderFor(pairing.store, pairing.clock));
        // every RunKeys is a fresh opening of the app: new selection, no workout in progress
        pairing.store.deleteValue(StoreKeys.ACTIVE_SESSION);
        var home = new RunHome(runRig.sync, pairing.clock, runRig.opener);
        delegate = new HomeDelegate(pairing.controller, runRig.plan.sync, new SessionPicker(), launcher, home);
        presses = 0;
    }

    function down() as Void {
        presses++;
        Test.assert(delegate.onNextPage());
    }

    function up() as Void {
        presses++;
        Test.assert(delegate.onPreviousPage());
    }

    function start() as Void {
        presses++;
        Test.assert(delegate.onSelect());
    }

    function opened() as Number {
        return rig.opener.requests.size();
    }

    function last() as PreStartRequest {
        return rig.opener.requests[rig.opener.requests.size() - 1];
    }
}

// From opening the app to the pre-start screen, answers from the stub: the plan and the runs are loaded as
// the app does when it opens; the keys then lead to the screen.
(:test)
function aPlannedRunIsOneKeyAwayAndEachFreeRunTwo(logger as Logger) as Boolean {
    // run planned today, plan loaded: START opens the run
    var rig = new RunRig();
    rig.plan.loadAll();
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.upcoming(rig.threeRuns(1), true));
    rig.answerAll(1);
    var keys = new RunKeys(rig);
    keys.start();
    Expect.equal(keys.opened(), 1);
    Expect.equal(keys.last().mode, PreStartRequest.MODE_PLANNED);
    Expect.equal(keys.last().runId, "r1");
    Expect.equal((keys.last().prescription as Dictionary)["n"] as String, "Zone 2");
    Expect.equal(keys.presses, 1);
    // free run: UP, START; free run in zone 2: DOWN, START (RUN-027: one key away each, so three keys to the start)
    var free = new RunKeys(rig);
    free.up();
    free.start();
    Expect.equal(free.last().mode, PreStartRequest.MODE_FREE);
    Expect.equal(free.presses, 2);
    var zone = new RunKeys(rig);
    zone.down();
    zone.start();
    Expect.equal(zone.last().mode, PreStartRequest.MODE_ZONE2);
    Expect.equal(zone.presses, 2);
    // the training of the plan is UP, UP, START away and starts as before
    var strength = new RunKeys(rig);
    strength.up();
    strength.up();
    strength.start();
    Expect.equal(strength.opened(), 3);                                 // (no further run screen)
    Expect.equal(strength.launcher.shown.size(), 1);
    Expect.equal(strength.launcher.shown[0].dayName(), "Day d2");
    return true;
}

(:test)
function withoutARunTodayEveryFreeRunIsAtMostTwoKeysAway(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.loadAll();
    var keys = new RunKeys(rig);                                        // training, free, zone 2; selected: training
    keys.start();
    Expect.equal(keys.launcher.shown.size(), 1);
    var free = new RunKeys(rig);
    free.down();
    free.start();
    Expect.equal(free.last().mode, PreStartRequest.MODE_FREE);
    Expect.equal(free.presses, 2);
    var zone = new RunKeys(rig);
    zone.up();                                                          // wraps around to the last row
    zone.start();
    Expect.equal(zone.last().mode, PreStartRequest.MODE_ZONE2);
    Expect.equal(zone.presses, 2);
    return true;
}

(:test)
function freeRunWorksWithoutPlanListOrConnection(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.begin();
    rig.plan.exhaustRetries();                                          // the plan did not load: offline
    rig.sync.start();
    rig.plan.exhaustRetries();                                          // neither did the runs
    Expect.equal(rig.sync.state, RunSync.RUN_FAILED);
    var keys = new RunKeys(rig);
    keys.start();                                                       // default row: free run
    Expect.equal(keys.last().mode, PreStartRequest.MODE_FREE);
    Expect.equal(keys.presses, 1);
    var zone = new RunKeys(rig);
    zone.down();
    zone.start();
    Expect.equal(zone.last().mode, PreStartRequest.MODE_ZONE2);
    return true;
}

(:test)
function aPlannedRunStartsFromTheStoredPrescriptionWithoutNetwork(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.loadAll();
    Test.assert(rig.cache.putUpcoming(rig.upcoming(rig.threeRuns(1), true), rig.plan.pairing.clock.now, 0));
    Test.assert(rig.cache.putPrescription("r1", "r1v1", rig.prescription("r1", "Zone 2"), rig.plan.pairing.clock.now));
    var sent = rig.plan.pairing.transport.sentCount();
    var keys = new RunKeys(rig);
    keys.start();
    Expect.equal(keys.last().runId, "r1");
    Expect.equal(rig.plan.pairing.transport.sentCount(), sent);          // nothing was asked for
    // a run whose prescription is not on the watch yet does not open an empty screen: the runs load again
    Test.assert(rig.cache.putUpcoming(rig.upcoming([rig.entry("r4", 0, "Tempo", 40, 1)] as Array, true), rig.plan.pairing.clock.now, 0));
    var before = keys.opened();
    keys.start();
    Expect.equal(keys.opened(), before);
    Expect.equal(rig.sync.state, RunSync.RUN_LOADING);
    return true;
}

// "Resume run?" on the start screen: the row is there while a run is cut off, first and selected, and START asks.
(:test)
function anInterruptedRunIsOfferedFirstOnTheStartScreen(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.loadAll();
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.upcoming(rig.threeRuns(1), true));
    rig.answerAll(1);
    // no journal, or no run in it: no row
    Test.assert(!rig.home.hasInterruptedRun());
    var sim = new RunSim(RunSim.prescription([RunSim.timed(60)] as Array, null), 0, false);
    rig.home.journal = sim.parts.journal;
    Test.assert(rig.home.hasInterruptedRun());
    var keys = new RunKeys(rig);
    keys.delegate = new HomeDelegate(rig.plan.pairing.controller, rig.plan.sync, new SessionPicker(), keys.launcher, rig.home);
    var rows = rig.home.stops(rig.plan.sync, new SessionPicker());
    Expect.equal(rows[0].kind, HomeStop.STOP_RUN_RESUME);
    Expect.equal(rows[1].kind, HomeStop.STOP_STRENGTH);
    Expect.equal(rig.home.selectedStop(rows, rig.plan.sync).kind, HomeStop.STOP_RUN_RESUME);
    // START asks "Resume run?", opens no pre-start screen
    keys.start();
    Expect.equal(rig.opener.resumes, 1);
    Expect.equal(keys.opened(), 0);
    // DOWN three times (past the training and the free run) leaves the row; START on the planned run opens the pre-start screen as before
    keys.down();
    keys.down();
    keys.down();
    keys.start();
    Expect.equal(rig.opener.resumes, 1);
    Expect.equal(keys.opened(), 1);
    Expect.equal(keys.last().mode, PreStartRequest.MODE_PLANNED);
    // a saved run is not offered, nor is a damaged one
    sim.session.save();
    Test.assert(!rig.home.hasInterruptedRun());
    var damaged = new RunSim(null, 0, false);
    rig.home.journal = damaged.parts.journal;
    Test.assert(rig.home.hasInterruptedRun());
    var broken = { "v" => 1 } as Dictionary<String, Number>;
    damaged.store.setValue(StoreKeys.runHead(damaged.session.uuid), broken as Application.Storage.ValueType);
    Test.assert(!rig.home.hasInterruptedRun());
    return true;
}
