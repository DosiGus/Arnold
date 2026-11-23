import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Test;

// MOB-008: the mobility cache, its loader and the plan confirmation with `mv`.
// The start screen with the mobility rows is tested in LayoutTest.mc. The tests are kept short on purpose:
// the test build of the fr255 may use 90 % of the memory (RunSessionTest.mc) and every line of tests counts.

// The mobility loader on top of the plan rig (fake network, timers, storage). Ids end in 1 to 6.
(:test)
class MobilityRig {
    const TODAY as String = "2026-11-23";   // a Monday
    const MV as String = "9f3a1c5e7b2d4a60";
    var plan as PlanRig;
    var cache as MobilityCache;
    var sync as MobilitySync;
    var rejected as CallCounter;

    function initialize() {
        plan = new PlanRig();
        rejected = new CallCounter();
        cache = new MobilityCache(plan.pairing.store);
        sync = new MobilitySync(plan.pairing.client, cache, plan.pairing.clock, rejected.method(:onCall));
        plan.pairing.clock.now = (RunDate.dayNumber(TODAY) as Number) * 86400 + 36000;   // 10:00 UTC
    }

    function id(n as Number) as String {
        return "s_00000000-0000-4000-8000-00000000000" + n.toString();
    }

    function tag(n as Number, version as Number) as String {
        return "mt" + n.toString() + "v" + version.toString();
    }

    // One entry of the list: kind "m" or "s", weekday mask, the strength session it follows (or null).
    function item(n as Number, kind as String, name as String, minutes as Number, weekdays as Number, after as String or Null, done as Boolean, version as Number) as Dictionary {
        var entry = { "id" => id(n), "k" => kind, "n" => name, "m" => minutes, "w" => weekdays, "a" => after, "dn" => done, "tag" => tag(n, version) };
        return entry;
    }

    function list(items as Array, mark as String) as Dictionary {
        return { "api_version" => 1, "min_app_version" => "1.0.0", "d" => TODAY, "mv" => mark, "items" => items };
    }

    function threeItems(version as Number) as Array {
        return [item(1, "m", "Morgenroutine", 10, 127, null, false, version), item(2, "s", "Nach Kraft", 20, 127, "d1", false, version),
            item(3, "s", "Hüfte öffnen", 15, 127, null, false, version)] as Array;
    }

    function exercise(sides as Number, seconds as Number) as Dictionary {
        var ex = { "c" => "mob_cat_cow", "n" => "Katze-Kuh", "h" => "Ruhig atmen", "s" => sides, "t" => seconds, "r" => null };
        return ex;
    }

    function routine(n as Number, total as Number) as Dictionary {
        return { "api_version" => 1, "min_app_version" => "1.0.0", "id" => id(n), "tot" => total, "ex" => [exercise(1, 85), exercise(2, 50)] as Array };
    }

    // The loader runs on a connected watch and the list is answered.
    function open(items as Array) as Void {
        plan.pairing.restartPaired();
        sync.start();
        plan.pairing.transport.respond(200, list(items, MV));
    }

    // A complete run with three entries (the tags of version 1).
    function loadAll() as Void {
        open(threeItems(1));
        for (var n = 1; n <= 3; n++) {
            plan.pairing.transport.respond(200, routine(n, 600));
        }
    }

    function url(i as Number) as String {
        return plan.pairing.transport.urls[i];
    }

    function sent() as Number {
        return plan.pairing.transport.sentCount();
    }

    // The list with one field of the first entry changed.
    function withFirst(key as String, value as Object or Null) as Dictionary {
        var items = threeItems(1);
        var first = items[0] as Dictionary;
        first[key] = value;
        return list(items, MV);
    }

    // The plan loader runs (with the mobility mark of this rig) and ends with the confirmation: its body.
    function confirmation() as Dictionary {
        plan.sync.setMobilityMark(sync.method(:ackMark));
        var before = sent();
        plan.begin();
        plan.pairing.transport.respond(200, plan.directoryWithMark(["d1"], "d1"));
        plan.pairing.transport.respond(200, plan.dayBody("d1"));
        plan.pairing.transport.respond(200, plan.recentBody());
        Expect.equal(url(before + 3), "http://mock/api/watch/v1/plan/ack");
        return plan.pairing.transport.requests[before + 3].body as Dictionary;
    }
}

(:test)
function mobilityCacheChecksTheShapeOfTheList(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    Test.assert(MobilityCache.isList(rig.list(rig.threeItems(1), rig.MV)));
    Test.assert(MobilityCache.isList(rig.list([] as Array, rig.MV)));     // no entries is a valid list
    var six = [] as Array;
    for (var n = 1; n <= 6; n++) {
        six.add(rig.item(n, "s", "Eintrag", 10, 127, null, false, 1));
    }
    Test.assert(!MobilityCache.isList(rig.list(six, rig.MV)));            // at most five entries
    six.remove(six[5]);
    Test.assert(MobilityCache.isList(rig.list(six, rig.MV)));
    var noDate = rig.list(rig.threeItems(1), rig.MV);
    noDate["d"] = "not-a-date";
    Test.assert(!MobilityCache.isList(noDate));
    var noMark = rig.list(rig.threeItems(1), rig.MV);
    noMark["mv"] = 5;
    Test.assert(!MobilityCache.isList(noMark));
    Test.assert(!MobilityCache.isList(null));
    var bad = [["id", null], ["k", "x"], ["n", 3], ["m", 0], ["w", 0], ["w", 128], ["dn", "no"], ["a", 7], ["tag", null]] as Array;
    for (var i = 0; i < bad.size(); i++) {
        var pair = bad[i] as Array;
        Test.assertMessage(!MobilityCache.isList(rig.withFirst(pair[0] as String, pair[1] as Object or Null)), "entry with " + (pair[0] as String));
    }
    Test.assert(MobilityCache.isList(rig.withFirst("a", "d1")));
    Test.assert(MobilityCache.isList(rig.withFirst("w", 1)));
    return true;
}

(:test)
function mobilityCacheChecksTheShapeOfARoutine(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    Test.assert(MobilityCache.isRoutine(rig.routine(1, 600)));
    var routine = rig.routine(1, 600);
    var many = [] as Array;
    routine["ex"] = many;
    Test.assert(!MobilityCache.isRoutine(routine));                       // at least one exercise
    for (var i = 0; i < 15; i++) {
        many.add(rig.exercise(1, 30));
    }
    Test.assert(MobilityCache.isRoutine(routine));                        // 15 are the limit
    many.add(rig.exercise(1, 30));
    Test.assert(!MobilityCache.isRoutine(routine));
    Test.assert(!MobilityCache.isExercise(rig.exercise(3, 30)));          // one or two sides
    Test.assert(!MobilityCache.isExercise(rig.exercise(1, 0)));           // at least a second
    var reps = rig.exercise(1, 30);
    reps["r"] = "8";
    Test.assert(!MobilityCache.isExercise(reps));
    reps["r"] = 8;
    Test.assert(MobilityCache.isExercise(reps));
    return true;
}

(:test)
function mobilityCacheKeepsOnlyKnownFields(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    var items = rig.threeItems(1);
    var raw = items[0] as Dictionary;
    raw["extra"] = "ignored";
    var body = rig.list(items, rig.MV);
    body["whatever"] = 5;
    Test.assert(rig.cache.putToday(body, 5000));
    Expect.equal((rig.cache.today() as Dictionary).size(), 4);               // d, mv, at, items
    Expect.equal((rig.cache.item(rig.id(1)) as Dictionary).size(), 8);
    Expect.equal(rig.cache.mark(), rig.MV);
    Expect.equal(rig.cache.listDate(), rig.TODAY);
    var routine = rig.routine(1, 600);
    routine["secret"] = 1;
    var exercise = (routine["ex"] as Array)[0] as Dictionary;
    exercise["zz"] = 2;
    Test.assert(rig.cache.putRoutine(rig.id(1), rig.tag(1, 1), routine, 5001));
    var kept = rig.cache.routine(rig.id(1)) as Dictionary;
    Expect.equal(kept.size(), 3);                                            // id, tot, ex
    Expect.equal(((kept["ex"] as Array)[0] as Dictionary).size(), 6);
    return true;
}

(:test)
function mobilityCacheLeavesTheOldStateOnABrokenAnswer(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    Test.assert(rig.cache.putToday(rig.list(rig.threeItems(1), rig.MV), 5000));
    Test.assert(rig.cache.putRoutine(rig.id(1), rig.tag(1, 1), rig.routine(1, 600), 5000));
    Test.assert(!rig.cache.putToday(rig.withFirst("w", 0), 6000));
    Expect.equal(rig.cache.items().size(), 3);
    Expect.field(rig.cache.today() as Dictionary, "at", 5000);
    var broken = rig.routine(1, 700);
    broken["ex"] = [] as Array;
    Test.assert(!rig.cache.putRoutine(rig.id(1), rig.tag(1, 2), broken, 6000));
    Test.assert(!rig.cache.putRoutine(rig.id(1), rig.tag(1, 2), rig.routine(2, 700), 6000));   // another id inside
    Expect.equal(rig.cache.routineTag(rig.id(1)), rig.tag(1, 1));
    Expect.field(rig.cache.routine(rig.id(1)) as Dictionary, "tot", 600);
    rig.plan.pairing.store.setValue(StoreKeys.MOB_TODAY, "damaged");       // damaged storage counts as "nothing stored"
    Test.assert(!rig.cache.hasToday());
    Expect.equal(rig.cache.items().size(), 0);
    return true;
}

(:test)
function mobilityCacheDropsRoutinesThatLeftTheList(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.cache.putToday(rig.list(rig.threeItems(1), rig.MV), 5000);
    for (var n = 1; n <= 3; n++) {
        rig.cache.putRoutine(rig.id(n), rig.tag(n, 1), rig.routine(n, 600), 5000);
    }
    Test.assert(rig.cache.isComplete());
    Test.assert(rig.cache.putToday(rig.list([rig.item(1, "m", "Morgenroutine", 10, 127, null, false, 1)] as Array, rig.MV), 6000));
    Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.mobRoutine(rig.id(2))));
    Test.assert(rig.cache.isComplete());
    // a new tag makes the stored copy stale
    rig.cache.putToday(rig.list([rig.item(1, "m", "Morgenroutine", 10, 127, null, false, 2)] as Array, rig.MV), 7000);
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(1)) as Dictionary), MobilityCache.ROUTINE_STALE);
    Test.assert(rig.cache.completeMark() == null);
    return true;
}

(:test)
function mobilitySyncLoadsTheListAndThenEveryRoutine(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.plan.pairing.restartPaired();
    rig.sync.start();
    Expect.equal(rig.url(0), "http://mock/api/watch/v1/mobility/today");
    rig.sync.start();                                        // a run in progress is not started twice
    Expect.equal(rig.sent(), 1);
    rig.plan.pairing.transport.respond(200, rig.list(rig.threeItems(1), rig.MV));
    Expect.equal(rig.url(1), "http://mock/api/watch/v1/mobility/" + rig.id(1));
    Test.assert(!rig.plan.pairing.transport.headers[1].hasKey("If-None-Match"));     // nothing stored yet
    for (var n = 1; n <= 3; n++) {
        Test.assert(rig.sync.ackMark() == null);             // not finished yet
        rig.plan.pairing.transport.respond(200, rig.routine(n, 600 + n));
    }
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_NONE);
    Expect.equal(rig.sent(), 4);
    Expect.equal(rig.sync.ackMark(), rig.MV);
    Expect.field(rig.cache.routine(rig.id(2)) as Dictionary, "tot", 602);
    Expect.equal(rig.plan.pairing.client.pendingCount(), 0);
    return true;
}

(:test)
function mobilitySyncAsksOnlyForRoutinesThatChangedAndTakes304(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var before = rig.sent();
    rig.sync.start();                                        // only entry 2 has a new tag
    var items = rig.threeItems(1);
    items[1] = rig.item(2, "s", "Nach Kraft", 20, 127, "d1", false, 2);
    rig.plan.pairing.transport.respond(200, rig.list(items, "cccccccccccccccc"));
    Expect.equal(rig.sent(), before + 2);                    // the list and one routine
    Expect.equal(rig.url(before + 1), "http://mock/api/watch/v1/mobility/" + rig.id(2));
    Expect.equal(rig.plan.pairing.transport.headers[before + 1]["If-None-Match"] as String, "\"" + rig.tag(2, 1) + "\"");
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(2)) as Dictionary), MobilityCache.ROUTINE_STALE);
    rig.plan.pairing.transport.respond(304, null);           // the stored routine is current: it gets the new tag
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Expect.equal(rig.cache.routineTag(rig.id(2)), rig.tag(2, 2));
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(2)) as Dictionary), MobilityCache.ROUTINE_LOADED);
    Expect.field(rig.cache.routine(rig.id(2)) as Dictionary, "tot", 600);
    Expect.equal(rig.sync.ackMark(), "cccccccccccccccc");
    Expect.equal(rig.sent(), before + 2);
    return true;
}

(:test)
function mobilitySyncKeepsTheOldStateOnABrokenAnswer(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var before = rig.sent();
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, { "api_version" => 1, "d" => "x" });   // not a list
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_INVALID);
    Expect.equal(rig.sent(), before + 1);                    // no routine was asked for
    Expect.equal(rig.cache.items().size(), 3);
    Test.assert(rig.cache.isComplete() && rig.sync.available && rig.sync.ackMark() == null);
    rig.sync.start();                                        // a routine is broken: the old copy stays
    var items = rig.threeItems(1);
    items[2] = rig.item(3, "s", "Hüfte öffnen", 15, 127, null, false, 2);
    rig.plan.pairing.transport.respond(200, rig.list(items, "eeeeeeeeeeeeeeee"));
    var broken = rig.routine(3, 800);
    broken["ex"] = [] as Array;
    rig.plan.pairing.transport.respond(200, broken);
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.cache.routineTag(rig.id(3)), rig.tag(3, 1));
    Expect.field(rig.cache.routine(rig.id(3)) as Dictionary, "tot", 600);
    return true;
}

(:test)
function mobilitySyncTakes404AsNoMobilityWithoutAMessage(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var before = rig.sent();
    rig.sync.start();
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("NOT_FOUND", false));
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);                   // the run is over and quiet
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_NONE);
    Test.assert(!rig.sync.available);
    Test.assert(!rig.cache.hasToday());                                      // the stored state is gone
    Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.mobRoutine(rig.id(1))));
    Test.assert(rig.sync.ackMark() == null);
    Expect.equal(rig.rejected.count, 0);
    Expect.equal(rig.sent(), before + 1);                                    // no new try, nothing waits
    Expect.equal(rig.plan.pairing.client.pendingCount(), 0);
    Test.assert(rig.plan.pairing.clientTimer.pendingCallback == null);
    return true;
}

(:test)
function mobilitySyncKeepsTheOldStateWithoutPhoneOrOnServerErrors(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    rig.sync.start();                                        // no phone: it keeps trying, the stored state stays
    rig.plan.pairing.transport.respond(-104, null);
    Test.assert(rig.sync.isPhoneMissing());
    Expect.equal(rig.sync.state, MobilitySync.MOB_LOADING);
    Test.assert(rig.cache.isComplete());
    rig.plan.pairing.clientTimer.fire();
    rig.plan.pairing.transport.respond(200, rig.list(rig.threeItems(1), rig.MV));
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    rig.sync.start();                                        // a server error after the retries: over, old state stays
    rig.plan.exhaustRetries();
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_UNREACHABLE);
    Test.assert(rig.sync.available && rig.cache.isComplete() && rig.sync.ackMark() == null);
    Expect.equal(rig.plan.pairing.client.pendingCount(), 0);
    return true;
}

(:test)
function mobilitySyncGoesOnWhenARoutineIsGoneAndPassesOn401(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.open(rig.threeItems(1));
    rig.plan.pairing.transport.respond(200, rig.routine(1, 600));
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("NOT_FOUND", false));   // entry 2 left the plan
    Expect.equal(rig.url(3), "http://mock/api/watch/v1/mobility/" + rig.id(3));       // the run goes on
    rig.plan.pairing.transport.respond(200, rig.routine(3, 800));
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.missing, 1);
    Test.assert(rig.cache.routine(rig.id(1)) != null && rig.cache.routine(rig.id(2)) == null && rig.cache.routine(rig.id(3)) != null);
    Test.assert(rig.sync.ackMark() == null);                 // not complete: no confirmation with mv
    var other = new MobilityRig();
    other.loadAll();
    other.sync.start();
    other.plan.pairing.transport.respond(401, other.plan.errorBody("UNAUTHORIZED", false));
    Expect.equal(other.sync.problem, MobilitySync.MOB_PROBLEM_AUTH);
    Expect.equal(other.rejected.count, 1);
    Test.assert(other.cache.isComplete());                   // the stored routines stay
    return true;
}

(:test)
function planConfirmationCarriesMvOnlyAfterACompleteMobilitySync(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var body = rig.confirmation();
    Expect.equal(body["v"] as String, "0123456789abcdef");
    Expect.equal(body["mv"] as String, rig.MV);
    Expect.equal(body.size(), 2);
    var never = new MobilityRig();                           // never synced: an older server would reject the field
    Expect.equal(never.confirmation().size(), 1);
    var older = new MobilityRig();                           // the older server: 404 on the list
    older.plan.pairing.restartPaired();
    older.sync.start();
    older.plan.pairing.transport.respond(404, older.plan.errorBody("NOT_FOUND", false));
    Test.assert(!older.confirmation().hasKey("mv"));
    var half = new MobilityRig();                            // a sync that stopped half way
    half.open(half.threeItems(1));
    half.plan.exhaustRetries();
    Test.assert(!half.confirmation().hasKey("mv"));
    var plain = new PlanRig();                               // no provider at all (the plan loader alone)
    plain.begin();
    plain.pairing.transport.respond(200, plain.directoryWithMark(["d1"], "d1"));
    plain.pairing.transport.respond(200, plain.dayBody("d1"));
    plain.pairing.transport.respond(200, plain.recentBody());
    Test.assert(!(plain.pairing.transport.requests[3].body as Dictionary).hasKey("mv"));
    return true;
}

(:test)
function mobilityDayCountsWeekdaysFromMondayAndTheMorningFromFourToNoon(logger as Logger) as Boolean {
    var monday = RunDate.dayNumber("2026-11-23") as Number;
    for (var i = 0; i < 7; i++) {
        Expect.equal(MobilityDay.weekdayBit(monday + i), 1 << i);
    }
    Expect.equal(MobilityDay.weekdayBit(RunDate.dayNumber("2026-11-29") as Number), 64);   // Sunday
    Expect.equal(MobilityDay.weekdayBit(0), 8);                                          // 1970-01-01, a Thursday
    var rig = new MobilityRig();
    var noon = monday * 86400 + 12 * 3600;
    var mondayOnly = rig.item(1, "s", "Montag", 10, 1, null, false, 1);
    var weekend = rig.item(2, "s", "Wochenende", 10, 96, null, false, 1);
    Test.assert(MobilityDay.onToday(mondayOnly, noon, 0) && !MobilityDay.onToday(weekend, noon, 0));
    Test.assert(!MobilityDay.onToday(mondayOnly, noon + 86400, 0) && MobilityDay.onToday(weekend, noon + 6 * 86400, 0));
    var late = monday * 86400 + 23 * 3600 + 1800;           // Monday 23:30 UTC is Tuesday in UTC+2
    Test.assert(MobilityDay.onToday(mondayOnly, late, 0) && !MobilityDay.onToday(mondayOnly, late, 120));
    Expect.equal(MobilityDay.localDate(late, 120), "2026-11-24");
    var times = [[3 * 3600 + 59 * 60 + 59, 0, false], [4 * 3600, 0, true], [11 * 3600 + 59 * 60 + 59, 0, true], [12 * 3600, 0, false],
        [2 * 3600, 120, true], [2 * 3600 - 1, 120, false], [10 * 3600 - 1, 120, true], [10 * 3600, 120, false], [4 * 3600 + 1800, -60, false]] as Array;
    for (var t = 0; t < times.size(); t++) {
        var check = times[t] as Array;
        Expect.equal(MobilityDay.isMorning(monday * 86400 + (check[0] as Number), check[1] as Number), check[2] as Boolean);
    }
    return true;
}

(:test)
function mobilityDoneCountsTheServerOnlyForTheDateOfTheList(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    var items = rig.threeItems(1);
    items[0] = rig.item(1, "m", "Morgenroutine", 10, 127, null, true, 1);     // done by the server
    rig.cache.putToday(rig.list(items, rig.MV), 5000);
    var first = rig.cache.item(rig.id(1)) as Dictionary;
    var second = rig.cache.item(rig.id(2)) as Dictionary;
    Test.assert(rig.cache.isDone(first, rig.TODAY) && !rig.cache.isDone(second, rig.TODAY));
    Test.assert(!rig.cache.isDone(first, "2026-11-24"));                     // yesterday's list says nothing about today
    var written = [rig.id(2), 5] as Array<Application.Storage.ValueType>;   // noted on this watch, damaged entries skipped
    rig.plan.pairing.store.setValue(StoreKeys.mobDone(rig.TODAY), written as Application.Storage.ValueType);
    Expect.equal(rig.cache.doneLocal(rig.TODAY).size(), 1);
    Test.assert(rig.cache.isDone(second, rig.TODAY) && !rig.cache.isDone(second, "2026-11-24"));
    Expect.equal(StoreKeys.mobDone("2026-11-23"), "mob:done:2026-11-23");
    return true;
}

(:test)
function signingOutWipesTheMobilityRoutines(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var store = rig.plan.pairing.store;
    var wipe = new AccountWipe(rig.plan.cache, new RunCache(store), new HealthConsent(store), new HealthOutbox(store));
    wipe.setMobility(rig.cache);
    wipe.wipe();
    Test.assert(!rig.cache.hasToday() && !store.values.hasKey(StoreKeys.mobRoutine(rig.id(3))));
    return true;
}

// Helpers of the start screen tests with mobility (LayoutTest.mc): the entries of the list are loaded for the day of
// the RunRig (2026-11-14, a Saturday: weekday bit 32, 10:00 UTC, offset 0).
(:test)
module MobHomeRig {
    const LONG_NAME as String = "Äußere Hüfte öffnen und Rücken lockern nach dem Training";

    function entry(n as Number, kind as String, name as String, weekdays as Number, after as String or Null, done as Boolean) as Dictionary {
        return new MobilityRig().item(n, kind, name, 10 + n, weekdays, after, done, 1);
    }

    function morning(done as Boolean) as Dictionary {
        return entry(1, "m", "Morgenroutine", 127, null, done);
    }

    function setTime(rig as RunRig, secondsOfDay as Number) as Void {
        rig.plan.pairing.clock.now = (RunDate.dayNumber(rig.TODAY) as Number) * 86400 + secondsOfDay;
    }

    // The entries and their routines (numbered like their ids) become the stored state, the start screen gets its loader.
    function loadFor(rig as RunRig, items as Array, date as String) as MobilityCache {
        var builder = new MobilityRig();
        var body = builder.list(items, builder.MV);
        body["d"] = date;
        var cache = new MobilityCache(rig.plan.pairing.store);
        var now = rig.plan.pairing.clock.nowSeconds();
        Test.assert(cache.putToday(body, now));
        for (var i = 0; i < items.size(); i++) {
            var id = (items[i] as Dictionary)["id"] as String;
            var n = (id.substring(id.length() - 1, id.length()) as String).toNumber() as Number;
            Test.assert(cache.putRoutine(id, (items[i] as Dictionary)["tag"] as String, builder.routine(n, 600), now));
        }
        rig.home.mobility = new MobilitySync(rig.plan.pairing.client, cache, rig.plan.pairing.clock, new CallCounter().method(:onCall));
        return cache;
    }

    function load(rig as RunRig, items as Array) as MobilityCache {
        return loadFor(rig, items, rig.TODAY);
    }

    // A rig with the plan and one run today (the usual start screen).
    function rigWithRun() as RunRig {
        var rig = new RunRig();
        rig.plan.loadAll();
        Test.assert(rig.cache.putUpcoming(rig.upcoming(HomeRig.entries(rig, 1, "Zone 2"), true), rig.plan.pairing.clock.now, 0));
        return rig;
    }

    function rows(rig as RunRig) as Array<HomeStop> {
        return rig.home.stops(rig.plan.sync, new SessionPicker());
    }

    function count(rows as Array<HomeStop>, kind as Number) as Number {
        var found = 0;
        for (var i = 0; i < rows.size(); i++) {
            found += rows[i].kind == kind ? 1 : 0;
        }
        return found;
    }

    function indexOfKind(rows as Array<HomeStop>, kind as Number) as Number {
        for (var i = 0; i < rows.size(); i++) {
            if (rows[i].kind == kind) {
                return i;
            }
        }
        return -1;
    }
}
