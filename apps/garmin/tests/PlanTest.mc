import Toybox.Application;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Test;
import Toybox.WatchUi;

// Counts calls (401 handler, wipe hook).
(:test)
class CallCounter {
    var count as Number = 0;

    function initialize() {
    }

    function onCall() as Void {
        count++;
    }
}

// The plan cache and its loader on top of the pairing rig (fake network, timers, storage).
(:test)
class PlanRig {
    var pairing as PairingRig;
    var cache as PlanCache;
    var sync as PlanSync;
    var rejected as CallCounter;
    var changes as CallCounter;

    function initialize() {
        pairing = new PairingRig(false);
        cache = new PlanCache(pairing.store);
        rejected = new CallCounter();
        changes = new CallCounter();
        sync = new PlanSync(pairing.client, cache, pairing.clock, rejected.method(:onCall));
        sync.setObserver(changes.method(:onCall));
    }

    function tag(id as String, version as Number) as String {
        return "\"tag-" + id + "-v" + version.toString() + "\"";
    }

    // days: ids; next: id of the next day; version: tag version of every day.
    function directory(days as Array<String>, next as String, version as Number) as Dictionary {
        var entries = [] as Array;
        for (var i = 0; i < days.size(); i++) {
            entries.add({ "id" => days[i], "n" => "Day " + days[i], "c" => 6, "m" => 55, "tag" => tag(days[i], version) });
        }
        return { "api_version" => 1, "min_app_version" => "1.0.0", "p" => "plv_1", "next" => next, "days" => entries };
    }

    function dayBody(id as String) as Dictionary {
        return {
            "api_version" => 1, "min_app_version" => "1.0.0", "p" => "plv_1", "id" => id, "n" => "Day " + id,
            "cat" => [{ "id" => "ex_1", "n" => "Bankdrücken", "g" => 2500, "l" => { "b" => "total" }, "s" => [[4, 8, 60000]] }],
            "items" => [{ "id" => "it_1", "c" => 0, "r" => 120, "rr" => [6, 8] }]
        };
    }

    function recentBody() as Dictionary {
        return { "api_version" => 1, "min_app_version" => "1.0.0", "cat" => [{ "id" => "ex_9", "n" => "Rudern", "g" => 2500, "l" => { "b" => "total" }, "s" => [[3, 10, 50000]] }] };
    }

    function errorBody(code as String, retryable as Boolean) as Dictionary {
        return { "error" => { "code" => code, "retryable" => retryable, "message" => "x" } };
    }

    // The watch is connected and a run is started.
    function begin() as Void {
        pairing.restartPaired();
        sync.start();
    }

    function url(i as Number) as String {
        return pairing.transport.urls[i];
    }

    // Plan with days d1..d3 (next = d2) loaded completely through a normal run.
    function loadAll() as Void {
        begin();
        pairing.transport.respond(200, directory(["d1", "d2", "d3"], "d2", 1));
        pairing.transport.respond(200, dayBody("d2"));
        pairing.transport.respond(200, dayBody("d1"));
        pairing.transport.respond(200, dayBody("d3"));
        pairing.transport.respond(200, recentBody());
    }

    function setDay(dir as Dictionary, index as Number, key as String, value as Object or Null) as Void {
        var day = (dir["days"] as Array)[index] as Dictionary;
        day[key] = value;
    }

    // The client gives up after the retries of a request.
    function exhaustRetries() as Void {
        for (var i = 0; i < 3; i++) {
            pairing.transport.respond(503, null);
            pairing.clientTimer.fire();
        }
        pairing.transport.respond(503, null);
    }
}

(:test)
function planCacheStoresDirectoryAndDaysUnderOwnKeys(logger as Logger) as Boolean {
    var rig = new PlanRig();
    Test.assert(rig.cache.directory() == null);
    Test.assert(rig.cache.putDirectory(rig.directory(["d1", "d2"], "d2", 1), 5000));
    Test.assert(rig.cache.putDay("d1", rig.tag("d1", 1), rig.dayBody("d1"), 5001));
    Expect.equal(rig.cache.fetchedAt(), 5000);
    var dir = rig.cache.directory() as Dictionary;
    Expect.equal(dir["next"] as String, "d2");
    var days = dir["days"] as Array;
    Expect.equal(rig.cache.dayState(days[0] as Dictionary), PlanCache.DAY_LOADED);
    Expect.equal(rig.cache.dayState(days[1] as Dictionary), PlanCache.DAY_MISSING);
    Expect.equal(rig.cache.dayTag("d1"), rig.tag("d1", 1));
    var keys = rig.pairing.store.values.keys();
    Expect.equal(keys.size(), 2);   // plan and plan:day:d1, nothing else
    Test.assert(rig.pairing.store.values.hasKey(StoreKeys.PLAN));
    Test.assert(rig.pairing.store.values.hasKey(StoreKeys.planDay("d1")));
    // the response envelope is not kept
    Test.assert(!dir.hasKey("api_version"));
    Test.assert(!(rig.cache.day("d1") as Dictionary).hasKey("api_version"));
    Expect.equal((rig.cache.day("d1") as Dictionary)["n"] as String, "Day d1");
    return true;
}

(:test)
function planCacheMarksAChangedDayAsStale(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.cache.putDirectory(rig.directory(["d1"], "d1", 1), 5000);
    rig.cache.putDay("d1", rig.tag("d1", 1), rig.dayBody("d1"), 5000);
    rig.cache.putDirectory(rig.directory(["d1"], "d1", 2), 6000);
    var entry = ((rig.cache.directory() as Dictionary)["days"] as Array)[0] as Dictionary;
    Expect.equal(rig.cache.dayState(entry), PlanCache.DAY_STALE);
    Expect.equal(rig.cache.dayTag("d1"), rig.tag("d1", 1));   // the old tag is sent as If-None-Match
    return true;
}

(:test)
function planCacheRejectsMalformedAnswers(logger as Logger) as Boolean {
    var rig = new PlanRig();
    var noNext = rig.directory(["d1"], "d1", 1);
    noNext.remove("next");
    Test.assert(!rig.cache.putDirectory(noNext, 1));
    var noDays = rig.directory(["d1"], "d1", 1);
    noDays["days"] = [];
    Test.assert(!rig.cache.putDirectory(noDays, 1));
    var badMinutes = rig.directory(["d1"], "d1", 1);
    rig.setDay(badMinutes, 0, "m", "55");
    Test.assert(!rig.cache.putDirectory(badMinutes, 1));
    Expect.equal(rig.pairing.store.values.size(), 0);
    Test.assert(!rig.cache.putDay("d1", "t", rig.dayBody("other"), 1));   // id does not match
    var noItems = rig.dayBody("d1");
    noItems.remove("items");
    Test.assert(!rig.cache.putDay("d1", "t", noItems, 1));
    Test.assert(!rig.cache.putRecent({ "cat" => "x" }, 1));
    Expect.equal(rig.pairing.store.values.size(), 0);
    // unreadable stored entries count as not stored
    rig.pairing.store.setValue(StoreKeys.PLAN, "broken");
    rig.pairing.store.setValue(StoreKeys.planDay("d1"), { "tag" => 5 });
    Test.assert(rig.cache.directory() == null);
    Test.assert(rig.cache.day("d1") == null);
    return true;
}

(:test)
function planCacheKeepsUnknownMinutesUnknown(logger as Logger) as Boolean {
    var rig = new PlanRig();
    var dir = rig.directory(["d1"], "d1", 1);
    rig.setDay(dir, 0, "m", null);
    Test.assert(rig.cache.putDirectory(dir, 1));
    var day = ((rig.cache.directory() as Dictionary)["days"] as Array)[0] as Dictionary;
    var minutes = day["m"] as Object or Null;
    Test.assert(minutes == null);
    Test.assert(HomeScreen.minutesText(day) == null);
    Test.assert(HomeScreen.exercisesText(day).find("6") != null);
    return true;
}

(:test)
function planCacheDropsDaysThatLeftThePlan(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.cache.putDirectory(rig.directory(["d1", "d2"], "d1", 1), 1);
    rig.cache.putDay("d1", rig.tag("d1", 1), rig.dayBody("d1"), 1);
    rig.cache.putDay("d2", rig.tag("d2", 1), rig.dayBody("d2"), 1);
    rig.cache.putDirectory(rig.directory(["d2", "d3"], "d2", 1), 2);
    Test.assert(rig.cache.day("d1") == null);
    Test.assert(rig.cache.day("d2") != null);
    Test.assert(!rig.pairing.store.values.hasKey(StoreKeys.planDay("d1")));
    return true;
}

(:test)
function planCacheClearRemovesEverything(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    Test.assert(rig.pairing.store.values.size() > 1);
    rig.cache.clear();
    Test.assert(rig.cache.directory() == null);
    Test.assert(rig.cache.recent() == null);
    for (var i = 1; i <= 3; i++) {
        Test.assert(rig.cache.day("d" + i.toString()) == null);
    }
    // only the token of the connection is left
    Expect.equal(rig.pairing.store.values.size(), 1);
    Test.assert(rig.pairing.store.values.hasKey(StoreKeys.AUTH));
    return true;
}

(:test)
function planCacheSurvivesAnAppRestart(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    var again = new PlanCache(rig.pairing.store);
    Expect.equal(again.fetchedAt(), rig.cache.fetchedAt());
    Test.assert(again.day("d3") != null);
    Test.assert(again.recent() != null);
    return true;
}

(:test)
function planSyncLoadsDirectoryThenDaysOneByOne(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    Expect.equal(rig.sync.state, PlanSync.SYNC_LOADING);
    Expect.equal(rig.pairing.transport.sentCount(), 1);
    Expect.equal(rig.url(0), "http://mock/api/watch/v1/plan");
    Test.assert(!rig.pairing.transport.headers[0].hasKey("If-None-Match"));
    rig.pairing.clock.now += 7;
    rig.pairing.transport.respond(200, rig.directory(["d1", "d2", "d3"], "d2", 1));
    Expect.equal(rig.cache.fetchedAt(), rig.pairing.clock.now);
    // the next day first, one request at a time
    Expect.equal(rig.pairing.transport.sentCount(), 2);
    Expect.equal(rig.url(1), "http://mock/api/watch/v1/plan/sessions/d2");
    Test.assert(!rig.pairing.transport.headers[1].hasKey("If-None-Match"));
    rig.pairing.transport.respond(200, rig.dayBody("d2"));
    Expect.equal(rig.pairing.transport.sentCount(), 3);
    Expect.equal(rig.url(2), "http://mock/api/watch/v1/plan/sessions/d1");
    rig.pairing.transport.respond(200, rig.dayBody("d1"));
    Expect.equal(rig.url(3), "http://mock/api/watch/v1/plan/sessions/d3");
    rig.pairing.transport.respond(200, rig.dayBody("d3"));
    Expect.equal(rig.url(4), "http://mock/api/watch/v1/plan/recent");
    Expect.equal(rig.sync.state, PlanSync.SYNC_LOADING);
    rig.pairing.transport.respond(200, rig.recentBody());
    Expect.equal(rig.sync.state, PlanSync.SYNC_DONE);
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_NONE);
    var days = (rig.cache.directory() as Dictionary)["days"] as Array;
    for (var i = 0; i < days.size(); i++) {
        Expect.equal(rig.cache.dayState(days[i] as Dictionary), PlanCache.DAY_LOADED);
    }
    Expect.equal((rig.cache.recent() as Array).size(), 1);
    Test.assert(rig.changes.count > 0);
    return true;
}

(:test)
function planSyncLoadsOnlyDaysThatChanged(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    var before = rig.pairing.transport.sentCount();
    rig.sync.start();
    rig.pairing.transport.respond(200, rig.directory(["d1", "d2", "d3"], "d2", 1));   // nothing changed
    Expect.equal(rig.url(before + 1), "http://mock/api/watch/v1/plan/recent");        // no day requested
    rig.pairing.transport.respond(200, rig.recentBody());
    Expect.equal(rig.sync.state, PlanSync.SYNC_DONE);
    // one day changed on the server
    before = rig.pairing.transport.sentCount();
    var changed = rig.directory(["d1", "d2", "d3"], "d2", 1);
    rig.setDay(changed, 2, "tag", rig.tag("d3", 2));
    rig.sync.start();
    rig.pairing.transport.respond(200, changed);
    Expect.equal(rig.url(before + 1), "http://mock/api/watch/v1/plan/sessions/d3");
    Expect.equal(rig.pairing.transport.headers[before + 1]["If-None-Match"] as String, rig.tag("d3", 1));
    rig.pairing.transport.respond(200, rig.dayBody("d3"));
    Expect.equal(rig.cache.dayTag("d3"), rig.tag("d3", 2));
    return true;
}

(:test)
function planSyncKeepsAStoredDayOnNotModified(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    var changed = rig.directory(["d1", "d2", "d3"], "d2", 1);
    rig.setDay(changed, 0, "tag", rig.tag("d1", 2));
    rig.sync.start();
    rig.pairing.transport.respond(200, changed);
    rig.pairing.transport.respond(304, null);
    var entry = ((rig.cache.directory() as Dictionary)["days"] as Array)[0] as Dictionary;
    Expect.equal(rig.cache.dayState(entry), PlanCache.DAY_LOADED);
    Test.assert(rig.cache.day("d1") != null);
    return true;
}

(:test)
function planSyncWithoutConnectionKeepsTheStoredPlan(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    rig.sync.start();
    rig.exhaustRetries();
    Expect.equal(rig.sync.state, PlanSync.SYNC_FAILED);
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_UNREACHABLE);
    Test.assert(rig.cache.directory() != null);
    Test.assert(rig.cache.day("d2") != null);
    Expect.equal(rig.pairing.client.pendingCount(), 0);   // nothing is left to be sent later
    // and a later run works again
    rig.sync.start();
    Expect.equal(rig.sync.state, PlanSync.SYNC_LOADING);
    return true;
}

(:test)
function planSyncKeepsLoadedDaysWhenALaterOneFails(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(200, rig.directory(["d1", "d2"], "d1", 1));
    rig.pairing.transport.respond(200, rig.dayBody("d1"));
    rig.exhaustRetries();    // d2 does not arrive
    Expect.equal(rig.sync.state, PlanSync.SYNC_FAILED);
    Test.assert(rig.cache.day("d1") != null);
    Test.assert(rig.cache.day("d2") == null);
    return true;
}

(:test)
function planSyncReportsAMissingPhone(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    Test.assert(!rig.sync.isPhoneMissing());
    rig.pairing.transport.respond(-104, null);
    Test.assert(rig.sync.isPhoneMissing());
    Expect.equal(rig.sync.state, PlanSync.SYNC_LOADING);   // keeps trying
    rig.pairing.clientTimer.fire();                        // 30 s later
    rig.pairing.transport.respond(200, rig.directory(["d1"], "d1", 1));
    Test.assert(!rig.sync.isPhoneMissing());
    Expect.equal(rig.url(2), "http://mock/api/watch/v1/plan/sessions/d1");
    return true;
}

(:test)
function planSyncNoActivePlanClearsTheStoredPlan(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    rig.sync.start();
    rig.pairing.transport.respond(404, rig.errorBody("NO_ACTIVE_PLAN", false));
    Expect.equal(rig.sync.state, PlanSync.SYNC_FAILED);
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_NO_PLAN);
    Test.assert(rig.cache.directory() == null);
    Test.assert(rig.cache.day("d1") == null);
    Expect.equal(rig.rejected.count, 0);
    return true;
}

(:test)
function planSyncSetupRequiredIsReported(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(409, rig.errorBody("SETUP_REQUIRED", false));
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_SETUP);
    Test.assert(rig.cache.directory() == null);
    return true;
}

(:test)
function planSyncUnauthorizedAsksToConnectAgain(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    rig.sync.start();
    rig.pairing.transport.respond(401, rig.errorBody("AUTH_REQUIRED", false));
    Expect.equal(rig.sync.state, PlanSync.SYNC_FAILED);
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_AUTH);
    Expect.equal(rig.rejected.count, 1);
    Test.assert(rig.cache.directory() != null);   // the plan stays until another connection replaces it
    return true;
}

(:test)
function planSyncUpgradeRequiredIsReported(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(426, rig.errorBody("UPGRADE_REQUIRED", false));
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_UPGRADE);
    return true;
}

(:test)
function planSyncRestartsOnceWhenADayLeftThePlan(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(200, rig.directory(["d1", "d2"], "d1", 1));
    rig.pairing.transport.respond(404, rig.errorBody("VALIDATION_ERROR", false));   // d1 is gone
    Expect.equal(rig.url(2), "http://mock/api/watch/v1/plan");                       // directory again
    rig.pairing.transport.respond(200, rig.directory(["d2"], "d2", 1));
    Expect.equal(rig.url(3), "http://mock/api/watch/v1/plan/sessions/d2");
    rig.pairing.transport.respond(200, rig.dayBody("d2"));
    rig.pairing.transport.respond(200, rig.recentBody());
    Expect.equal(rig.sync.state, PlanSync.SYNC_DONE);
    Test.assert(rig.cache.day("d2") != null);
    return true;
}

(:test)
function planSyncDoesNotRestartForeverWhenDaysKeepVanishing(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(200, rig.directory(["d1", "d2"], "d1", 1));
    rig.pairing.transport.respond(404, rig.errorBody("VALIDATION_ERROR", false));
    rig.pairing.transport.respond(200, rig.directory(["d1", "d2"], "d1", 1));
    rig.pairing.transport.respond(404, rig.errorBody("VALIDATION_ERROR", false));   // second time: skipped
    Expect.equal(rig.url(4), "http://mock/api/watch/v1/plan/sessions/d2");
    rig.pairing.transport.respond(200, rig.dayBody("d2"));
    rig.pairing.transport.respond(200, rig.recentBody());
    Expect.equal(rig.sync.state, PlanSync.SYNC_FAILED);   // d1 could not be loaded
    Expect.equal(rig.sync.missingDays, 1);
    Test.assert(rig.cache.day("d2") != null);
    return true;
}

(:test)
function planSyncIgnoresAnUnreadableDirectory(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    rig.sync.start();
    rig.pairing.transport.respond(200, { "p" => "x" });
    Expect.equal(rig.sync.problem, PlanSync.PROBLEM_INVALID);
    Test.assert(rig.cache.directory() != null);   // the stored plan is untouched
    return true;
}

(:test)
function planSyncRecentIsOnlyABonus(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(200, rig.directory(["d1"], "d1", 1));
    rig.pairing.transport.respond(200, rig.dayBody("d1"));
    rig.pairing.transport.respond(400, rig.errorBody("VALIDATION_ERROR", false));
    Expect.equal(rig.sync.state, PlanSync.SYNC_DONE);
    Test.assert(rig.cache.recent() == null);
    return true;
}

(:test)
function planSyncStartWhileLoadingDoesNothing(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.sync.start();
    Expect.equal(rig.pairing.transport.sentCount(), 1);
    return true;
}

(:test)
function planSyncOldRunAnswerIsIgnored(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.begin();
    rig.pairing.transport.respond(401, rig.errorBody("AUTH_REQUIRED", false));   // run 1 ends
    rig.sync.start();                                                              // run 2
    var sent = rig.pairing.transport.sentCount();
    rig.pairing.transport.respond(200, rig.directory(["d1"], "d1", 1));
    Expect.equal(rig.pairing.transport.sentCount(), sent + 1);
    Expect.equal(rig.sync.state, PlanSync.SYNC_LOADING);
    return true;
}

(:test)
function sessionPickerStartsAtTheNextDayAndWraps(logger as Logger) as Boolean {
    var rig = new PlanRig();
    var dir = rig.directory(["d1", "d2", "d3"], "d2", 1);
    var picker = new SessionPicker();
    Expect.equal(picker.selectedIndex(dir), 1);
    Test.assert(picker.isNextDay(dir));
    picker.move(dir, 1);
    Expect.equal((picker.selectedDay(dir) as Dictionary)["id"] as String, "d3");
    Test.assert(!picker.isNextDay(dir));
    picker.move(dir, 1);
    Expect.equal(picker.selectedIndex(dir), 0);   // wraps around
    picker.move(dir, -1);
    Expect.equal(picker.selectedIndex(dir), 2);
    Expect.equal(picker.selectedIndex(null), -1);
    Test.assert(picker.selectedDay(null) == null);
    picker.move(null, 1);
    return true;
}

(:test)
function sessionPickerKeepsItsDayWhenThePlanRefreshes(logger as Logger) as Boolean {
    var rig = new PlanRig();
    var picker = new SessionPicker();
    var dir = rig.directory(["d1", "d2", "d3"], "d1", 1);
    picker.move(dir, 1);
    picker.move(dir, 1);                                       // d3
    var refreshed = rig.directory(["d1", "d2", "d3"], "d2", 1);   // the next day changed on the server
    Expect.equal((picker.selectedDay(refreshed) as Dictionary)["id"] as String, "d3");
    var shorter = rig.directory(["d1", "d2"], "d2", 1);          // d3 left the plan
    Expect.equal((picker.selectedDay(shorter) as Dictionary)["id"] as String, "d2");
    return true;
}

(:test)
function homeScreenShowsTheSelectedDay(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    var dc = PairingScreens.deviceDc();
    var picker = new SessionPicker();
    var lines = HomeScreen.lines(dc, rig.sync, picker, rig.pairing.clock.now + 7200);
    var texts = PlanScreens.joined(lines);
    Test.assertMessage(texts.find("Day d2") != null, texts);
    Test.assertMessage(texts.find("6") != null, texts);
    Test.assertMessage(texts.find("55") != null, texts);
    Test.assertMessage(texts.find("2") != null, texts);
    // another day
    picker.move(rig.cache.directory(), 1);
    texts = PlanScreens.joined(HomeScreen.lines(dc, rig.sync, picker, rig.pairing.clock.now));
    Test.assertMessage(texts.find("Day d3") != null, texts);
    Test.assertMessage(texts.find("3") != null, texts);
    return true;
}

(:test)
function homeScreenSaysWhenADayIsNotLoadedYet(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.cache.putDirectory(rig.directory(["d1", "d2"], "d1", 1), rig.pairing.clock.now);
    var dc = PairingScreens.deviceDc();
    var texts = PlanScreens.joined(HomeScreen.lines(dc, rig.sync, new SessionPicker(), rig.pairing.clock.now));
    Test.assertMessage(texts.find(WatchUi.loadResource(Rez.Strings.HomeDayNotLoaded) as String) != null, texts);
    return true;
}

(:test)
function homeScreenExplainsNoPlanAndSetup(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var none = new PlanRig();
    none.begin();
    var loading = PlanScreens.joined(HomeScreen.lines(dc, none.sync, new SessionPicker(), 0));
    Test.assertMessage(loading.find(WatchUi.loadResource(Rez.Strings.HomeLoading) as String) != null, loading);
    none.pairing.transport.respond(404, none.errorBody("NO_ACTIVE_PLAN", false));
    var noPlan = PlanScreens.joined(HomeScreen.lines(dc, none.sync, new SessionPicker(), 0));
    Test.assertMessage(noPlan.find(WatchUi.loadResource(Rez.Strings.HomeNoPlan) as String) != null, noPlan);

    var setup = new PlanRig();
    setup.begin();
    setup.pairing.transport.respond(409, setup.errorBody("SETUP_REQUIRED", false));
    var setupText = PlanScreens.joined(HomeScreen.lines(dc, setup.sync, new SessionPicker(), 0));
    Test.assertMessage(setupText.find(WatchUi.loadResource(Rez.Strings.HomeSetup) as String) != null, setupText);

    var offline = new PlanRig();
    offline.begin();
    offline.exhaustRetries();
    var offlineText = PlanScreens.joined(HomeScreen.lines(dc, offline.sync, new SessionPicker(), 0));
    Test.assertMessage(offlineText.find(WatchUi.loadResource(Rez.Strings.HomeNoPlanLoaded) as String) != null, offlineText);
    return true;
}

(:test)
function homeScreenShowsStoredPlanOfflineWithItsAge(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    rig.sync.start();
    rig.exhaustRetries();
    var dc = PairingScreens.deviceDc();
    var texts = PlanScreens.joined(HomeScreen.lines(dc, rig.sync, new SessionPicker(), rig.pairing.clock.now + 3 * 86400));
    Test.assertMessage(texts.find("Day d2") != null, texts);   // the training is still possible
    var expected = Lang.format(WatchUi.loadResource(Rez.Strings.HomePlanAgeOffline) as String, [HomeScreen.ageText(3 * 86400)]);
    Test.assertMessage(texts.find(expected) != null, texts);
    return true;
}

(:test)
function homeScreenPlanAgeText(logger as Logger) as Boolean {
    Expect.equal(HomeScreen.ageText(10), WatchUi.loadResource(Rez.Strings.AgeNow) as String);
    Expect.equal(HomeScreen.ageText(-5), WatchUi.loadResource(Rez.Strings.AgeNow) as String);
    Test.assert(HomeScreen.ageText(120).find("2") != null);
    Test.assert(HomeScreen.ageText(3600 * 5).find("5") != null);
    Test.assert(HomeScreen.ageText(86400 * 4).find("4") != null);
    Test.assert(!HomeScreen.ageText(3599).equals(HomeScreen.ageText(3600)));
    return true;
}

(:test)
function homeScreenCountsOneExerciseCorrectly(logger as Logger) as Boolean {
    var one = { "id" => "d", "n" => "x", "c" => 1, "m" => 30, "tag" => "t" };
    var many = { "id" => "d", "n" => "x", "c" => 7, "m" => 30, "tag" => "t" };
    Test.assert(!HomeScreen.exercisesText(one).equals(HomeScreen.exercisesText(many)));
    Test.assert(HomeScreen.exercisesText(one).find("1") == 0);
    Test.assert(HomeScreen.exercisesText(many).find("7") == 0);
    Test.assert((HomeScreen.minutesText(one) as String).find("30") != null);
    return true;
}

(:test)
function homeViewDrawsEveryPlanState(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var drawn = 0;
    var full = new PlanRig();
    full.loadAll();
    var picker = new SessionPicker();
    PairingLayout.draw(dc, HomeScreen.lines(dc, full.sync, picker, full.pairing.clock.now));
    drawn++;
    picker.move(full.cache.directory(), 1);
    PairingLayout.draw(dc, HomeScreen.lines(dc, full.sync, picker, full.pairing.clock.now + 90000));
    drawn++;
    full.sync.start();      // updating
    PairingLayout.draw(dc, HomeScreen.lines(dc, full.sync, picker, full.pairing.clock.now));
    drawn++;
    full.pairing.transport.respond(-104, null);   // phone missing
    PairingLayout.draw(dc, HomeScreen.lines(dc, full.sync, picker, full.pairing.clock.now));
    drawn++;
    var long = new PlanRig();
    var dir = long.directory(["d1"], "d1", 1);
    long.setDay(dir, 0, "n", "Oberkörper Schwerpunkt Brust und Schulter Woche 12");
    long.cache.putDirectory(dir, long.pairing.clock.now);
    PairingLayout.draw(dc, HomeScreen.lines(dc, long.sync, new SessionPicker(), long.pairing.clock.now));
    drawn++;
    var empty = new PlanRig();
    empty.begin();
    PairingLayout.draw(dc, HomeScreen.lines(dc, empty.sync, new SessionPicker(), 0));
    drawn++;
    Expect.equal(drawn, 6);
    return true;
}

(:test)
function homeDelegateMovesTheDayAndLoadsAMissingPlan(logger as Logger) as Boolean {
    var rig = new PlanRig();
    rig.loadAll();
    var picker = new SessionPicker();
    var delegate = new HomeDelegate(rig.pairing.controller, rig.sync, picker);
    Expect.equal(picker.selectedIndex(rig.cache.directory()), 1);
    Test.assert(delegate.onNextPage());
    Expect.equal(picker.selectedIndex(rig.cache.directory()), 2);
    Test.assert(delegate.onPreviousPage());
    Test.assert(delegate.onPreviousPage());
    Expect.equal(picker.selectedIndex(rig.cache.directory()), 0);
    // START with everything loaded does not touch the network
    var sent = rig.pairing.transport.sentCount();
    Test.assert(delegate.onSelect());
    Expect.equal(rig.pairing.transport.sentCount(), sent);
    // after a failure START loads again
    rig.sync.start();
    rig.exhaustRetries();
    Test.assert(delegate.onSelect());
    Expect.equal(rig.sync.state, PlanSync.SYNC_LOADING);
    return true;
}

(:test)
function homeDelegateStartsPairingWhenNotConnected(logger as Logger) as Boolean {
    var rig = new PlanRig();
    var delegate = new HomeDelegate(rig.pairing.controller, rig.sync, new SessionPicker());
    Test.assert(!delegate.onNextPage());     // no day to choose yet
    Test.assert(delegate.onSelect());
    Expect.equal(rig.pairing.controller.state, PairingController.STATE_PAIRING);
    return true;
}

(:test)
function pairingWipesThePlanOnSignOutAndOnNewConnection(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    var wipes = new CallCounter();
    rig.restartPaired();
    rig.controller.setWipeHook(wipes.method(:onCall));
    rig.controller.signOut();
    rig.transport.respond(200, { "unpaired" => true });
    Expect.equal(wipes.count, 1);
    // a failed sign-out keeps the plan
    var other = new PairingRig(false);
    var kept = new CallCounter();
    other.restartPaired();
    other.controller.setWipeHook(kept.method(:onCall));
    other.controller.signOut();
    other.transport.respond(400, null);
    Expect.equal(kept.count, 0);
    // connecting wipes before the new token is used
    var third = new PairingRig(false);
    var fresh = new CallCounter();
    third.controller.setWipeHook(fresh.method(:onCall));
    third.showCode();
    third.tick(5);
    third.transport.respond(200, third.tokenAnswer());
    Expect.equal(fresh.count, 1);
    // an expired token (401) keeps the plan: the same person usually connects again
    var expired = new PairingRig(false);
    var stays = new CallCounter();
    expired.restartPaired();
    expired.controller.setWipeHook(stays.method(:onCall));
    expired.controller.onAuthRejected();
    Expect.equal(stays.count, 0);
    return true;
}

(:test)
function apiClientRemembersTheLastAnswerCode(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock", transport, new FakeScheduler());
    Expect.equal(client.lastCode, 0);
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/a", null, new CallRecorder().method(:onDone)));
    transport.respond(-104, null);
    Expect.equal(client.lastCode, -104);
    return true;
}

// Helpers of the plan tests (a module, so the test runner does not take them for tests).
(:test)
module PlanScreens {
    function joined(lines as Array<PairingLine>) as String {
        var out = "";
        for (var i = 0; i < lines.size(); i++) {
            out += lines[i].text + "|";
        }
        return out;
    }
}
