import Toybox.Application;
import Toybox.Lang;
import Toybox.Test;
import Toybox.WatchUi;

// Counts the signals instead of vibrating.
(:test)
class RecordingSignals extends Signals {
    var warnings as Number = 0;
    var ends as Number = 0;

    function initialize() {
        Signals.initialize(null);
    }

    function warn() as Void {
        warnings++;
    }

    function restOver() as Void {
        ends++;
    }
}

// Does not open a screen, only remembers that it would have.
(:test)
class TestLauncher extends TrainingLauncher {
    var shown as Array<TrainingSession>;

    function initialize(journal as Journal, clock as PairingClock, signals as Signals, sender as OutboxSender) {
        TrainingLauncher.initialize(journal, clock, signals, sender);
        shown = [] as Array<TrainingSession>;
    }

    function newRecorder(workoutUuid as String) as Recorder {
        return new Recorder(workoutUuid, new FakeBackend());
    }

    function show(session as TrainingSession) as Void {
        session.attachRecorder(recorderFor(session.uuid));
        shown.add(session);
    }
}

// A workout day, the journal and the fakes around it.
(:test)
class PlayerRig {
    var store as MemoryStore;
    var journal as Journal;
    var clock as FakeClock;
    var signals as RecordingSignals;
    var day as Dictionary;
    var session as TrainingSession;
    var transport as FakeTransport;
    var clientTimer as FakeScheduler;
    var client as ApiClient;
    var outbox as Outbox;
    var sender as OutboxSender;
    var rejected as CallCounter;

    // Day: A 3 sets 8 x 60 kg, rest 120 s; B left and right 10 x 20 kg, rest 60 s (per side);
    // C without sets; D one set 5 x 10 kg, rest 0 s. withUnknown adds E with unknown reps and weight.
    function initialize(withUnknown as Boolean) {
        store = new MemoryStore();
        journal = new Journal(store);
        clock = new FakeClock();
        signals = new RecordingSignals();
        transport = new FakeTransport();
        clientTimer = new FakeScheduler();
        client = new ApiClient("http://mock/api/watch/v1", transport, clientTimer);
        outbox = new Outbox(store);
        rejected = new CallCounter();
        sender = new OutboxSender(client, outbox, journal, clock, rejected.method(:onCall));
        day = PlayerRig.dayBody(withUnknown);
        session = TrainingSession.start(day, journal, clock, signals);
    }

    // day[list][index][key] = value
    static function change(day as Dictionary, list as String, index as Number, key as String, value as Object or Null) as Void {
        var entry = (day[list] as Array)[index] as Dictionary;
        entry[key] = value;
    }

    static function dayBody(withUnknown as Boolean) as Dictionary {
        var cat = [
            { "id" => "ex_a", "n" => "Bankdrücken", "g" => 2500, "l" => { "b" => "total" }, "s" => [[3, 8, 60000]] },
            { "id" => "ex_b", "n" => "Bizeps einarmig", "g" => 1000, "l" => { "b" => "per_implement", "s" => "pro Hantel" }, "rb" => "per_side",
              "s" => [[1, 10, 20000, "left"], [1, 10, 20000, "right"]] },
            { "id" => "ex_c", "n" => "Dehnen", "g" => 1000, "l" => { "b" => "total" }, "s" => [] },
            { "id" => "ex_d", "n" => "Klimmzüge", "g" => 1000, "l" => { "b" => "added" }, "s" => [[1, 5, 10000]] }
        ] as Array;
        var items = [
            { "id" => "it_a", "c" => 0, "r" => 120, "rr" => [6, 10], "h" => "Heute +2,5 kg", "l" => "Letztes Mal 8 · 8 · 7" },
            { "id" => "it_b", "c" => 1, "r" => 60, "rr" => null },
            { "id" => "it_c", "c" => 2, "r" => 90, "rr" => null },
            { "id" => "it_d", "c" => 3, "r" => 0, "rr" => null }
        ] as Array;
        if (withUnknown) {
            cat.add({ "id" => "ex_e", "n" => "Neue Übung", "g" => 1000, "l" => { "b" => "total" }, "s" => [[1, null, null]] });
            items.add({ "id" => "it_e", "c" => 4, "r" => 60, "rr" => null });
        }
        return { "api_version" => 1, "min_app_version" => "1.0.0", "p" => "plv_1", "id" => "d1", "n" => "Oberkörper A", "cat" => cat, "items" => items };
    }

    // The whole day: A three sets, B left and right, C skipped, D one set; finished.
    function finishDay() as Void {
        toFirstSet();
        for (var i = 0; i < 3; i++) {
            setAndRest();
        }
        session.confirmPreview();
        setAndRest();
        session.confirmSet();
        session.endRest();
        session.confirmPreview();
        session.confirmSet();
    }

    // A finished workout, saved and ready to send.
    static function saved() as PlayerRig {
        var rig = new PlayerRig(false);
        rig.finishDay();
        rig.session.save(rig.outbox);
        return rig;
    }

    // A sender with its own fake network, for tests that only need a launcher.
    static function senderFor(store as MemoryStore, clock as PairingClock) as OutboxSender {
        var client = new ApiClient("http://mock/api/watch/v1", new FakeTransport(), new FakeScheduler());
        return new OutboxSender(client, new Outbox(store), new Journal(store), clock, new CallCounter().method(:onCall));
    }

    // The app was closed and opened again: the workout is read from the journal.
    function restart() as TrainingSession or Null {
        return TrainingSession.resume(journal, clock, signals);
    }

    // PREVIEW to the first set.
    function toFirstSet() as Void {
        session.confirmPreview();
    }

    // Confirms the current set and lets the whole rest pass.
    function setAndRest() as Void {
        session.confirmSet();
        if (session.state == TrainingSession.STATE_REST) {
            session.endRest();
        }
    }
}

(:test)
function trainingPlanExpandsRunsAndSides(logger as Logger) as Boolean {
    var plan = new TrainingPlan(PlayerRig.dayBody(false));
    Expect.equal(plan.exerciseCount(), 4);
    Expect.equal(plan.exercises[0].sets.size(), 3);
    Expect.equal(plan.exercises[0].sets[2].reps, 8);
    Expect.equal(plan.exercises[0].sets[2].loadG, 60000);
    Expect.equal(plan.exercises[1].sets[0].side, PlannedSet.SIDE_LEFT);
    Expect.equal(plan.exercises[1].sets[1].side, PlannedSet.SIDE_RIGHT);
    Test.assert(plan.exercises[1].perSide);
    Expect.equal(plan.exercises[1].loadSuffix, "pro Hantel");
    Expect.equal(plan.exercises[2].sets.size(), 0);
    Expect.equal(plan.exercises[0].restSeconds, 120);
    Expect.equal(plan.exercises[0].repMin, 6);
    Expect.equal(plan.exercises[0].hint, "Heute +2,5 kg");
    Expect.equal(plan.setCount(), 6);
    Expect.equal(PlannedSet.sideName(PlannedSet.SIDE_LEFT), "left");
    Expect.equal(PlannedSet.sideName(PlannedSet.SIDE_BOTH), "both");
    return true;
}

(:test)
function trainingPlanKeepsUnknownValuesUnknownAndSkipsBrokenParts(logger as Logger) as Boolean {
    var plan = new TrainingPlan(PlayerRig.dayBody(true));
    var e = plan.exercises[4].sets[0];
    Test.assert(e.reps == null);
    Test.assert(e.loadG == null);
    var day = PlayerRig.dayBody(false);
    (day["items"] as Array).add({ "id" => "it_x", "c" => 99, "r" => 60, "rr" => null });      // catalog index out of range
    (day["items"] as Array).add("not an item");
    (day["cat"] as Array).add({ "id" => "ex_f", "n" => "Zu viele", "g" => 1000, "l" => { "b" => "total" }, "s" => [[50, 5, 1000], "x", [0, 5, 1000], [2]] });
    (day["items"] as Array).add({ "id" => "it_f", "c" => 4, "r" => 60, "rr" => null });
    var broken = new TrainingPlan(day);
    Expect.equal(broken.exerciseCount(), 5);
    Expect.equal(broken.exercises[4].sets.size(), 30);   // capped, malformed runs ignored
    return true;
}

(:test)
function trainingStartWritesTheJournalFirst(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    Expect.equal(rig.journal.activeId(), rig.session.uuid);
    Test.assert(Uuid.isV4(rig.session.uuid));
    var head = rig.journal.readHead(rig.session.uuid) as Dictionary;
    Expect.field(head, "st", TrainingSession.STATE_PREVIEW);
    Expect.equal(head["nm"] as String, "Oberkörper A");
    Expect.field(head, "n", 0);
    Test.assert(rig.journal.readPlan(rig.session.uuid) != null);
    Expect.equal(rig.store.values.size(), 3);   // active, head, plan copy
    Expect.equal(rig.session.state, TrainingSession.STATE_PREVIEW);
    Expect.equal(rig.session.exercise().name, "Bankdrücken");
    return true;
}

(:test)
function trainingSetConfirmationIsJournaledBeforeTheStateChanges(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    rig.clock.now += 40;
    Test.assert(rig.session.confirmSet());
    // the event is in the journal and the head already counts it
    var events = rig.journal.events(rig.session.uuid);
    Expect.equal(events.size(), 1);
    var event = events[0];
    Expect.field(event, "k", Journal.EVENT_SET);
    Expect.field(event, "e", 0);
    Expect.field(event, "s", 0);
    Expect.field(event, "r", 8);
    Expect.field(event, "g", 60000);
    Expect.field(event, "d", PlannedSet.SIDE_BOTH);
    Expect.equal((event["b"] as Number) - (event["a"] as Number), 40);
    Expect.field((rig.journal.readHead(rig.session.uuid) as Dictionary), "n", 1);
    Expect.equal(rig.session.state, TrainingSession.STATE_REST);
    Expect.equal(rig.session.restRemaining(), 120);
    Expect.equal(rig.session.setsDone(), 1);
    return true;
}

(:test)
function trainingRestRunsOnTimestampsAndSignals(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 100;
    Expect.equal(rig.session.restRemaining(), 20);
    Test.assert(!rig.session.tick());
    Expect.equal(rig.signals.warnings, 0);
    rig.clock.now += 10;                               // 10 s left
    Test.assert(!rig.session.tick());
    Test.assert(!rig.session.tick());
    Expect.equal(rig.signals.warnings, 1);             // once
    rig.clock.now += 10;                               // over
    Test.assert(rig.session.tick());
    Expect.equal(rig.signals.ends, 1);
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    Expect.equal(rig.session.setIdx, 1);
    return true;
}

(:test)
function trainingRestAfterAHangIsRightAndQuiet(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 400;                              // the watch hung, no tick for a long time
    Expect.equal(rig.session.restRemaining(), -280);
    Test.assert(rig.session.tick());
    Expect.equal(rig.signals.ends, 0);                 // too long ago for a signal
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    // a hang of a few seconds still signals
    rig.session.confirmSet();
    rig.clock.now += 125;
    Test.assert(rig.session.tick());
    Expect.equal(rig.signals.ends, 1);
    return true;
}

(:test)
function trainingRestCanBeChangedByFifteenSecondsAndEndedEarly(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.session.adjustRest(15);
    Expect.equal(rig.session.restRemaining(), 135);
    rig.session.adjustRest(-15);
    rig.session.adjustRest(-15);
    Expect.equal(rig.session.restRemaining(), 105);
    Expect.field((rig.journal.readHead(rig.session.uuid) as Dictionary), "rl", 105);   // kept for a restart
    rig.session.adjustRest(-120);                      // below zero: the rest is over
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    rig.session.confirmSet();
    rig.session.adjustRest(2000);                      // capped
    Expect.equal(rig.session.restRemaining(), 900);
    rig.session.endRest();                             // START ends it early
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    Expect.equal(rig.session.setIdx, 2);
    return true;
}

(:test)
function trainingRestWarnsAgainWhenItIsMadeLonger(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 112;
    rig.session.tick();
    Expect.equal(rig.signals.warnings, 1);
    rig.session.adjustRest(15);                        // 23 s left again
    rig.clock.now += 14;
    rig.session.tick();
    Expect.equal(rig.signals.warnings, 2);
    return true;
}

(:test)
function trainingGoesThroughTheDayAndEndsAfterTheLastSet(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) {                      // exercise A: three sets
        rig.setAndRest();
    }
    // after the last set of A: the rest, then the preview of B (C has no sets and is passed over)
    Expect.equal(rig.session.state, TrainingSession.STATE_PREVIEW);
    Expect.equal(rig.session.exercise().name, "Bizeps einarmig");
    rig.session.confirmPreview();
    var set = rig.session.currentSet() as PlannedSet;
    Expect.equal(set.side, PlannedSet.SIDE_LEFT);
    rig.setAndRest();
    Expect.equal((rig.session.currentSet() as PlannedSet).side, PlannedSet.SIDE_RIGHT);
    rig.session.confirmSet();                           // last set of B: rest, then D (C skipped)
    Expect.equal(rig.session.state, TrainingSession.STATE_REST);
    Expect.equal(rig.session.nextExerciseIndex(), 3);
    rig.session.endRest();
    Expect.equal(rig.session.exercise().name, "Klimmzüge");
    rig.session.confirmPreview();
    rig.session.confirmSet();                           // the last set of the day: no rest
    Expect.equal(rig.session.state, TrainingSession.STATE_FINISHED);
    Test.assert(rig.session.isFinished());
    Expect.equal(rig.session.setsDone(), 6);
    // journal: 6 sets and the skipped exercise C in between
    var events = rig.journal.events(rig.session.uuid);
    Expect.equal(events.size(), 7);
    var skips = 0;
    for (var i = 0; i < events.size(); i++) {
        if ((events[i]["k"] as Number) == Journal.EVENT_SKIP) {
            skips++;
            Expect.field(events[i], "e", 2);
        }
    }
    Expect.equal(skips, 1);
    return true;
}

(:test)
function trainingRepsThatAreUnknownCannotBeConfirmed(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) {
        rig.setAndRest();
    }
    rig.session.confirmPreview();
    rig.setAndRest();
    rig.setAndRest();                                   // B done; D follows
    rig.session.confirmPreview();
    rig.session.confirmSet();                           // D, rest 0: straight on to E
    Expect.equal(rig.session.exercise().name, "Neue Übung");
    rig.session.confirmPreview();
    var before = rig.journal.events(rig.session.uuid).size();
    Test.assert(!rig.session.confirmSet());             // reps unknown: nothing is invented
    Expect.equal(rig.journal.events(rig.session.uuid).size(), before);
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    return true;
}

(:test)
function trainingUnknownWeightIsSavedAsUnknownNotZero(logger as Logger) as Boolean {
    var day = PlayerRig.dayBody(false);
    PlayerRig.change(day, "cat", 0, "s", [[1, 5, null]]);
    var rig = new PlayerRig(false);
    rig.session = TrainingSession.start(day, rig.journal, rig.clock, rig.signals);
    rig.toFirstSet();
    Test.assert(rig.session.confirmSet());
    var last = rig.journal.events(rig.session.uuid)[0];
    Test.assert(!last.hasKey("g"));                      // unknown stays unknown, never 0
    Expect.field(last, "r", 5);
    return true;
}

(:test)
function trainingSurvivesACrashAfterASetConfirmation(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.clock.now += 30;
    rig.session.confirmSet();
    rig.session.endRest();
    rig.clock.now += 20;
    rig.session.confirmSet();                           // set 2 confirmed, then the app dies
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.setsDone(), 2);
    Expect.equal(resumed.state, TrainingSession.STATE_REST);
    Expect.equal(resumed.exIdx, 0);
    Expect.equal(resumed.setIdx, 1);
    Expect.equal(resumed.restRemaining(), 120);
    rig.clock.now += 30;
    Expect.equal(resumed.restRemaining(), 90);          // the rest kept running by the clock
    return true;
}

(:test)
function trainingCrashBetweenEventAndHeadTakesTheEventOver(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    // the event of set 1 is written, the head is not updated yet
    rig.journal.appendEvent(rig.session.uuid, 0, {
        "k" => Journal.EVENT_SET, "e" => 0, "s" => 0, "r" => 8, "g" => 60000, "d" => 0,
        "a" => rig.clock.now - 20, "b" => rig.clock.now
    });
    Expect.field((rig.journal.readHead(rig.session.uuid) as Dictionary), "n", 0);
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.setsDone(), 1);
    Expect.equal(resumed.state, TrainingSession.STATE_REST);
    Expect.field((rig.journal.readHead(rig.session.uuid) as Dictionary), "n", 1);
    return true;
}

(:test)
function trainingIgnoresAnEventThatWasWrittenOnlyInPart(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    var torn = rig.store.values[StoreKeys.sessionEvent(rig.session.uuid, 0)] as Dictionary;
    torn["r"] = 9;                                      // content no longer matches its checksum
    Expect.equal(rig.journal.events(rig.session.uuid).size(), 0);
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.setsDone(), 0);                // reading goes on with what is intact
    Test.assert(rig.journal.activeId() != null);
    return true;
}

(:test)
function trainingUnreadableWorkoutIsRemovedAndDoesNotBlock(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.store.setValue(StoreKeys.sessionHead(rig.session.uuid), "broken");
    Test.assert(rig.restart() == null);
    Test.assert(rig.journal.activeId() == null);
    Expect.equal(rig.store.values.size(), 0);
    // missing plan copy
    var other = new PlayerRig(false);
    other.store.deleteValue(StoreKeys.sessionPlan(other.session.uuid));
    Test.assert(other.restart() == null);
    Test.assert(other.journal.activeId() == null);
    // a head that points outside the plan
    var third = new PlayerRig(false);
    var head = third.journal.readHead(third.session.uuid) as Dictionary;
    head["ex"] = 9;
    third.journal.saveHead(third.session.uuid, head);
    Test.assert(third.restart() == null);
    return true;
}

(:test)
function trainingWithoutAWorkoutHasNothingToResume(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var journal = new Journal(store);
    Test.assert(TrainingSession.resume(journal, new FakeClock(), new RecordingSignals()) == null);
    store.setValue(StoreKeys.ACTIVE_SESSION, "not-a-uuid");
    Test.assert(journal.activeId() == null);
    return true;
}

(:test)
function trainingResumeStartsTheRunningSetOver(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.clock.now += 600;                               // the set was open for a long time, then the app died
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.state, TrainingSession.STATE_SET);
    rig.clock.now += 25;
    resumed.confirmSet();
    var event = rig.journal.events(resumed.uuid)[0];
    Expect.equal((event["b"] as Number) - (event["a"] as Number), 25);   // time counted from the restart
    return true;
}

(:test)
function trainingRestEndedWhileTheAppWasClosedGoesOn(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 500;
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.state, TrainingSession.STATE_SET);
    Expect.equal(resumed.setIdx, 1);
    Expect.equal(rig.signals.ends, 0);
    return true;
}

(:test)
function trainingPauseFreezesTheRestAndContinues(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 30;
    rig.session.pause();
    Test.assert(rig.session.paused);
    rig.clock.now += 3000;
    Expect.equal(rig.session.restRemaining(), 90);       // stands still
    Test.assert(!rig.session.tick());
    var resumed = rig.restart() as TrainingSession;      // continue from the start screen
    Test.assert(!resumed.paused);
    Expect.equal(resumed.restRemaining(), 90);
    rig.clock.now += 10;
    Expect.equal(resumed.restRemaining(), 80);
    return true;
}

(:test)
function trainingPausedWorkoutCannotBeConfirmed(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.pause();
    Test.assert(!rig.session.confirmSet());
    Expect.equal(rig.journal.events(rig.session.uuid).size(), 0);
    Test.assert(rig.session.state == TrainingSession.STATE_SET);
    return true;
}

(:test)
function trainingResumeWorksWithoutThePlanCache(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    var cache = new PlanCache(rig.store);
    cache.clear();                                       // the plan on the watch is gone (new plan, sign-out)
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.exercise().name, "Bankdrücken");  // the workout runs on its own copy (PRD P-05)
    return true;
}

(:test)
function trainingFinishedWorkoutStaysInTheJournalUntilItIsSent(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) { rig.setAndRest(); }
    rig.session.confirmPreview();
    rig.setAndRest();
    rig.session.confirmSet();
    rig.session.endRest();
    rig.session.confirmPreview();
    rig.session.confirmSet();
    Test.assert(rig.session.isFinished());
    var resumed = rig.restart() as TrainingSession;
    Test.assert(resumed.isFinished());
    Expect.equal(resumed.setsDone(), 6);
    return true;
}

(:test)
function journalChecksumCatchesChangedFieldsAndStopsAtTheFirstDamage(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var journal = new Journal(store);
    var id = Uuid.v4();
    for (var i = 0; i < 3; i++) {
        journal.appendEvent(id, i, { "k" => Journal.EVENT_SET, "e" => 0, "s" => i, "r" => 8, "g" => 60000, "d" => 0, "a" => 1000 + i, "b" => 1010 + i });
    }
    Expect.equal(journal.events(id).size(), 3);
    var hit = store.values[StoreKeys.sessionEvent(id, 1)] as Dictionary;
    hit["g"] = 70000;
    Expect.equal(journal.events(id).size(), 1);          // stops at the damaged one, ignores what follows
    // a gap ends the list too
    store.deleteValue(StoreKeys.sessionEvent(id, 0));
    Expect.equal(journal.events(id).size(), 0);
    return true;
}

(:test)
function journalDiscardRemovesEverythingOfAWorkout(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    rig.setAndRest();
    Test.assert(rig.store.values.size() > 4);
    rig.journal.discard(rig.session.uuid);
    Expect.equal(rig.store.values.size(), 0);
    Test.assert(rig.journal.activeId() == null);
    // another workout's marker is not touched
    var other = new PlayerRig(false);
    other.journal.discard(Uuid.v4());
    Test.assert(other.journal.activeId() != null);
    return true;
}

(:test)
function journalEventsStayBelow100BytesOfFields(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();
    var event = rig.journal.events(rig.session.uuid)[0];
    Expect.equal(event.size(), 10);                      // k e s r g d a b n c
    return true;
}

(:test)
function trainingTextWritesWeightsAsTheServerSentThem(logger as Logger) as Boolean {
    Expect.equal(TrainingText.kg(60000, "."), "60");
    Expect.equal(TrainingText.kg(62500, "."), "62.5");
    Expect.equal(TrainingText.kg(62500, ","), "62,5");
    Expect.equal(TrainingText.kg(1250, ","), "1,25");
    Expect.equal(TrainingText.kg(100, "."), "0.1");
    Expect.equal(TrainingText.kg(0, "."), "0");
    Expect.equal(TrainingText.kg(2005, "."), "2.005");
    var sep = TrainingText.separator();
    Test.assert(sep.equals(",") || sep.equals("."));
    Expect.equal(TrainingText.clock(125), "2:05");
    Expect.equal(TrainingText.clock(-4), "0:00");
    var set = new PlannedSet(8, 60000, PlannedSet.SIDE_BOTH);
    Test.assert(TrainingText.repsAndLoad(set).find("8 x 60") == 0);
    Expect.equal(TrainingText.repsAndLoad(new PlannedSet(8, null, PlannedSet.SIDE_BOTH)), "8 x");
    Test.assert(TrainingText.repsAndLoad(new PlannedSet(null, 60000, PlannedSet.SIDE_BOTH)).find("?") == 0);
    Test.assert(TrainingText.sideText(PlannedSet.SIDE_BOTH) == null);
    Test.assert(TrainingText.sideText(PlannedSet.SIDE_LEFT) != null);
    return true;
}

(:test)
function trainingScreensShowWhatTheWorkoutNeeds(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = new PlayerRig(true);
    var preview = PlanScreens.joined(TrainingScreen.lines(dc, rig.session, null, null));
    Test.assertMessage(preview.find("Bankdrücken") != null, preview);
    Test.assertMessage(preview.find("3") != null, preview);
    Test.assertMessage(preview.find("Heute +2,5 kg") != null, preview);    // the server's hint, unchanged
    rig.toFirstSet();
    var set = FaceText.joined(SetScreen.face(rig.session, 132, 0));
    Test.assertMessage(set.find("|60|kg|8|Wdh.|") != null || set.find("|60|kg|8|reps|") != null, set);    // the weight is the main number
    var page2 = FaceText.joined(SetScreen.face(rig.session, 132, 1));
    Test.assertMessage(page2.find("132") != null, page2);
    Test.assertMessage(page2.find("Letztes Mal 8") != null, page2);    // the server's text, wrapped in two lines
    var noPulse = FaceText.joined(SetScreen.face(rig.session, null, 1));
    Test.assertMessage(noPulse.find("|–|") != null, noPulse);
    Test.assertMessage(noPulse.find("|0|") == null, noPulse);
    rig.session.confirmSet();
    var rest = FaceText.joined(RestScreen.face(rig.session, 90, 0));
    Test.assertMessage(rest.find("2:00") != null, rest);
    return true;
}

(:test)
function trainingScreensShowSidesAndOpenValues(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) { rig.setAndRest(); }
    rig.session.confirmPreview();
    var left = FaceText.joined(SetScreen.face(rig.session, null, 0));
    Test.assertMessage(left.find(TrainingText.text(Rez.Strings.TrLeft)) != null, left);
    rig.setAndRest();
    var right = FaceText.joined(SetScreen.face(rig.session, null, 0));
    Test.assertMessage(right.find(TrainingText.text(Rez.Strings.TrRight)) != null, right);
    rig.setAndRest();
    rig.session.confirmPreview();
    rig.session.confirmSet();
    rig.session.confirmPreview();
    var open = FaceText.joined(SetScreen.face(rig.session, null, 0));
    Test.assertMessage(open.find(TrainingText.text(Rez.Strings.UhrRepsOpen)) != null, open);
    return true;
}

(:test)
function trainingViewDrawsEveryState(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = new PlayerRig(false);
    PairingLayout.draw(dc, TrainingScreen.lines(dc, rig.session, null, null));    // preview
    rig.toFirstSet();
    Instrument.draw(dc, TrainingScreen.face(rig.session, 140, 0));                // set
    rig.session.confirmSet();
    Instrument.draw(dc, TrainingScreen.face(rig.session, null, 0));               // rest
    rig.clock.now += 112;
    Instrument.draw(dc, TrainingScreen.face(rig.session, 99, 0));                 // rest, warning colour
    var long = PlayerRig.dayBody(false);
    PlayerRig.change(long, "cat", 0, "n", "Kurzhantel-Schrägbankdrücken eng mit Pause unten");
    var rig2 = new PlayerRig(false);
    rig2.session = TrainingSession.start(long, rig2.journal, rig2.clock, rig2.signals);
    rig2.session.confirmPreview();
    Instrument.draw(dc, TrainingScreen.face(rig2.session, null, 0));              // long name
    var done = new PlayerRig(false);
    done.toFirstSet();
    for (var i = 0; i < 3; i++) { done.setAndRest(); }
    done.session.confirmPreview();
    done.setAndRest();
    done.session.confirmSet();
    done.session.endRest();
    done.session.confirmPreview();
    done.session.confirmSet();
    PairingLayout.draw(dc, TrainingScreen.lines(dc, done.session, null, null));  // finished
    return true;
}

(:test)
function trainingDelegateFollowsTheKeys(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    var delegate = new TrainingDelegate(rig.session, rig.sender);
    Test.assert(delegate.onSelect());                    // preview -> set
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    Test.assert(delegate.onSelect());                    // set -> rest
    Expect.equal(rig.session.state, TrainingSession.STATE_REST);
    Test.assert(delegate.onPreviousPage());              // UP: +15 s
    Expect.equal(rig.session.restRemaining(), 135);
    Test.assert(delegate.onNextPage());                  // DOWN: -15 s
    Expect.equal(rig.session.restRemaining(), 120);
    Test.assert(delegate.onSelect());                    // START ends the rest
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    Test.assert(delegate.onNextPage());                  // DOWN on a set: reserved, changes nothing
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    Test.assert(delegate.onMenu());
    Expect.equal(rig.journal.events(rig.session.uuid).size(), 1);   // only the one set confirmed with START
    return true;
}

(:test)
function trainingLauncherStartsContinuesAndNeverDuplicates(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var journal = new Journal(store);
    var launcher = new TestLauncher(journal, new FakeClock(), new RecordingSignals(), PlayerRig.senderFor(store, new FakeClock()));
    Test.assert(launcher.activeName() == null);
    Test.assert(!launcher.begin(null));                  // nothing to start or continue
    Test.assert(launcher.begin(PlayerRig.dayBody(false)));
    Expect.equal(launcher.shown.size(), 1);
    Expect.equal(launcher.activeName(), "Oberkörper A");
    // the app starts again: the workout in progress is continued, another day does not start a second one
    var again = new TestLauncher(journal, new FakeClock(), new RecordingSignals(), PlayerRig.senderFor(store, new FakeClock()));
    var other = PlayerRig.dayBody(false);
    other["id"] = "d2";
    other["n"] = "Beine";
    Test.assert(again.begin(other));
    Expect.equal(again.shown[0].uuid, launcher.shown[0].uuid);
    Expect.equal(again.shown[0].dayName(), "Oberkörper A");
    return true;
}

(:test)
function homeShowsAWorkoutInProgress(logger as Logger) as Boolean {
    var lines = HomeScreen.resumeLines("Oberkörper A");
    var texts = PlanScreens.joined(lines);
    Test.assertMessage(texts.find("Oberkörper A") != null, texts);
    Test.assertMessage(texts.find(WatchUi.loadResource(Rez.Strings.HomeResume) as String) != null, texts);
    return true;
}

(:test)
function signalsReadTheSwitchesAndDefaultToOn(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var signals = new Signals(store);
    signals.warn();                                      // nothing stored: on, does not fail
    signals.restOver();
    store.setValue(StoreKeys.SETTINGS, { "vib" => false, "tone" => false, "warn" => false });
    signals.warn();
    signals.restOver();
    new Signals(null).warn();
    return true;
}
