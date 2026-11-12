import Toybox.Communications;
import Toybox.Lang;
import Toybox.Test;
import Toybox.WatchUi;

// Answers of the server used in the sending tests.
(:test)
module SyncAnswers {
    function stored() as Dictionary {
        return {
            "api_version" => 1, "min_app_version" => "1.0.0", "workout_id" => "wk_1", "replayed" => false,
            "summary" => {
                "records" => ["Neuer Rekord: Bankdrücken 62,5 kg"],
                "next" => [{ "exercise_id" => "ex_a", "message" => "Bankdrücken nächstes Mal 65 kg" }]
            }
        };
    }

    function error(code as String, retryable as Boolean, message as String) as Dictionary {
        return { "error" => { "code" => code, "retryable" => retryable, "message" => message } };
    }
}

(:test)
function uploadRequestHasTheContractShapeInOneCall(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.finishDay();
    Test.assert(rig.session.save(rig.outbox));
    var body = (rig.outbox.get(rig.session.uuid) as Dictionary)["b"] as Dictionary;
    var keys = body.keys();
    var expected = ["request_id", "session_uuid", "plan_version_id", "session_id", "workout_date_local",
        "utc_offset_min", "started_at_utc", "ended_at_utc", "exercises"];
    Expect.equal(keys.size(), expected.size());
    for (var i = 0; i < expected.size(); i++) {
        Test.assertMessage(body.hasKey(expected[i]), "missing " + expected[i]);
    }
    Test.assert((body["request_id"] as String).find("gw_") == 0);
    Expect.field(body, "session_uuid", rig.session.uuid);
    Expect.field(body, "plan_version_id", "plv_1");
    Expect.field(body, "session_id", "d1");
    Expect.field(body, "workout_date_local", Clock.localDate(rig.session.sessionStart(), rig.session.utcOffsetMinutes()));
    Expect.field(body, "started_at_utc", Clock.isoUtc(rig.session.sessionStart()));
    var exercises = body["exercises"] as Array;
    Expect.equal(exercises.size(), 4);                    // A, B, C (skipped), D
    var a = exercises[0] as Dictionary;
    Expect.field(a, "plan_item_id", "it_a");
    Expect.field(a, "exercise_id", "ex_a");
    var sets = a["sets"] as Array;
    Expect.equal(sets.size(), 3);
    var first = sets[0] as Dictionary;
    Expect.field(first, "reps", 8);
    Expect.field(first, "load_g", 60000);                 // whole grams (07 D-11)
    Expect.field(first, "side", "both");
    Test.assert(first.hasKey("t0") && first.hasKey("t1"));
    var b = exercises[1] as Dictionary;
    var bSets = b["sets"] as Array;
    Expect.field(bSets[0] as Dictionary, "side", "left");
    Expect.field(bSets[1] as Dictionary, "side", "right");
    var c = exercises[2] as Dictionary;
    Expect.field(c, "plan_item_id", "it_c");
    Test.assert(c.hasKey("skip") && !c.hasKey("sets"));
    return true;
}

(:test)
function uploadKeepsUnknownWeightAsNullAndNeverSendsUntouchedExercises(logger as Logger) as Boolean {
    var day = PlayerRig.dayBody(false);
    PlayerRig.change(day, "cat", 0, "s", [[1, 5, null]]);
    var rig = new PlayerRig(false);
    rig.session = TrainingSession.start(day, rig.journal, rig.clock, rig.signals);
    rig.toFirstSet();
    rig.session.confirmSet();
    // only exercise A was trained; the rest of the day is not in the request (the server counts it as skipped)
    rig.session.endRest();
    var body = PlayerRig.dayBody(false);
    body.size();
    // finish the workout the short way: the remaining exercises are left out
    var request = WorkoutUpload.build(rig.session, rig.clock.now + 60);
    var exercises = request["exercises"] as Array;
    Expect.equal(exercises.size(), 1);
    var set = ((exercises[0] as Dictionary)["sets"] as Array)[0] as Dictionary;
    Test.assert(set.hasKey("load_g"));                    // the key stays, the value is unknown
    Test.assert(Expect.valueOf(set, "load_g") == null);
    Expect.field(set, "reps", 5);
    return true;
}

(:test)
function uploadEndsNeverBeforeTheLastSet(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.finishDay();
    var request = WorkoutUpload.build(rig.session, rig.clock.now - 5000);   // a wrong "now" cannot put the end before the sets
    var ended = request["ended_at_utc"] as String;
    Test.assert(ended.length() == 20);
    Test.assert(ended.equals(Clock.isoUtc(rig.clock.now)) || ended.equals(Clock.isoUtc(rig.session.events[rig.session.events.size() - 1]["b"] as Number)));
    return true;
}

(:test)
function savingBuildsTheRequestOnlyOnceAndSurvivesACrash(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.finishDay();
    Test.assert(rig.session.save(rig.outbox));
    var first = ((rig.outbox.get(rig.session.uuid) as Dictionary)["b"] as Dictionary)["request_id"] as String;
    Test.assert(rig.session.save(rig.outbox));            // a second tap
    var second = ((rig.outbox.get(rig.session.uuid) as Dictionary)["b"] as Dictionary)["request_id"] as String;
    Expect.equal(second, first);
    Expect.equal(rig.outbox.count(), 1);
    Test.assert(rig.journal.activeId() == null);          // no longer "in progress"
    // the app died after the outbox entry was written but before the marker was removed
    rig.journal.setActive(rig.session.uuid);
    Test.assert(rig.restart() == null);                   // nothing to continue
    Test.assert(rig.journal.activeId() == null);
    Expect.equal(rig.outbox.count(), 1);
    Expect.equal(((rig.outbox.get(rig.session.uuid) as Dictionary)["b"] as Dictionary)["request_id"] as String, first);
    return true;
}

(:test)
function savingNeedsAFinishedWorkoutWithSets(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    Test.assert(!rig.session.save(rig.outbox));           // not finished
    rig.toFirstSet();
    Test.assert(!rig.session.save(rig.outbox));
    Expect.equal(rig.outbox.count(), 0);
    // a finished workout without a confirmed set has nothing to send
    var day = PlayerRig.dayBody(false);
    PlayerRig.change(day, "cat", 0, "s", []);
    PlayerRig.change(day, "cat", 1, "s", []);
    PlayerRig.change(day, "cat", 3, "s", []);
    var empty = new PlayerRig(false);
    empty.session = TrainingSession.start(day, empty.journal, empty.clock, empty.signals);
    Test.assert(empty.session.isFinished());
    Test.assert(!empty.session.save(empty.outbox));
    return true;
}

(:test)
function sendingTheMainPathConfirmsAndCleansUp(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var uuid = rig.session.uuid;
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_QUEUED);
    Expect.equal(rig.sender.pendingCount(), 1);
    rig.sender.sendAll();
    Expect.equal(rig.transport.sentCount(), 1);
    Expect.equal(rig.transport.urls[0], "http://mock/api/watch/v1/workouts");
    Test.assert(rig.transport.requests[0].method == Communications.HTTP_REQUEST_METHOD_POST);
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_SENDING);
    rig.sender.sendAll();                                 // one at a time, never twice
    Expect.equal(rig.transport.sentCount(), 1);
    rig.transport.respond(200, SyncAnswers.stored());
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_SENT);
    Expect.equal(rig.sender.pendingCount(), 0);
    Expect.equal(rig.store.values.size(), 0);             // journal, plan copy, events and outbox are gone
    var result = rig.sender.lastResult as Dictionary;
    Expect.equal((result["records"] as Array).size(), 1);
    return true;
}

(:test)
function sendingTheSameRequestTwiceNeverMakesASecondWorkout(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    rig.sender.sendAll();
    var firstId = (rig.transport.requests[0].body as Dictionary)["request_id"] as String;
    // no connection: the client tries again later and gives up for now
    rig.transport.respond(-104, null);
    Expect.equal(rig.sender.phaseOf(rig.session.uuid), OutboxSender.PHASE_SENDING);   // keeps waiting for the phone
    rig.clientTimer.fire();
    for (var i = 0; i < 3; i++) {
        rig.transport.respond(503, null);
        rig.clientTimer.fire();
    }
    rig.transport.respond(503, null);                     // gives up for now
    Expect.equal(rig.sender.pendingCount(), 1);           // the workout stays on the watch
    Expect.equal(rig.client.pendingCount(), 0);
    Expect.equal(rig.sender.phaseOf(rig.session.uuid), OutboxSender.PHASE_QUEUED);
    Expect.field(rig.outbox.get(rig.session.uuid) as Dictionary, "n", 1);
    // the next occasion: the same frozen request goes out again
    var before = rig.transport.sentCount();
    rig.sender.sendAll();
    Expect.equal(rig.transport.sentCount(), before + 1);
    Expect.equal((rig.transport.requests[before].body as Dictionary)["request_id"] as String, firstId);
    // the server had it already: it answers with the stored result, replayed
    var replay = SyncAnswers.stored();
    replay["replayed"] = true;
    rig.transport.respond(200, replay);
    Expect.equal(rig.sender.pendingCount(), 0);
    Expect.equal(rig.sender.phaseOf(rig.session.uuid), OutboxSender.PHASE_SENT);
    return true;
}

(:test)
function sendingADuplicateAsksAndSavesAnywayWithANewRequest(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var uuid = rig.session.uuid;
    rig.sender.sendAll();
    var oldBody = rig.transport.requests[0].body as Dictionary;
    var oldId = oldBody["request_id"] as String;
    rig.transport.respond(409, SyncAnswers.error("DUPLICATE_WORKOUT", false, "Schon gespeichert."));
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_ASKING);
    Expect.equal(rig.transport.sentCount(), 1);           // nothing is sent again by itself
    rig.sender.sendAll();
    Expect.equal(rig.transport.sentCount(), 1);
    rig.sender.confirmDuplicate(uuid);
    Expect.equal(rig.transport.sentCount(), 2);
    var newBody = rig.transport.requests[1].body as Dictionary;
    Test.assert(!(newBody["request_id"] as String).equals(oldId));
    Expect.field(newBody, "confirm_duplicate", true);
    Test.assert(!oldBody.hasKey("confirm_duplicate"));    // the old request stays as it was
    Expect.field(newBody, "session_uuid", uuid);
    Expect.equal((newBody["exercises"] as Array).size(), 4);
    rig.transport.respond(200, SyncAnswers.stored());
    Expect.equal(rig.sender.pendingCount(), 0);
    return true;
}

(:test)
function sendingADuplicateCanBeDiscarded(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    rig.sender.sendAll();
    rig.transport.respond(409, SyncAnswers.error("DUPLICATE_WORKOUT", false, "x"));
    rig.sender.discard(rig.session.uuid);
    Expect.equal(rig.sender.pendingCount(), 0);
    Expect.equal(rig.store.values.size(), 0);
    Expect.equal(rig.sender.phaseOf(rig.session.uuid), OutboxSender.PHASE_NONE);
    return true;
}

(:test)
function sendingUnusualValuesAsksAndConfirmsWithANewRequest(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var uuid = rig.session.uuid;
    rig.sender.sendAll();
    var oldId = (rig.transport.requests[0].body as Dictionary)["request_id"] as String;
    rig.transport.respond(422, SyncAnswers.error("CONFIRMATION_REQUIRED", false, "Ungewöhnlich"));
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_ASKING);
    rig.sender.confirmUnusual(uuid);
    var body = rig.transport.requests[1].body as Dictionary;
    Test.assert(!(body["request_id"] as String).equals(oldId));
    Expect.field(body, "confirm_unusual_values", true);
    rig.transport.respond(200, SyncAnswers.stored());
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_SENT);
    return true;
}

(:test)
function sendingUnusualValuesCanGoBackToTheSummary(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var uuid = rig.session.uuid;
    rig.sender.sendAll();
    rig.transport.respond(422, SyncAnswers.error("CONFIRMATION_REQUIRED", false, "x"));
    rig.sender.backToSummary(uuid);
    Expect.equal(rig.sender.pendingCount(), 0);
    Expect.equal(rig.journal.activeId(), uuid);
    var again = rig.restart() as TrainingSession;
    Test.assert(again.isFinished());                      // the summary is there again
    Expect.equal(again.setsDone(), 6);
    return true;
}

(:test)
function sendingSchemaMismatchCountsAsSent(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    rig.sender.sendAll();
    rig.transport.respond(409, SyncAnswers.error("SCHEMA_MISMATCH", false, "geändert"));
    Expect.equal(rig.sender.pendingCount(), 0);
    Expect.equal(rig.store.values.size(), 0);
    Expect.equal(rig.sender.phaseOf(rig.session.uuid), OutboxSender.PHASE_SENT);
    return true;
}

(:test)
function sendingWithAnExpiredTokenKeepsTheWorkout(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    rig.sender.sendAll();
    rig.transport.respond(401, SyncAnswers.error("AUTH_REQUIRED", false, "x"));
    Expect.equal(rig.rejected.count, 1);
    Expect.equal(rig.sender.pendingCount(), 1);
    Expect.equal(rig.sender.phaseOf(rig.session.uuid), OutboxSender.PHASE_QUEUED);   // goes out after connecting again
    return true;
}

(:test)
function sendingARefusedWorkoutShowsTheReasonAndIsSentAgainOnRequest(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var uuid = rig.session.uuid;
    rig.sender.sendAll();
    var id = (rig.transport.requests[0].body as Dictionary)["request_id"] as String;
    rig.transport.respond(422, SyncAnswers.error("VALIDATION_ERROR", false, "Zeitzone in ChatGPT aktualisieren."));
    Expect.equal(rig.sender.phaseOf(uuid), OutboxSender.PHASE_REJECTED);
    Expect.equal(rig.sender.errorTextOf(uuid), "Zeitzone in ChatGPT aktualisieren.");
    rig.sender.sendAll();
    Expect.equal(rig.transport.sentCount(), 1);           // not by itself
    rig.sender.sendNow();
    Expect.equal(rig.transport.sentCount(), 2);
    Expect.equal((rig.transport.requests[1].body as Dictionary)["request_id"] as String, id);
    rig.transport.respond(200, SyncAnswers.stored());
    Expect.equal(rig.sender.pendingCount(), 0);
    return true;
}

(:test)
function sendingTwoWorkoutsGoesOneAfterTheOther(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var firstUuid = rig.session.uuid;
    rig.session = TrainingSession.start(PlayerRig.dayBody(false), rig.journal, rig.clock, rig.signals);
    rig.finishDay();
    rig.session.save(rig.outbox);
    Expect.equal(rig.sender.pendingCount(), 2);
    rig.sender.sendAll();
    Expect.equal(rig.transport.sentCount(), 1);
    Expect.equal((rig.transport.requests[0].body as Dictionary)["session_uuid"] as String, firstUuid);   // oldest first
    rig.transport.respond(200, SyncAnswers.stored());
    Expect.equal(rig.transport.sentCount(), 2);           // the second follows by itself
    rig.transport.respond(200, SyncAnswers.stored());
    Expect.equal(rig.sender.pendingCount(), 0);
    return true;
}

(:test)
function outboxAsksAgainAfterFourteenDays(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var uuid = rig.session.uuid;
    var now = rig.clock.now;
    Expect.equal(rig.outbox.stale(now + 14 * 86400 - 5).size(), 0);
    Expect.equal(rig.outbox.stale(now + 14 * 86400).size(), 1);
    rig.clock.now = now + 15 * 86400;
    rig.sender.keep(uuid);                                // "keep": ask again in 14 days
    Expect.equal(rig.outbox.stale(now + 15 * 86400 + 100).size(), 0);
    Expect.equal(rig.outbox.stale(now + 29 * 86400 + 100).size(), 1);
    Expect.equal(rig.outbox.count(), 1);
    return true;
}

(:test)
function outboxKeepsOrderAndIgnoresDamagedEntries(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var outbox = new Outbox(store);
    Test.assert(outbox.add("a", { "request_id" => "gw_a" }, 100));
    Test.assert(outbox.add("b", { "request_id" => "gw_b" }, 200));
    Test.assert(!outbox.add("a", { "request_id" => "gw_other" }, 300));   // never replaced
    Expect.equal(outbox.ids()[0], "a");
    Expect.equal(outbox.ids()[1], "b");
    Expect.equal(((outbox.get("a") as Dictionary)["b"] as Dictionary)["request_id"] as String, "gw_a");
    store.setValue(StoreKeys.outbox("a"), "broken");
    Expect.equal(outbox.ids().size(), 1);
    outbox.remove("b");
    Expect.equal(outbox.count(), 0);
    return true;
}

(:test)
function syncAnswersGoToTheRightPlace(logger as Logger) as Boolean {
    var duplicate = new PlayerRig(false);
    duplicate.finishDay();
    duplicate.session.save(duplicate.outbox);
    duplicate.sender.sendAll();
    duplicate.transport.respond(409, SyncAnswers.error("DUPLICATE_WORKOUT", false, "x"));
    new SyncAnswerDelegate(duplicate.sender, duplicate.session.uuid, SyncAnswerDelegate.KIND_DUPLICATE).answer(true);
    Expect.equal(duplicate.transport.sentCount(), 2);
    var no = PlayerRig.saved();
    no.sender.sendAll();
    no.transport.respond(409, SyncAnswers.error("DUPLICATE_WORKOUT", false, "x"));
    new SyncAnswerDelegate(no.sender, no.session.uuid, SyncAnswerDelegate.KIND_DUPLICATE).answer(false);
    Expect.equal(no.sender.pendingCount(), 0);
    var stale = PlayerRig.saved();
    new SyncAnswerDelegate(stale.sender, stale.session.uuid, SyncAnswerDelegate.KIND_STALE).answer(false);
    Expect.equal(stale.sender.pendingCount(), 1);         // kept
    new SyncAnswerDelegate(stale.sender, stale.session.uuid, SyncAnswerDelegate.KIND_STALE).answer(true);
    Expect.equal(stale.sender.pendingCount(), 0);         // discarded
    var unusual = PlayerRig.saved();
    unusual.sender.sendAll();
    unusual.transport.respond(422, SyncAnswers.error("CONFIRMATION_REQUIRED", false, "x"));
    new SyncAnswerDelegate(unusual.sender, unusual.session.uuid, SyncAnswerDelegate.KIND_UNUSUAL).answer(false);
    Expect.equal(unusual.sender.pendingCount(), 0);
    Expect.equal(unusual.journal.activeId(), unusual.session.uuid);
    return true;
}

(:test)
function summaryScreenShowsEachStageOfTheEnd(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = new PlayerRig(false);
    rig.finishDay();
    var summary = PlanScreens.joined(SummaryScreen.lines(dc, rig.session, rig.sender));
    Test.assertMessage(summary.find("6") != null, summary);
    Test.assertMessage(summary.find(TrainingText.text(Rez.Strings.SumSave)) != null, summary);
    rig.session.save(rig.outbox);
    var saved = PlanScreens.joined(SummaryScreen.lines(dc, rig.session, rig.sender));
    Test.assertMessage(saved.find(TrainingText.text(Rez.Strings.SumSaved)) != null, saved);
    Test.assertMessage(saved.find(TrainingText.text(Rez.Strings.SumWaiting)) != null, saved);   // saved, not sending yet: no error
    rig.sender.sendAll();
    rig.transport.respond(-104, null);
    var phone = PlanScreens.joined(SummaryScreen.lines(dc, rig.session, rig.sender));
    Test.assertMessage(phone.find(TrainingText.text(Rez.Strings.SumWaiting)) != null, phone);
    rig.clientTimer.fire();
    rig.transport.respond(200, SyncAnswers.stored());
    var sent = PlanScreens.joined(SummaryScreen.lines(dc, rig.session, rig.sender));
    Test.assertMessage(sent.find(TrainingText.text(Rez.Strings.SumSent)) != null, sent);
    Test.assertMessage(sent.find("Neuer Rekord: Bankdrücken 62,5 kg") != null, sent);          // the server's text, unchanged
    Test.assertMessage(sent.find("Bankdrücken nächstes Mal 65 kg") != null, sent);
    PairingLayout.draw(dc, SummaryScreen.lines(dc, rig.session, rig.sender));
    return true;
}

(:test)
function summaryScreenShowsRefusalAndEmptyWorkout(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = PlayerRig.saved();
    rig.sender.sendAll();
    rig.transport.respond(422, SyncAnswers.error("VALIDATION_ERROR", false, "Zeitzone in ChatGPT aktualisieren."));
    var text = PlanScreens.joined(SummaryScreen.lines(dc, rig.session, rig.sender));
    Test.assertMessage(text.find("Zeitzone in ChatGPT aktualisieren.") != null, text);
    Test.assertMessage(text.find(TrainingText.text(Rez.Strings.SumRejected)) != null, text);
    PairingLayout.draw(dc, SummaryScreen.lines(dc, rig.session, rig.sender));
    var day = PlayerRig.dayBody(false);
    PlayerRig.change(day, "cat", 0, "s", []);
    PlayerRig.change(day, "cat", 1, "s", []);
    PlayerRig.change(day, "cat", 3, "s", []);
    var empty = new PlayerRig(false);
    empty.session = TrainingSession.start(day, empty.journal, empty.clock, empty.signals);
    var nothing = PlanScreens.joined(SummaryScreen.lines(dc, empty.session, empty.sender));
    Test.assertMessage(nothing.find(TrainingText.text(Rez.Strings.SumNothing)) != null, nothing);
    var many = { "u" => "x", "records" => ["a", "b", "c", "d", "e"], "next" => [] };
    Expect.equal(SummaryScreen.sentLines(many).size(), 1 + 1 + 3);   // title, label, at most three records
    return true;
}

(:test)
function trainingDelegateSavesAndSendsOnStartOnTheSummary(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.finishDay();
    var delegate = new TrainingDelegate(rig.session, rig.sender);
    Test.assert(delegate.onSelect());
    Expect.equal(rig.outbox.count(), 1);
    Expect.equal(rig.transport.sentCount(), 1);
    Test.assert(delegate.onSelect());                     // a second press does nothing more
    Expect.equal(rig.transport.sentCount(), 1);
    Expect.equal(rig.outbox.count(), 1);
    return true;
}

(:test)
function homeShowsHowManyWorkoutsWait(logger as Logger) as Boolean {
    var none = HomeScreen.withPending([] as Array<PairingLine>, 0);
    Expect.equal(none.size(), 0);
    var one = PlanScreens.joined(HomeScreen.withPending([] as Array<PairingLine>, 1));
    Test.assertMessage(one.find("1") != null, one);
    var two = PlanScreens.joined(HomeScreen.withPending([] as Array<PairingLine>, 2));
    Test.assertMessage(two.find("2") != null, two);
    Test.assert(!one.equals(two));
    return true;
}
