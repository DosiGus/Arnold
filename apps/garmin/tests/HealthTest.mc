import Toybox.Communications;
import Toybox.Lang;
import Toybox.Test;

// Health values of the watch (GAR-B4-02): consent, gaps, budget, sending.

// Values from a fake watch; counts how often it was asked.
(:test)
class FakeHealthSource extends HealthSource {
    var battery as Number or Null;
    var stressValue as Number or Null;
    var resting as Number or Null;
    var hr as Number or Null;
    var recovery as Numeric or Null;
    var effect as Numeric or Null;
    var reads as Number;
    var failing as Boolean;

    function initialize() {
        HealthSource.initialize();
        battery = 64;
        stressValue = 31;
        resting = 52;
        hr = 100;
        recovery = 18;
        effect = 2.5;
        reads = 0;
        failing = false;
    }

    function touch() as Void {
        reads++;
        if (failing) {
            throw new StepFailed();
        }
    }

    function bodyBattery(now as Number) as Number or Null {
        touch();
        return battery;
    }

    function stress(now as Number) as Number or Null {
        touch();
        return stressValue;
    }

    function restingHr() as Number or Null {
        touch();
        return resting;
    }

    function heartRate() as Number or Null {
        touch();
        return hr;
    }

    function recoveryTimeH() as Numeric or Null {
        touch();
        return recovery;
    }

    function trainingEffect() as Numeric or Null {
        touch();
        return effect;
    }
}

(:test)
class HealthRig {
    var rig as PlayerRig;
    var source as FakeHealthSource;
    var consent as HealthConsent;
    var health as HealthOutbox;
    var sender as HealthSender;
    var capture as HealthCapture;

    function initialize(consentOn as Boolean) {
        rig = new PlayerRig(false);
        source = new FakeHealthSource();
        consent = new HealthConsent(rig.store);
        if (consentOn) {
            consent.set(true, 0);
        }
        health = new HealthOutbox(rig.store);
        sender = new HealthSender(rig.client, health, rig.outbox, consent, rig.clock, rig.rejected.method(:onCall));
        capture = new HealthCapture("w1", source, rig.store, consent, health, rig.clock);
    }

    // `steps` seconds-5 ticks of the workout.
    function run(steps as Number) as Void {
        for (var i = 0; i < steps; i++) {
            rig.clock.now += 5;
            capture.tick();
        }
    }

    function body() as Dictionary {
        return (health.get("w1") as Dictionary)["b"] as Dictionary;
    }

    function values() as Array {
        return (body()["hr"] as Dictionary)["values"] as Array;
    }
}

(:test)
function withoutConsentNothingIsReadStoredOrSent(logger as Logger) as Boolean {
    var h = new HealthRig(false);
    h.capture.resume();
    h.run(30);
    h.capture.pause();
    h.capture.resume();
    h.run(5);
    h.capture.finish();
    Test.assertEqual(0, h.source.reads);                 // not even asked
    Test.assertEqual(0, h.health.count());
    Test.assert(h.rig.store.getValue(StoreKeys.heartRateBlock("w1", 0)) == null);
    h.sender.sendAll();                                  // only the question about the consent goes out
    Test.assertEqual(1, h.rig.transport.sentCount());
    Expect.equal(h.rig.transport.urls[0], "http://mock/api/watch/v1/device");
    return true;
}

(:test)
function anUnknownConsentCountsAsNo(logger as Logger) as Boolean {
    var h = new HealthRig(false);
    Test.assert(!h.consent.isOn());
    h.rig.store.setValue(StoreKeys.HEALTH_CONSENT, "kaputt");
    Test.assert(!h.consent.isOn());
    return true;
}

(:test)
function withConsentTheValuesBeforeDuringAndAfterAreCollected(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    var startedAt = h.rig.clock.now;
    h.capture.resume();
    h.run(12);
    h.capture.finish();
    Test.assertEqual(1, h.health.count());
    var body = h.body();
    var hr = body["hr"] as Dictionary;
    Expect.field(hr, "interval_s", 5);
    Expect.field(hr, "start_utc", Clock.isoUtc(startedAt));
    Test.assertEqual(13, h.values().size());
    Expect.equal(h.values()[0] as Number, 100);
    var before = body["before"] as Dictionary;
    Expect.field(before, "at_utc", Clock.isoUtc(startedAt));
    Expect.field(before, "body_battery", 64);
    Expect.field(before, "stress", 31);
    Expect.field(before, "resting_hr", 52);
    var after = body["after"] as Dictionary;
    Expect.field(after, "at_utc", Clock.isoUtc(h.rig.clock.now));
    Expect.field(after, "body_battery", 64);
    var extras = body["extras"] as Dictionary;
    Expect.field(extras, "recovery_time_h", 18);
    Expect.field(extras, "training_effect_aerobic", 2.5);
    Test.assertEqual(4, body.size());                    // hr, before, after, extras
    return true;
}

(:test)
function missingValuesStayEmptyNeverZero(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.source.battery = null;
    h.source.stressValue = null;
    h.source.recovery = null;
    h.source.effect = null;
    h.capture.resume();
    h.run(4);
    h.capture.finish();
    var body = h.body();
    var before = body["before"] as Dictionary;
    Test.assert(!before.hasKey("body_battery"));
    Test.assert(!before.hasKey("stress"));
    Expect.field(before, "resting_hr", 52);
    Test.assert(!body.hasKey("extras"));
    return true;
}

(:test)
function nothingKnownMeansNoRequestAtAll(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.source.battery = null;
    h.source.stressValue = null;
    h.source.resting = null;
    h.source.hr = null;
    h.source.recovery = null;
    h.source.effect = null;
    h.capture.resume();
    h.run(10);
    h.capture.finish();
    Test.assertEqual(0, h.health.count());
    return true;
}

(:test)
function gapsAndPausesAreZeroAndTrailingZerosAreCut(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.capture.resume();       // t0
    h.run(2);                 // t5, t10: three values
    h.capture.pause();
    h.rig.clock.now += 55;    // a pause until t65
    h.capture.resume();       // t65: slot 13
    h.source.hr = null;       // the sensor loses the signal
    h.run(3);                 // slots 14, 15, 16 without a reading
    h.capture.finish();
    var values = h.values();
    Test.assertEqual(14, values.size());                 // the three zeros at the end are cut
    Expect.equal(values[2] as Number, 100);
    Expect.equal(values[3] as Number, 0);                          // the pause is a gap
    Expect.equal(values[12] as Number, 0);
    Expect.equal(values[13] as Number, 100);
    return true;
}

(:test)
function twoHoursOfHeartRateFitTheBudget(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.capture.resume();
    h.run(1439);
    h.capture.finish();
    var values = h.values();
    Test.assertEqual(1440, values.size());
    var chars = 0;
    for (var i = 0; i < values.size(); i++) {
        chars += (values[i] as Number).toString().length() + 1;
    }
    Test.assert(chars < 8000);                           // about 6 KB, one storage value stays far below 32 KB
    Test.assert(values.size() <= 12000);                 // the limit of the contract
    // the blocks are gone after the request is built
    Test.assert(h.rig.store.getValue(StoreKeys.heartRateBlock("w1", 0)) == null);
    Test.assert(h.rig.store.getValue(StoreKeys.heartRateBlock("w1", 23)) == null);
    return true;
}

(:test)
function heartRateGoesToStorageInBlocksWhileTraining(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.capture.resume();
    h.run(70);
    Test.assert(h.rig.store.getValue(StoreKeys.heartRateBlock("w1", 0)) instanceof Array);
    h.capture.discard();
    Test.assert(h.rig.store.getValue(StoreKeys.heartRateBlock("w1", 0)) == null);
    Test.assertEqual(0, h.health.count());
    return true;
}

(:test)
function consentWithdrawnWhileTrainingDeletesWhatWasKept(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.capture.resume();
    h.run(70);
    h.consent.set(false, 0);
    h.run(2);
    h.capture.finish();
    Test.assert(h.capture.isDone());
    Test.assert(h.rig.store.getValue(StoreKeys.heartRateBlock("w1", 0)) == null);
    Test.assertEqual(0, h.health.count());
    return true;
}

(:test)
function aFailingSourceNeverReachesThePlayer(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.source.failing = true;
    h.capture.resume();
    h.run(5);
    h.capture.pause();
    h.capture.finish();                                  // no exception, nothing saved
    Test.assertEqual(0, h.health.count());
    return true;
}

(:test)
function healthWorksWithTheRecorderAndSavesWithTheWorkout(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    var recorder = new Recorder(h.rig.session.uuid, new FakeBackend());
    var capture = new HealthCapture(h.rig.session.uuid, h.source, h.rig.store, h.consent, h.health, h.rig.clock);
    recorder.attachHealth(capture);
    h.rig.session.attachRecorder(recorder);
    h.rig.finishDay();
    h.rig.clock.now += 5;
    h.rig.session.tick();
    Test.assert(h.rig.session.save(h.rig.outbox));
    Test.assertEqual(1, h.health.count());
    Test.assert(h.health.contains(h.rig.session.uuid));
    return true;
}

(:test)
function aFailedRecordingDoesNotStopTheHealthValues(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    var backend = new FakeBackend();
    backend.refuseOpen = true;                           // the watch refuses the FIT recording
    var recorder = new Recorder("w1", backend);
    recorder.attachHealth(h.capture);
    recorder.resume();
    for (var i = 0; i < 4; i++) {
        h.rig.clock.now += 5;
        recorder.tick();
    }
    recorder.save();
    Test.assertEqual(1, h.health.count());
    return true;
}

(:test)
function discardingTheWorkoutDropsItsHealthValues(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    var recorder = new Recorder("w1", new FakeBackend());
    recorder.attachHealth(h.capture);
    recorder.resume();
    h.run(3);
    recorder.save();
    Test.assertEqual(1, h.health.count());
    recorder.discard();                                  // back to the summary, then thrown away
    Test.assertEqual(0, h.health.count());
    return true;
}

(:test)
function savingTwiceNeverBuildsASecondRequest(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.capture.resume();
    h.run(3);
    h.capture.finish();
    var first = h.body();
    h.capture.finish();
    Test.assertEqual(1, h.health.count());
    Test.assert(first == h.body() || first.size() == h.body().size());
    return true;
}

// ── Sending ──

(:test)
class HealthAnswers {
    static function device(consent as Boolean) as Dictionary {
        return { "api_version" => 1, "min_app_version" => "1.0.0", "device_id" => "wdv_1", "paired" => true,
            "health_consent" => consent, "server_time_utc" => "2026-11-10T07:00:00Z" };
    }

    static function stored() as Dictionary {
        return { "api_version" => 1, "min_app_version" => "1.0.0", "session_uuid" => "w1", "stored" => true };
    }
}

(:test)
function aConfirmedWorkoutGetsItsValuesAfterTheConsentWasChecked(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.health.add("w1", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90, 91] } }, 1);
    h.sender.sendAll();
    Expect.equal(h.rig.transport.urls[0], "http://mock/api/watch/v1/device");
    h.rig.transport.respond(200, HealthAnswers.device(true));
    Test.assertEqual(2, h.rig.transport.sentCount());
    Expect.equal(h.rig.transport.urls[1], "http://mock/api/watch/v1/workouts/w1/health");
    Test.assert(h.rig.transport.requests[1].method == Communications.HTTP_REQUEST_METHOD_PUT);
    Test.assert(h.rig.transport.requests[1].body != null);
    h.rig.transport.respond(200, HealthAnswers.stored());
    Test.assertEqual(0, h.health.count());
    Test.assertEqual(2, h.rig.transport.sentCount());
    return true;
}

(:test)
function noConsentOnTheServerMeansNothingIsSentAndTheEntriesAreDeleted(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.health.add("w1", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    h.sender.sendAll();
    h.rig.transport.respond(200, HealthAnswers.device(false));
    Test.assertEqual(1, h.rig.transport.sentCount());    // only the question
    Test.assertEqual(0, h.health.count());
    Test.assert(!h.consent.isOn());
    return true;
}

(:test)
function valuesWaitUntilTheServerHasTheWorkout(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();                          // the workout is still in the outbox
    var consent = new HealthConsent(rig.store);
    var health = new HealthOutbox(rig.store);
    var sender = new HealthSender(rig.client, health, rig.outbox, consent, rig.clock, rig.rejected.method(:onCall));
    health.add(rig.session.uuid, { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    sender.sendAll();
    rig.transport.respond(200, HealthAnswers.device(true));
    Test.assertEqual(1, rig.transport.sentCount());       // no PUT before the workout is confirmed
    Test.assertEqual(1, health.count());
    return true;
}

(:test)
function workoutPendingKeepsTheEntryForALaterTry(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.health.add("w1", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    h.sender.sendAll();
    h.rig.transport.respond(200, HealthAnswers.device(true));
    var pending = SyncAnswers.error("WORKOUT_PENDING", true, "later");
    for (var i = 0; i < 3; i++) {
        h.rig.transport.respond(409, pending);
        h.rig.clientTimer.fire();
    }
    h.rig.transport.respond(409, pending);                // gives up for now
    Test.assertEqual(1, h.health.count());
    Test.assert(h.consent.isOn());
    Test.assertEqual(0, h.rig.client.pendingCount());
    return true;
}

(:test)
function aWithdrawnConsentAnswerDeletesTheEntries(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.health.add("w1", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    h.sender.sendAll();
    h.rig.transport.respond(200, HealthAnswers.device(true));
    h.rig.transport.respond(403, SyncAnswers.error("CONSENT_REQUIRED", false, "no"));
    Test.assertEqual(0, h.health.count());
    Test.assert(!h.consent.isOn());
    return true;
}

(:test)
function anInvalidRequestIsDroppedAndNeverBlocks(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.health.add("w1", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    h.health.add("w2", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T08:00:00Z", "values" => [95] } }, 2);
    h.sender.sendAll();
    h.rig.transport.respond(200, HealthAnswers.device(true));
    h.rig.transport.respond(400, SyncAnswers.error("VALIDATION_ERROR", false, "bad"));
    Test.assertEqual(1, h.health.count());
    Expect.equal(h.rig.transport.urls[2], "http://mock/api/watch/v1/workouts/w2/health");   // the next one goes on
    return true;
}

(:test)
function theWorkoutUploadPushesAWaitingHealthRequestAside(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var consent = new HealthConsent(rig.store);
    var health = new HealthOutbox(rig.store);
    var sender = new HealthSender(rig.client, health, rig.outbox, consent, rig.clock, rig.rejected.method(:onCall));
    rig.sender.setHealth(sender);
    sender.sendAll();                                    // the consent question is on its way
    rig.sender.sendAll();                                // now the workout wants to go
    rig.transport.respond(200, HealthAnswers.device(true));   // the answer to the pushed-aside question: ignored
    Test.assertEqual(2, rig.transport.sentCount());
    Expect.equal(rig.transport.urls[1], "http://mock/api/watch/v1/workouts");
    Test.assert(!consent.isOn());                        // nothing was learned from the dropped request
    return true;
}

(:test)
function aConfirmedWorkoutStartsTheHealthPass(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var consent = new HealthConsent(rig.store);
    var health = new HealthOutbox(rig.store);
    rig.sender.setHealth(new HealthSender(rig.client, health, rig.outbox, consent, rig.clock, rig.rejected.method(:onCall)));
    health.add(rig.session.uuid, { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    rig.sender.sendAll();
    rig.transport.respond(200, SyncAnswers.stored());     // the workout arrived
    Test.assertEqual(2, rig.transport.sentCount());
    Expect.equal(rig.transport.urls[1], "http://mock/api/watch/v1/device");   // then the consent question
    rig.transport.respond(200, HealthAnswers.device(true));
    Expect.equal(rig.transport.urls[2], "http://mock/api/watch/v1/workouts/" + rig.session.uuid + "/health");
    return true;
}

(:test)
function aDiscardedWorkoutTakesItsHealthEntryWithIt(logger as Logger) as Boolean {
    var rig = PlayerRig.saved();
    var health = new HealthOutbox(rig.store);
    rig.sender.setHealth(new HealthSender(rig.client, health, rig.outbox, new HealthConsent(rig.store), rig.clock, rig.rejected.method(:onCall)));
    health.add(rig.session.uuid, { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    rig.sender.discard(rig.session.uuid);
    Test.assertEqual(0, health.count());
    return true;
}

(:test)
function oldHealthEntriesExpireAfterFourteenDays(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.health.add("w1", { "hr" => { "interval_s" => 5, "start_utc" => "2026-11-10T07:00:00Z", "values" => [90] } }, 1);
    h.health.prune(1 + h.health.STALE_AFTER_S - 1);
    Test.assertEqual(1, h.health.count());
    h.health.prune(1 + h.health.STALE_AFTER_S);
    Test.assertEqual(0, h.health.count());
    return true;
}

// Heart rate for display and capture (GAR-B3-09): activity data first, the sensor as a fallback, never 0.
(:test)
function liveHeartPrefersTheActivityAndNeverReturnsZero(logger as Logger) as Boolean {
    Test.assert(LiveHeart.pick(131, 120) == 131);
    Test.assert(LiveHeart.pick(null, 120) == 120);
    Test.assert(LiveHeart.pick(0, 120) == 120);
    Test.assert(LiveHeart.pick(131, null) == 131);
    Test.assert(LiveHeart.pick(null, null) == null);
    Test.assert(LiveHeart.pick(0, 0) == null);
    Test.assert(LiveHeart.pick(null, 0) == null);
    Test.assert(LiveHeart.pick(-5, null) == null);
    Test.assert(LiveHeart.pick("x", null) == null);
    Test.assert(!LiveHeart.valid(null));
    Test.assert(!LiveHeart.valid(0));
    Test.assert(LiveHeart.valid(55));
    return true;
}

(:test)
function liveHeartIsOnePathForDisplayAndCapture(logger as Logger) as Boolean {
    // The real source asks LiveHeart; in the simulator without a sensor both say the same: a positive number or null.
    var viaSource = new WatchHealthSource().heartRate();
    var viaLive = LiveHeart.current();
    Test.assert(viaSource == null || (viaSource instanceof Number && (viaSource as Number) > 0));
    Test.assert(viaLive == null || (viaLive instanceof Number && (viaLive as Number) > 0));
    Test.assert((viaSource == null) == (viaLive == null));
    // the sensor is only switched on by the fallback and off again afterwards
    LiveHeart.disable();
    Test.assert(!LiveHeart.sensorOn);
    // "-- bpm" without a reading
    Test.assert(SetScreen.heartText(null).find("--") != null);
    return true;
}

(:test)
function captureKeepsGoingWhenTheHeartRateIsMissing(logger as Logger) as Boolean {
    var h = new HealthRig(true);
    h.capture.resume();
    h.run(3);
    h.source.hr = null;
    h.run(3);
    h.source.hr = 120;
    h.run(3);
    h.capture.finish();
    Test.assert(h.capture.isDone());
    var values = h.values();
    var zeros = 0;
    for (var k = 0; k < values.size(); k++) {
        Test.assert((values[k] as Number) >= 0);
        if ((values[k] as Number) == 0) {
            zeros++;
        }
    }
    Test.assert(zeros >= 2);   // the gap is 0 (no measurement), never a made-up value
    Test.assert((values[values.size() - 1] as Number) == 120);   // the readings after the gap are kept
    return true;
}
