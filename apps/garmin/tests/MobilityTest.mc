import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Test;

// MOB-008: the mobility cache, its loader and the plan confirmation with `mv`.
// The start screen with the mobility rows is tested in LayoutTest.mc and HomeViewTest.mc.

// The mobility loader on top of the plan rig (fake network, timers, storage). Ids end in 1 to 6.
(:test)
class MobilityRig {
    const TODAY as String = "2026-11-23";   // a Monday
    const MV as String = "9f3a1c5e7b2d4a60";
    var plan as PlanRig;
    var cache as MobilityCache;
    var sync as MobilitySync;
    var rejected as CallCounter;
    var changes as CallCounter;

    function initialize() {
        plan = new PlanRig();
        rejected = new CallCounter();
        changes = new CallCounter();
        cache = new MobilityCache(plan.pairing.store);
        sync = new MobilitySync(plan.pairing.client, cache, plan.pairing.clock, rejected.method(:onCall));
        sync.setObserver(changes.method(:onCall));
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
        return [
            item(1, "m", "Morgenroutine", 10, 127, null, false, version),
            item(2, "s", "Mobilität nach Kraft", 20, 127, "d1", false, version),
            item(3, "s", "Hüfte öffnen", 15, 127, null, false, version)
        ] as Array;
    }

    function exercise(code as String, name as String, sides as Number, seconds as Number) as Dictionary {
        var ex = { "c" => code, "n" => name, "h" => "Ruhig atmen", "s" => sides, "t" => seconds, "r" => null };
        return ex;
    }

    function routine(n as Number, total as Number) as Dictionary {
        return {
            "api_version" => 1, "min_app_version" => "1.0.0", "id" => id(n), "tot" => total,
            "ex" => [exercise("mob_cat_cow", "Katze-Kuh", 1, 85), exercise("mob_thread_needle", "Faden einfädeln", 2, 50)] as Array
        };
    }

    // The loader runs on a connected watch and the list is answered.
    function open(items as Array) as Void {
        plan.pairing.restartPaired();
        sync.start();
        plan.pairing.transport.respond(200, list(items, MV));
    }

    // Answers the routines 1..count in the order the loader asks for them.
    function answerRoutines(count as Number) as Void {
        for (var n = 1; n <= count; n++) {
            plan.pairing.transport.respond(200, routine(n, 600));
        }
    }

    // A complete run with three entries (the tags of version 1).
    function loadAll() as Void {
        open(threeItems(1));
        answerRoutines(3);
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

    function base() as String {
        return "http://mock/api/watch/v1";
    }
}

(:test)
function mobilityCacheChecksTheShapeOfTheList(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    Test.assert(MobilityCache.isList(rig.list(rig.threeItems(1), rig.MV)));
    Test.assert(MobilityCache.isList(rig.list([] as Array, rig.MV)));     // no entries is a valid list
    // at most five entries
    var six = [] as Array;
    for (var n = 1; n <= 6; n++) {
        six.add(rig.item(n, "s", "Eintrag", 10, 127, null, false, 1));
    }
    Test.assert(!MobilityCache.isList(rig.list(six, rig.MV)));
    six.remove(six[5]);
    Test.assert(MobilityCache.isList(rig.list(six, rig.MV)));
    // list fields
    var noDate = rig.list(rig.threeItems(1), rig.MV);
    noDate["d"] = "not-a-date";
    Test.assert(!MobilityCache.isList(noDate));
    var noMark = rig.list(rig.threeItems(1), rig.MV);
    noMark["mv"] = 5;
    Test.assert(!MobilityCache.isList(noMark));
    var noItems = rig.list(rig.threeItems(1), rig.MV);
    noItems["items"] = "none";
    Test.assert(!MobilityCache.isList(noItems));
    Test.assert(!MobilityCache.isList(null));
    Test.assert(!MobilityCache.isList("text"));
    // entry fields
    Test.assert(!MobilityCache.isList(rig.withFirst("id", null)));
    Test.assert(!MobilityCache.isList(rig.withFirst("k", "x")));
    Test.assert(!MobilityCache.isList(rig.withFirst("n", 3)));
    Test.assert(!MobilityCache.isList(rig.withFirst("m", 0)));
    Test.assert(!MobilityCache.isList(rig.withFirst("m", "10")));
    Test.assert(!MobilityCache.isList(rig.withFirst("w", 0)));
    Test.assert(!MobilityCache.isList(rig.withFirst("w", 128)));
    Test.assert(!MobilityCache.isList(rig.withFirst("dn", "no")));
    Test.assert(!MobilityCache.isList(rig.withFirst("a", 7)));
    Test.assert(!MobilityCache.isList(rig.withFirst("tag", null)));
    Test.assert(MobilityCache.isList(rig.withFirst("a", "d1")));          // a session id is fine
    Test.assert(MobilityCache.isList(rig.withFirst("w", 127)));
    Test.assert(MobilityCache.isList(rig.withFirst("w", 1)));
    return true;
}

(:test)
function mobilityCacheChecksTheShapeOfARoutine(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    Test.assert(MobilityCache.isRoutine(rig.routine(1, 600)));
    var empty = rig.routine(1, 600);
    empty["ex"] = [] as Array;
    Test.assert(!MobilityCache.isRoutine(empty));
    var many = [] as Array;
    for (var i = 0; i < 15; i++) {
        many.add(rig.exercise("mob_cat_cow", "Katze-Kuh", 1, 30));
    }
    var full = rig.routine(1, 450);
    full["ex"] = many;
    Test.assert(MobilityCache.isRoutine(full));          // 15 exercises are the limit
    many.add(rig.exercise("mob_cat_cow", "Katze-Kuh", 1, 30));
    Test.assert(!MobilityCache.isRoutine(full));         // 16 are too many
    var noTotal = rig.routine(1, 600);
    noTotal["tot"] = "600";
    Test.assert(!MobilityCache.isRoutine(noTotal));
    var noId = rig.routine(1, 600);
    noId["id"] = null;
    Test.assert(!MobilityCache.isRoutine(noId));
    Test.assert(!MobilityCache.isRoutine(null));
    // exercise fields
    Test.assert(!MobilityCache.isExercise(rig.exercise("mob_cat_cow", "Katze-Kuh", 3, 30)));    // one or two sides
    Test.assert(!MobilityCache.isExercise(rig.exercise("mob_cat_cow", "Katze-Kuh", 0, 30)));
    Test.assert(!MobilityCache.isExercise(rig.exercise("mob_cat_cow", "Katze-Kuh", 1, 0)));     // at least a second
    var noCue = rig.exercise("mob_cat_cow", "Katze-Kuh", 1, 30);
    noCue["h"] = null;
    Test.assert(!MobilityCache.isExercise(noCue));
    var reps = rig.exercise("mob_cat_cow", "Katze-Kuh", 1, 30);
    reps["r"] = 8;
    Test.assert(MobilityCache.isExercise(reps));
    reps["r"] = "8";
    Test.assert(!MobilityCache.isExercise(reps));
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
    var stored = rig.cache.today() as Dictionary;
    Expect.equal(stored.size(), 4);                          // d, mv, at, items
    Test.assert(!stored.hasKey("whatever"));
    Expect.equal((stored["items"] as Array).size(), 3);
    var first = rig.cache.item(rig.id(1)) as Dictionary;
    Expect.equal(first.size(), 8);
    Test.assert(!first.hasKey("extra"));
    Expect.field(first, "n", "Morgenroutine");
    Expect.equal(rig.cache.mark(), rig.MV);
    Expect.equal(rig.cache.listDate(), rig.TODAY);
    // a routine, too
    var routine = rig.routine(1, 600);
    routine["secret"] = 1;
    var firstExercise = (routine["ex"] as Array)[0] as Dictionary;
    firstExercise["zz"] = 2;
    Test.assert(rig.cache.putRoutine(rig.id(1), rig.tag(1, 1), routine, 5001));
    var kept = rig.cache.routine(rig.id(1)) as Dictionary;
    Expect.equal(kept.size(), 3);                            // id, tot, ex
    Test.assert(!kept.hasKey("secret"));
    var exercise = (kept["ex"] as Array)[0] as Dictionary;
    Expect.equal(exercise.size(), 6);
    Test.assert(!exercise.hasKey("zz"));
    Expect.field(exercise, "n", "Katze-Kuh");
    Expect.equal(rig.cache.routineTag(rig.id(1)), rig.tag(1, 1));
    return true;
}

(:test)
function mobilityCacheLeavesTheOldStateOnABrokenAnswer(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    Test.assert(rig.cache.putToday(rig.list(rig.threeItems(1), rig.MV), 5000));
    Test.assert(rig.cache.putRoutine(rig.id(1), rig.tag(1, 1), rig.routine(1, 600), 5000));
    // a broken list changes nothing
    Test.assert(!rig.cache.putToday(rig.withFirst("w", 0), 6000));
    Test.assert(!rig.cache.putToday({ "d" => rig.TODAY } as Dictionary, 6000));
    Expect.equal(rig.cache.items().size(), 3);
    Expect.equal(((rig.cache.today() as Dictionary)["at"] as Number), 5000);
    Expect.equal(rig.cache.mark(), rig.MV);
    // a broken routine, a routine of another id and an unreadable routine change nothing
    var broken = rig.routine(1, 600);
    broken["ex"] = [] as Array;
    Test.assert(!rig.cache.putRoutine(rig.id(1), rig.tag(1, 2), broken, 6000));
    Test.assert(!rig.cache.putRoutine(rig.id(1), rig.tag(1, 2), rig.routine(2, 600), 6000));
    Expect.equal(rig.cache.routineTag(rig.id(1)), rig.tag(1, 1));
    Expect.field(rig.cache.routine(rig.id(1)) as Dictionary, "tot", 600);
    // storage with damaged content counts as "nothing stored"
    var store = rig.plan.pairing.store;
    store.setValue(StoreKeys.MOB_TODAY, "damaged");
    Test.assert(!rig.cache.hasToday());
    Expect.equal(rig.cache.items().size(), 0);
    Test.assert(rig.cache.mark() == null);
    var odd = { "tag" => 5 } as Dictionary<String, Number>;
    store.setValue(StoreKeys.mobRoutine(rig.id(1)), odd as Application.Storage.ValueType);
    Test.assert(rig.cache.routine(rig.id(1)) == null);
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
    var items = [rig.item(1, "m", "Morgenroutine", 10, 127, null, false, 1), rig.item(3, "s", "Hüfte öffnen", 15, 127, null, false, 1)] as Array;
    Test.assert(rig.cache.putToday(rig.list(items, "aaaaaaaaaaaaaaaa"), 6000));
    Test.assert(rig.cache.routine(rig.id(2)) == null);
    Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.mobRoutine(rig.id(2))));
    Test.assert(rig.cache.routine(rig.id(1)) != null);
    Test.assert(rig.cache.isComplete());
    // a new tag in the list makes the stored copy stale, an unknown entry is missing
    var stale = [rig.item(1, "m", "Morgenroutine", 10, 127, null, false, 2), rig.item(4, "s", "Neu", 10, 127, null, false, 1)] as Array;
    rig.cache.putToday(rig.list(stale, "bbbbbbbbbbbbbbbb"), 7000);
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(1)) as Dictionary), MobilityCache.ROUTINE_STALE);
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(4)) as Dictionary), MobilityCache.ROUTINE_MISSING);
    Test.assert(!rig.cache.isComplete());
    Test.assert(rig.cache.completeMark() == null);
    return true;
}

(:test)
function mobilitySyncLoadsTheListAndThenEveryRoutine(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.plan.pairing.restartPaired();
    rig.sync.start();
    Expect.equal(rig.sync.state, MobilitySync.MOB_LOADING);
    Expect.equal(rig.url(0), rig.base() + "/mobility/today");
    Expect.equal(rig.plan.pairing.transport.requests[0].method, Communications.HTTP_REQUEST_METHOD_GET);
    rig.sync.start();                                        // a run in progress is not started twice
    Expect.equal(rig.sent(), 1);
    rig.plan.pairing.transport.respond(200, rig.list(rig.threeItems(1), rig.MV));
    Expect.equal(rig.cache.items().size(), 3);
    Expect.equal(rig.url(1), rig.base() + "/mobility/" + rig.id(1));
    Test.assert(!rig.plan.pairing.transport.headers[1].hasKey("If-None-Match"));     // nothing stored yet
    Expect.equal(rig.sync.state, MobilitySync.MOB_LOADING);
    rig.plan.pairing.transport.respond(200, rig.routine(1, 600));
    Expect.equal(rig.url(2), rig.base() + "/mobility/" + rig.id(2));
    rig.plan.pairing.transport.respond(200, rig.routine(2, 700));
    Expect.equal(rig.url(3), rig.base() + "/mobility/" + rig.id(3));
    Test.assert(rig.sync.ackMark() == null);                 // not finished yet
    rig.plan.pairing.transport.respond(200, rig.routine(3, 800));
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_NONE);
    Test.assert(rig.sync.available);
    Expect.equal(rig.sent(), 4);
    Test.assert(rig.cache.isComplete());
    Expect.equal(rig.sync.ackMark(), rig.MV);
    Expect.field(rig.cache.routine(rig.id(2)) as Dictionary, "tot", 700);
    Expect.equal(rig.plan.pairing.client.pendingCount(), 0);
    Test.assert(rig.changes.count > 0);
    Expect.equal(rig.rejected.count, 0);
    return true;
}

(:test)
function mobilitySyncAsksOnlyForRoutinesThatChanged(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var before = rig.sent();
    // a new run: only entry 2 has a new tag, the stored tag goes out as If-None-Match
    rig.sync.start();
    var items = rig.threeItems(1);
    items[1] = rig.item(2, "s", "Mobilität nach Kraft", 20, 127, "d1", false, 2);
    rig.plan.pairing.transport.respond(200, rig.list(items, "cccccccccccccccc"));
    Expect.equal(rig.sent(), before + 2);                    // the list and one routine
    Expect.equal(rig.url(before + 1), rig.base() + "/mobility/" + rig.id(2));
    Expect.equal(rig.plan.pairing.transport.headers[before + 1]["If-None-Match"] as String, "\"" + rig.tag(2, 1) + "\"");
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(2)) as Dictionary), MobilityCache.ROUTINE_STALE);
    Test.assert(rig.sync.ackMark() == null);                 // still loading
    // 304: the stored routine is current, it gets the new tag and stays as it was
    rig.plan.pairing.transport.respond(304, null);
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Expect.equal(rig.cache.routineTag(rig.id(2)), rig.tag(2, 2));
    Expect.equal(rig.cache.routineState(rig.cache.item(rig.id(2)) as Dictionary), MobilityCache.ROUTINE_LOADED);
    Expect.field(rig.cache.routine(rig.id(2)) as Dictionary, "tot", 600);
    Expect.equal(rig.sent(), before + 2);
    Expect.equal(rig.sync.ackMark(), "cccccccccccccccc");
    // a run without changes asks for the list only
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.list(items, "cccccccccccccccc"));
    Expect.equal(rig.sent(), before + 3);
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    return true;
}

(:test)
function mobilitySyncReplacesARoutineThatChanged(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    rig.sync.start();
    var items = rig.threeItems(1);
    items[0] = rig.item(1, "m", "Morgenroutine", 12, 127, null, false, 2);
    rig.plan.pairing.transport.respond(200, rig.list(items, "dddddddddddddddd"));
    rig.plan.pairing.transport.respond(200, rig.routine(1, 900));
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Expect.field(rig.cache.routine(rig.id(1)) as Dictionary, "tot", 900);
    Expect.equal(rig.cache.routineTag(rig.id(1)), rig.tag(1, 2));
    Expect.field(rig.cache.item(rig.id(1)) as Dictionary, "m", 12);
    return true;
}

(:test)
function mobilitySyncKeepsTheOldStateOnABrokenAnswer(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    var before = rig.sent();
    // the list is not a list
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, { "api_version" => 1, "d" => "x" });
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_INVALID);
    Expect.equal(rig.sent(), before + 1);                    // no routine was asked for
    Expect.equal(rig.cache.items().size(), 3);
    Expect.equal(rig.cache.mark(), rig.MV);
    Test.assert(rig.cache.isComplete());
    Test.assert(rig.sync.available);
    Test.assert(rig.sync.ackMark() == null);
    // the list is text
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, "<html>");
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_INVALID);
    Expect.equal(rig.cache.items().size(), 3);
    // a routine is broken: the old copy stays, the run ends as not complete
    rig.sync.start();
    var items = rig.threeItems(1);
    items[2] = rig.item(3, "s", "Hüfte öffnen", 15, 127, null, false, 2);
    rig.plan.pairing.transport.respond(200, rig.list(items, "eeeeeeeeeeeeeeee"));
    var broken = rig.routine(3, 800);
    broken["ex"] = [] as Array;
    rig.plan.pairing.transport.respond(200, broken);
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_INVALID);
    Expect.equal(rig.cache.routineTag(rig.id(3)), rig.tag(3, 1));
    Expect.field(rig.cache.routine(rig.id(3)) as Dictionary, "tot", 600);
    Test.assert(rig.sync.ackMark() == null);
    return true;
}

(:test)
function mobilitySyncTakes404AsNoMobilityWithoutAMessage(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    Test.assert(rig.cache.hasToday());
    var before = rig.sent();
    rig.sync.start();
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("NOT_FOUND", false));
    // no mobility: the stored state is gone, the run is over and quiet
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_NONE);
    Test.assert(!rig.sync.available);
    Test.assert(!rig.cache.hasToday());
    Expect.equal(rig.cache.items().size(), 0);
    for (var n = 1; n <= 3; n++) {
        Test.assert(!rig.plan.pairing.store.values.hasKey(StoreKeys.mobRoutine(rig.id(n))));
    }
    Test.assert(rig.sync.ackMark() == null);
    Expect.equal(rig.rejected.count, 0);
    // no new try: nothing is sent, nothing waits
    Expect.equal(rig.sent(), before + 1);
    Expect.equal(rig.plan.pairing.client.pendingCount(), 0);
    Test.assert(rig.plan.pairing.clientTimer.pendingCallback == null);
    // the next occasion asks again (the server may have been updated), and a list brings mobility back
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.list(rig.threeItems(1), rig.MV));
    Test.assert(rig.sync.available);
    Test.assert(rig.cache.hasToday());
    return true;
}

(:test)
function mobilitySyncTakes404OfAFreshWatchAsNoMobility(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.plan.pairing.restartPaired();
    rig.sync.start();
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("NOT_FOUND", false));
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    Test.assert(!rig.sync.available);
    Test.assert(!rig.cache.hasToday());
    Expect.equal(rig.sent(), 1);
    return true;
}

(:test)
function mobilitySyncKeepsTheOldStateWithoutPhoneOrOnServerErrors(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    // no phone: it keeps trying (not counted), the stored state stays
    rig.sync.start();
    rig.plan.pairing.transport.respond(-104, null);
    Test.assert(rig.sync.isPhoneMissing());
    Expect.equal(rig.sync.state, MobilitySync.MOB_LOADING);
    Test.assert(rig.cache.isComplete());
    rig.plan.pairing.clientTimer.fire();
    rig.plan.pairing.transport.respond(200, rig.list(rig.threeItems(1), rig.MV));
    Test.assert(!rig.sync.isPhoneMissing());
    Expect.equal(rig.sync.state, MobilitySync.MOB_DONE);
    // a server error after the retries: the old state stays and the run is over (no endless retry)
    rig.sync.start();
    rig.plan.exhaustRetries();
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_UNREACHABLE);
    Test.assert(rig.sync.available);
    Test.assert(rig.cache.isComplete());
    Expect.equal(rig.cache.items().size(), 3);
    Test.assert(rig.sync.ackMark() == null);
    Expect.equal(rig.plan.pairing.client.pendingCount(), 0);
    Expect.equal(rig.rejected.count, 0);
    return true;
}

(:test)
function mobilitySyncKeepsLoadedRoutinesWhenALaterOneFails(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.open(rig.threeItems(1));
    rig.plan.pairing.transport.respond(200, rig.routine(1, 600));
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("NOT_FOUND", false));   // entry 2 left the plan
    Expect.equal(rig.url(3), rig.base() + "/mobility/" + rig.id(3));                    // the run goes on
    rig.plan.pairing.transport.respond(200, rig.routine(3, 800));
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_INVALID);
    Expect.equal(rig.sync.missing, 1);
    Test.assert(rig.cache.routine(rig.id(1)) != null);
    Test.assert(rig.cache.routine(rig.id(2)) == null);
    Test.assert(rig.cache.routine(rig.id(3)) != null);
    Test.assert(rig.sync.available);
    Test.assert(rig.sync.ackMark() == null);                 // not complete: no confirmation with mv
    return true;
}

(:test)
function mobilitySyncPassesOn401AndOldApp(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.loadAll();
    rig.sync.start();
    rig.plan.pairing.transport.respond(401, rig.plan.errorBody("UNAUTHORIZED", false));
    Expect.equal(rig.sync.state, MobilitySync.MOB_FAILED);
    Expect.equal(rig.sync.problem, MobilitySync.MOB_PROBLEM_AUTH);
    Expect.equal(rig.rejected.count, 1);
    Test.assert(rig.cache.isComplete());                     // the stored routines stay
    Test.assert(rig.sync.available);
    // 426: the app is too old
    var other = new MobilityRig();
    other.plan.pairing.restartPaired();
    other.sync.start();
    other.plan.pairing.transport.respond(426, other.plan.errorBody("UPGRADE_REQUIRED", false));
    Expect.equal(other.sync.problem, MobilitySync.MOB_PROBLEM_UPGRADE);
    Expect.equal(other.rejected.count, 0);
    // a 401 on a routine ends the run, too
    var third = new MobilityRig();
    third.open(third.threeItems(1));
    third.plan.pairing.transport.respond(401, third.plan.errorBody("UNAUTHORIZED", false));
    Expect.equal(third.sync.problem, MobilitySync.MOB_PROBLEM_AUTH);
    Expect.equal(third.rejected.count, 1);
    Expect.equal(third.sent(), 2);
    return true;
}

(:test)
function planConfirmationCarriesTheMobilityMarkAfterACompleteSync(logger as Logger) as Boolean {
    var rig = new MobilityRig();
    rig.plan.sync.setMobilityMark(rig.sync.method(:ackMark));
    rig.loadAll();
    var before = rig.sent();
    rig.plan.begin();
    rig.plan.pairing.transport.respond(200, rig.plan.directoryWithMark(["d1"], "d1"));
    rig.plan.pairing.transport.respond(200, rig.plan.dayBody("d1"));
    rig.plan.pairing.transport.respond(200, rig.plan.recentBody());
    Expect.equal(rig.plan.sync.state, PlanSync.SYNC_DONE);
    Expect.equal(rig.sent(), before + 4);
    Expect.equal(rig.url(before + 3), rig.base() + "/plan/ack");
    var ack = rig.plan.pairing.transport.requests[before + 3];
    Expect.equal(ack.method, Communications.HTTP_REQUEST_METHOD_POST);
    var body = ack.body as Dictionary;
    Expect.equal(body["v"] as String, "0123456789abcdef");
    Expect.equal(body["mv"] as String, rig.MV);
    Expect.equal(body.size(), 2);
    return true;
}

(:test)
function planConfirmationLeavesOutMvWithoutAMobilitySync(logger as Logger) as Boolean {
    // never synced: an older server would reject the unknown field
    var rig = new MobilityRig();
    rig.plan.sync.setMobilityMark(rig.sync.method(:ackMark));
    rig.plan.begin();
    rig.plan.pairing.transport.respond(200, rig.plan.directoryWithMark(["d1"], "d1"));
    rig.plan.pairing.transport.respond(200, rig.plan.dayBody("d1"));
    rig.plan.pairing.transport.respond(200, rig.plan.recentBody());
    var ack = rig.plan.pairing.transport.requests[3];
    Expect.equal(rig.url(3), rig.base() + "/plan/ack");
    Expect.equal((ack.body as Dictionary).size(), 1);
    Test.assert(!(ack.body as Dictionary).hasKey("mv"));
    // no provider at all (the plan loader alone) is the same
    var plain = new PlanRig();
    plain.begin();
    plain.pairing.transport.respond(200, plain.directoryWithMark(["d1"], "d1"));
    plain.pairing.transport.respond(200, plain.dayBody("d1"));
    plain.pairing.transport.respond(200, plain.recentBody());
    Test.assert(!((plain.pairing.transport.requests[3].body as Dictionary).hasKey("mv")));
    return true;
}

(:test)
function planConfirmationLeavesOutMvOnA404AndAfterAFailedSync(logger as Logger) as Boolean {
    // the older server: 404 on the list
    var rig = new MobilityRig();
    rig.plan.sync.setMobilityMark(rig.sync.method(:ackMark));
    rig.plan.pairing.restartPaired();
    rig.sync.start();
    rig.plan.pairing.transport.respond(404, rig.plan.errorBody("NOT_FOUND", false));
    var before = rig.sent();
    rig.plan.begin();
    rig.plan.pairing.transport.respond(200, rig.plan.directoryWithMark(["d1"], "d1"));
    rig.plan.pairing.transport.respond(200, rig.plan.dayBody("d1"));
    rig.plan.pairing.transport.respond(200, rig.plan.recentBody());
    Expect.equal(rig.url(before + 3), rig.base() + "/plan/ack");
    Test.assert(!((rig.plan.pairing.transport.requests[before + 3].body as Dictionary).hasKey("mv")));
    // a sync that stopped half way (a routine did not arrive)
    var half = new MobilityRig();
    half.plan.sync.setMobilityMark(half.sync.method(:ackMark));
    half.open(half.threeItems(1));
    half.plan.pairing.transport.respond(200, half.routine(1, 600));
    half.plan.exhaustRetries();
    Expect.equal(half.sync.state, MobilitySync.MOB_FAILED);
    var start = half.sent();
    half.plan.begin();
    half.plan.pairing.transport.respond(200, half.plan.directoryWithMark(["d1"], "d1"));
    half.plan.pairing.transport.respond(200, half.plan.dayBody("d1"));
    half.plan.pairing.transport.respond(200, half.plan.recentBody());
    Expect.equal(half.url(start + 3), half.base() + "/plan/ack");
    Test.assert(!((half.plan.pairing.transport.requests[start + 3].body as Dictionary).hasKey("mv")));
    return true;
}

(:test)
function mobilityDayCountsWeekdaysFromMonday(logger as Logger) as Boolean {
    var monday = RunDate.dayNumber("2026-11-23") as Number;
    Expect.equal(MobilityDay.weekdayBit(monday), 1);
    Expect.equal(MobilityDay.weekdayBit(monday + 1), 2);
    Expect.equal(MobilityDay.weekdayBit(monday + 2), 4);
    Expect.equal(MobilityDay.weekdayBit(monday + 3), 8);
    Expect.equal(MobilityDay.weekdayBit(monday + 4), 16);
    Expect.equal(MobilityDay.weekdayBit(monday + 5), 32);
    Expect.equal(MobilityDay.weekdayBit(RunDate.dayNumber("2026-11-29") as Number), 64);   // Sunday
    Expect.equal(MobilityDay.weekdayBit(monday + 7), 1);
    Expect.equal(MobilityDay.weekdayBit(monday - 7), 1);
    Expect.equal(MobilityDay.weekdayBit(0), 8);                                          // 1970-01-01, a Thursday
    var rig = new MobilityRig();
    var noon = monday * 86400 + 12 * 3600;
    var mondayOnly = rig.item(1, "s", "Montag", 10, 1, null, false, 1);
    var sundayOnly = rig.item(2, "s", "Sonntag", 10, 64, null, false, 1);
    var weekend = rig.item(3, "s", "Wochenende", 10, 96, null, false, 1);
    var every = rig.item(4, "s", "Täglich", 10, 127, null, false, 1);
    Test.assert(MobilityDay.onToday(mondayOnly, noon, 0));
    Test.assert(!MobilityDay.onToday(sundayOnly, noon, 0));
    Test.assert(!MobilityDay.onToday(weekend, noon, 0));
    Test.assert(MobilityDay.onToday(every, noon, 0));
    Test.assert(MobilityDay.onToday(sundayOnly, noon + 6 * 86400, 0));
    Test.assert(MobilityDay.onToday(weekend, noon + 6 * 86400, 0));
    Test.assert(!MobilityDay.onToday(mondayOnly, noon + 86400, 0));
    // the local day counts, not the UTC day: Monday 23:30 UTC is already Tuesday in UTC+2
    var lateMonday = monday * 86400 + 23 * 3600 + 1800;
    Test.assert(MobilityDay.onToday(mondayOnly, lateMonday, 0));
    Test.assert(!MobilityDay.onToday(mondayOnly, lateMonday, 120));
    Expect.equal(MobilityDay.localDate(lateMonday, 0), "2026-11-23");
    Expect.equal(MobilityDay.localDate(lateMonday, 120), "2026-11-24");
    return true;
}

(:test)
function mobilityMorningIsFourToElevenFiftyNineLocalTime(logger as Logger) as Boolean {
    var day = (RunDate.dayNumber("2026-11-23") as Number) * 86400;
    Test.assert(!MobilityDay.isMorning(day + 3 * 3600 + 59 * 60, 0));          // 03:59
    Test.assert(!MobilityDay.isMorning(day + 3 * 3600 + 59 * 60 + 59, 0));     // 03:59:59
    Test.assert(MobilityDay.isMorning(day + 4 * 3600, 0));                     // 04:00
    Test.assert(MobilityDay.isMorning(day + 8 * 3600, 0));
    Test.assert(MobilityDay.isMorning(day + 11 * 3600 + 59 * 60, 0));          // 11:59
    Test.assert(MobilityDay.isMorning(day + 11 * 3600 + 59 * 60 + 59, 0));     // 11:59:59
    Test.assert(!MobilityDay.isMorning(day + 12 * 3600, 0));                   // 12:00
    Test.assert(!MobilityDay.isMorning(day + 23 * 3600, 0));
    Test.assert(!MobilityDay.isMorning(day, 0));                               // midnight
    // local time: UTC + offset
    Test.assert(MobilityDay.isMorning(day + 2 * 3600, 120));                   // 02:00 UTC is 04:00 at +02:00
    Test.assert(!MobilityDay.isMorning(day + 2 * 3600 - 1, 120));
    Test.assert(!MobilityDay.isMorning(day + 10 * 3600, 120));                 // 12:00 local
    Test.assert(MobilityDay.isMorning(day + 10 * 3600 - 1, 120));
    Test.assert(MobilityDay.isMorning(day + 4 * 3600 + 30 * 60, 0));
    Test.assert(!MobilityDay.isMorning(day + 4 * 3600 + 30 * 60, -60));        // 03:30 local at -01:00
    Test.assert(MobilityDay.isMorning(day + 11 * 3600, -300));                 // 06:00 local at -05:00
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
    Test.assert(rig.cache.isDone(first, rig.TODAY));
    Test.assert(!rig.cache.isDone(second, rig.TODAY));
    // yesterday's list says nothing about today
    Test.assert(!rig.cache.isDone(first, "2026-11-24"));
    // this watch noted it: the session ids of the day, damaged entries are skipped
    var store = rig.plan.pairing.store;
    var written = [rig.id(2), 5] as Array<Application.Storage.ValueType>;
    store.setValue(StoreKeys.mobDone(rig.TODAY), written as Application.Storage.ValueType);
    Expect.equal(rig.cache.doneLocal(rig.TODAY).size(), 1);
    Test.assert(rig.cache.isDone(second, rig.TODAY));
    Test.assert(!rig.cache.isDone(rig.cache.item(rig.id(3)) as Dictionary, rig.TODAY));
    Test.assert(!rig.cache.isDone(second, "2026-11-24"));
    Expect.equal(rig.cache.doneLocal("2026-11-24").size(), 0);
    store.setValue(StoreKeys.mobDone(rig.TODAY), "damaged");
    Expect.equal(rig.cache.doneLocal(rig.TODAY).size(), 0);
    Expect.equal(StoreKeys.mobDone("2026-11-23"), "mob:done:2026-11-23");
    Expect.equal(StoreKeys.MOB_TODAY, "mob:up");
    Expect.equal(StoreKeys.mobRoutine("abc"), "mob:r:abc");
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
    Test.assert(!rig.cache.hasToday());
    for (var n = 1; n <= 3; n++) {
        Test.assert(!store.values.hasKey(StoreKeys.mobRoutine(rig.id(n))));
    }
    // without a mobility cache (as before) the wipe works as it did
    new AccountWipe(rig.plan.cache, new RunCache(store), new HealthConsent(store), new HealthOutbox(store)).wipe();
    return true;
}
