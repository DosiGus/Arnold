import Toybox.Lang;
import Toybox.Test;

// MOB-010: the journal, the outbox and the sender of the mobility results. Short on purpose (the memory of the fr255 test build).

// The sender on the plan rig (fake network, timers, storage). Results are numbered like their routines.
(:test)
class MobSendRig {
    const DAY as String = "2026-11-14";
    var plan as PlanRig;
    var cache as MobilityCache;
    var outbox as MobilityOutbox;
    var sender as MobilitySender;
    var rejected as CallCounter;

    function initialize() {
        plan = new PlanRig();
        rejected = new CallCounter();
        cache = new MobilityCache(plan.pairing.store);
        outbox = new MobilityOutbox(plan.pairing.store);
        sender = new MobilitySender(plan.pairing.client, outbox, cache, plan.pairing.clock, rejected.method(:onCall));
        plan.pairing.restartPaired();
        plan.pairing.clock.now = (RunDate.dayNumber(DAY) as Number) * 86400 + 36000;
    }

    function result(sessionId as String, count as Number) as Dictionary {
        var ex = [] as Array;
        for (var i = 0; i < count; i++) {
            ex.add({ "c" => "mob_cat_cow", "st" => "done", "t" => 60 } as Dictionary);
        }
        return { "session_uuid" => Uuid.v4(), "kind" => "morning", "session_id" => sessionId, "workout_date_local" => DAY, "utc_offset_min" => 0,
            "started_at_utc" => DAY + "T09:50:00Z", "ended_at_utc" => DAY + "T10:00:00Z", "timer_s" => 60 * count, "elapsed_s" => 600, "ended_early" => false, "ex" => ex } as Dictionary;
    }

    function body(i as Number) as Dictionary {
        return plan.pairing.transport.requests[i].body as Dictionary;
    }

    function failFourTimes() as Void {
        for (var i = 0; i < 3; i++) {
            plan.pairing.transport.respond(503, null);
            plan.pairing.clientTimer.fire();
        }
        plan.pairing.transport.respond(503, null);   // gives up for now
    }
}

(:test)
function theOutboxSurvivesARestartAndSendsOneRequestAtATime(logger as Logger) as Boolean {
    var rig = new MobSendRig();
    var first = rig.result("s_1", 2);
    var second = rig.result("s_2", 3);
    Test.assert(rig.outbox.addResult(first, 1000));
    Test.assert(rig.outbox.addResult(second, 1001));
    Test.assert(!rig.outbox.addResult(first, 1002));                          // once
    var restarted = new MobilityOutbox(rig.plan.pairing.store);               // the app was closed
    Expect.equal(restarted.count(), 2);
    Expect.field(restarted.get(first["session_uuid"] as String) as Dictionary, "i", "s_1");
    rig.sender.sendAll();
    Expect.equal(rig.plan.pairing.transport.sentCount(), 1);                  // one at a time
    Test.assert(rig.plan.pairing.transport.urls[0].find("/mobility") != null);
    Expect.field(rig.body(0), "request_id", "gm_" + (first["session_uuid"] as String));
    Expect.equal(Expect.valueOf(rig.body(0), "session_id"), null);              // a result without a plan version is a free routine
    Expect.equal(Expect.valueOf(rig.body(0), "plan_version_id"), null);
    rig.plan.pairing.transport.respond(201, { "workout_id" => "w1", "replayed" => false });
    Expect.equal(rig.plan.pairing.transport.sentCount(), 2);
    Expect.field(rig.body(1), "request_id", "gm_" + (second["session_uuid"] as String));
    rig.plan.pairing.transport.respond(200, { "workout_id" => "w2", "replayed" => true });
    Expect.equal(rig.outbox.count(), 0);
    Test.assert(rig.cache.doneLocal(rig.DAY).indexOf("s_1") >= 0 && rig.cache.doneLocal(rig.DAY).indexOf("s_2") >= 0);   // marked done on the watch
    return true;
}

(:test)
function noAnswerKeepsTheEntryAndARepeatSendsTheIdenticalBody(logger as Logger) as Boolean {
    var rig = new MobSendRig();
    var result = rig.result("s_1", 2);
    rig.outbox.addResult(result, 1000);
    rig.sender.sendAll();
    var firstBody = rig.body(0);
    rig.failFourTimes();
    Expect.equal(rig.outbox.count(), 1);                                       // 5xx: it stays
    Expect.field(rig.outbox.get(result["session_uuid"] as String) as Dictionary, "n", 1);
    Test.assert(rig.cache.doneLocal(rig.DAY).size() == 0);
    var before = rig.plan.pairing.transport.sentCount();
    rig.plan.pairing.clientTimer.fire();                                       // no timer sends it: nothing happens
    Expect.equal(rig.plan.pairing.transport.sentCount(), before);
    rig.sender.sendAll();                                                      // the next start of the app
    Expect.equal(rig.plan.pairing.transport.sentCount(), before + 1);
    Test.assert(Expect.same(rig.body(before), firstBody));
    rig.plan.pairing.transport.respond(201, { "workout_id" => "w1", "replayed" => false });
    Expect.equal(rig.outbox.count(), 0);
    return true;
}

(:test)
function aDuplicateCountsAsSentARefusalStaysAndTheTokenGoesToPairing(logger as Logger) as Boolean {
    var rig = new MobSendRig();
    var duplicate = rig.result("s_1", 1);
    rig.outbox.addResult(duplicate, 1000);
    rig.sender.sendAll();
    rig.plan.pairing.transport.respond(409, { "error" => { "code" => "DUPLICATE_WORKOUT", "message" => "da" } });
    Expect.equal(rig.outbox.count(), 0);                                       // Arnold has it: counts as sent
    Test.assert(rig.cache.doneLocal(rig.DAY).indexOf("s_1") >= 0);
    // a refusal stays with the server's text and is dropped after 14 days
    var refused = rig.result("s_2", 1);
    rig.outbox.addResult(refused, rig.plan.pairing.clock.now);
    rig.sender.sendAll();
    rig.plan.pairing.transport.respond(422, { "error" => { "code" => "VALIDATION_ERROR", "message" => "nein" } });
    var entry = rig.outbox.get(refused["session_uuid"] as String) as Dictionary;
    Expect.field(entry, "s", MobilityOutbox.STATUS_REJECTED);
    Expect.field(entry, "e", "VALIDATION_ERROR");
    Expect.field(entry, "m", "nein");
    var sent = rig.plan.pairing.transport.sentCount();
    rig.sender.sendAll();
    Expect.equal(rig.plan.pairing.transport.sentCount(), sent);                // a refused entry is not sent again
    rig.plan.pairing.clock.now += 15 * 86400;
    rig.sender.sendAll();
    Expect.equal(rig.outbox.count(), 0);
    // an expired token: the entry stays, the pairing path is told
    rig.outbox.addResult(rig.result("s_3", 1), rig.plan.pairing.clock.now);
    rig.sender.sendAll();
    rig.plan.pairing.transport.respond(401, null);
    Expect.equal(rig.rejected.count() as Number, 1);
    Expect.equal(rig.outbox.count(), 1);
    return true;
}

(:test)
function aRoutineLostInTheMiddleIsQueuedOnceAsEndedEarly(logger as Logger) as Boolean {
    var rig = new MobPlayRig([[1, 40, null], [1, 40, null]] as Array);
    rig.go(5 + 40 + 5 + 25);                           // the first is done, 25 s into the second (written at 30 s of movement)
    // the app is gone: a new process finds the journal
    MobilityHandover.live = null;
    var outbox = new MobilityOutbox(rig.store);
    var journal = new MobilityJournal(rig.store);
    Test.assert(journal.activeId() != null);
    Test.assert(MobilityHandover.recover(journal, outbox, rig.clock.now));
    Test.assert(!MobilityHandover.recover(journal, outbox, rig.clock.now));        // exactly once
    Test.assert(!MobilityHandover.recover(new MobilityJournal(rig.store), outbox, rig.clock.now));
    Expect.equal(outbox.count(), 1);
    Test.assert(journal.activeId() == null);
    var body = (outbox.get(rig.player.uuid) as Dictionary)["b"] as Dictionary;
    Expect.field(body, "ended_early", true);
    Expect.field(body, "request_id", "gm_" + rig.player.uuid);
    var ex = body["ex"] as Array;
    Expect.equal(ex.size(), 2);
    Expect.field(ex[0] as Dictionary, "st", "done");
    Expect.field(ex[1] as Dictionary, "st", "partial");
    Expect.field(ex[1] as Dictionary, "t", 20);        // the head was written at 60 s of movement: 20 s of the second
    // a routine that ended but was never saved keeps its own ending; nothing done is not sent
    var finished = new MobPlayRig([[1, 5, null]] as Array);
    finished.go(5 + 5);
    MobilityHandover.live = null;
    Test.assert(MobilityHandover.recover(finished.journal, finished.outbox, finished.clock.now));
    Expect.field((finished.outbox.get(finished.player.uuid) as Dictionary)["b"] as Dictionary, "ended_early", false);
    var idle = new MobPlayRig([[1, 5, null]] as Array);
    idle.go(2);
    MobilityHandover.live = null;
    Test.assert(!MobilityHandover.recover(idle.journal, idle.outbox, idle.clock.now));
    Expect.equal(idle.outbox.count(), 0);
    // a routine this process is running is not "interrupted"
    var running = new MobPlayRig([[1, 5, null]] as Array);
    running.go(7);
    Test.assert(!MobilityHandover.recover(running.journal, running.outbox, running.clock.now));
    Test.assert(running.journal.activeId() != null);
    return true;
}

(:test)
function aSentMorningRoutineLeavesTheTopOfTheStartScreen(logger as Logger) as Boolean {
    var rig = MobHomeRig.rigWithRun();
    var cache = MobHomeRig.load(rig, [MobHomeRig.morning(false)] as Array);
    Test.assert(MobHomeRig.rows(rig)[0].morning);
    var outbox = new MobilityOutbox(rig.plan.pairing.store);
    var sender = new MobilitySender(rig.plan.pairing.client, outbox, cache, rig.plan.pairing.clock, new CallCounter().method(:onCall));
    var result = new MobSendRig().result(MobHomeRig.morning(false)["id"] as String, 1);
    result["workout_date_local"] = rig.TODAY;
    outbox.addResult(result, rig.plan.pairing.clock.now);
    sender.sendAll();
    Test.assert(MobHomeRig.rows(rig)[0].morning);                                   // not yet: it waits for the answer
    rig.plan.pairing.transport.respond(201, { "workout_id" => "w1", "replayed" => false });
    var rows = MobHomeRig.rows(rig);
    Test.assert(!rows[0].morning);                                                  // done: the routine does not stay on top
    return true;
}

(:test)
function everyStoredValueStaysFarBelow32KB(logger as Logger) as Boolean {
    var rig = new MobSendRig();
    var result = rig.result("s_1", 15);
    rig.outbox.addResult(result, 1000);
    var entry = rig.outbox.get(result["session_uuid"] as String) as Dictionary;
    var play = new MobPlayRig([[2, 60, null], [2, 60, null]] as Array);
    var head = play.journal.readHead(play.player.uuid) as Dictionary;
    Test.assert(Expect.bytes(entry) < 4000);
    Test.assert(Expect.bytes(head) < 4000);
    Test.assert(Expect.bytes(rig.outbox.ids() as Array) < 1000);
    return true;
}

// The two requests of the end-to-end check: the simulator prints them, `apps/garmin/scripts/run-e2e.sh` posts them to the
// mock server, which checks them against the contract (src/shared/mobility-contract.ts): 201, then 200 for the repeat.
(:test)
function printTheMobilityRequestsForTheEndToEndCheck(logger as Logger) as Boolean {
    MobPlay.session = "s_00000000-0000-4000-8000-000000000001";   // the routine the mock server's list names (with its plan version)
    var done = new MobPlayRig([[2, 20, null], [1, 30, 8]] as Array);
    done.go(5 + 20 + 3 + 20 + 5 + 30);
    Test.assert(done.player.save());
    MobPlay.session = "s_00000000-0000-4000-8000-000000000002";
    var early = new MobPlayRig([[1, 30, null], [1, 30, null]] as Array);
    MobPlay.session = "s_1";
    early.go(5 + 30 + 5 + 12);
    early.player.endEarly();
    Test.assert(early.player.save());
    var body = (done.outbox.get(done.player.uuid) as Dictionary)["b"] as Dictionary;
    var partial = (early.outbox.get(early.player.uuid) as Dictionary)["b"] as Dictionary;
    Expect.field(body, "ended_early", false);
    Expect.field(partial, "ended_early", true);
    logger.debug("MOBPAYLOAD morgen-fertig " + RunJson.write(body));
    logger.debug("MOBPAYLOAD einheit-frueh-beendet " + RunJson.write(partial));
    return true;
}

(:test)
function thePlanVersionOfTheRoutineTravelsWithTheSessionOrNotAtAll(logger as Logger) as Boolean {
    // the routine named its plan version: both fields, also after a crash
    var planned = new MobPlayRig([[1, 40, null], [1, 40, null]] as Array);
    planned.go(5 + 40 + 5 + 25);
    MobilityHandover.live = null;
    Test.assert(MobilityHandover.recover(planned.journal, planned.outbox, planned.clock.now));
    var recovered = (planned.outbox.get(planned.player.uuid) as Dictionary)["b"] as Dictionary;
    Expect.field(recovered, "plan_version_id", "pv_00000000-0000-4000-8000-000000000001");
    Expect.field(recovered, "session_id", "s_1");
    // the answer had none (a cache from before the update): neither field is sent, the routine is still marked done here
    MobPlay.plan = null;
    var free = new MobPlayRig([[1, 5, null]] as Array);
    MobPlay.plan = "pv_00000000-0000-4000-8000-000000000001";
    free.go(5 + 5);
    Test.assert(free.player.save());
    var entry = free.outbox.get(free.player.uuid) as Dictionary;
    var body = entry["b"] as Dictionary;
    Expect.equal(Expect.valueOf(body, "session_id"), null);
    Expect.equal(Expect.valueOf(body, "plan_version_id"), null);
    Expect.field(entry, "i", "s_1");
    // the cache keeps p when the answer has it, and loads an older answer without it
    var cache = new MobilityCache(new MemoryStore());
    var rig = new MobilityRig();
    var routine = rig.routine(1, 600);
    routine["p"] = "pv_x";
    Test.assert(cache.putRoutine(rig.id(1), "t", routine, 1));
    Expect.field(cache.routine(rig.id(1)) as Dictionary, "p", "pv_x");
    Test.assert(cache.putRoutine(rig.id(2), "t", rig.routine(2, 600), 1));
    Expect.equal(Expect.valueOf(cache.routine(rig.id(2)) as Dictionary, "p"), null);
    return true;
}
