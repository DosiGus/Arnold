import Toybox.Application;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// Manual clock for the pairing countdown.
(:test)
class FakeClock extends PairingClock {
    var now as Number;

    function initialize() {
        PairingClock.initialize();
        now = 1000000;
    }

    function nowSeconds() as Number {
        return now;
    }
}

// Controller, fake network, fake timers and in-memory storage in one place.
(:test)
class PairingRig {
    const TOKEN as String = "arn_w_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    var store as MemoryStore;
    var transport as FakeTransport;
    var clientTimer as FakeScheduler;   // timeouts and pauses of the API client
    var ticker as FakeScheduler;        // the one-second tick of the controller
    var clock as FakeClock;
    var auth as AuthStore;
    var client as ApiClient;
    var controller as PairingController;
    var changes as Number;

    function initialize(blocked as Boolean) {
        store = new MemoryStore();
        transport = new FakeTransport();
        clientTimer = new FakeScheduler();
        ticker = new FakeScheduler();
        clock = new FakeClock();
        auth = new AuthStore(store);
        client = new ApiClient("http://mock/api/watch/v1", transport, clientTimer);
        client.setClientInfo("006-B3992-00", "de");
        controller = new PairingController(client, auth, ticker, clock, "Forerunner 255", "006-B3992-00", blocked);
        changes = 0;
        controller.setObserver(method(:onChanged));
    }

    function onChanged() as Void {
        changes++;
    }

    // The watch has already been paired earlier (token in storage), then the app restarts.
    function restartPaired() as Void {
        auth.save(new Credentials(TOKEN, "dev_1", "Arnold · ab12"));
        controller = new PairingController(client, auth, ticker, clock, "Forerunner 255", "006-B3992-00", false);
        controller.setObserver(method(:onChanged));
    }

    function codeAnswer() as Dictionary {
        return {
            "api_version" => 1, "min_app_version" => "1.0.0",
            "device_code" => "device-code-secret", "user_code" => "ABCD-2345",
            "expires_in" => 600, "interval" => 5
        };
    }

    function tokenAnswer() as Dictionary {
        return {
            "api_version" => 1, "min_app_version" => "1.0.0",
            "access_token" => TOKEN, "device_id" => "dev_1", "account_label" => "Arnold · ab12"
        };
    }

    // start(), then the server hands out a code: the code is on screen.
    function showCode() as Void {
        controller.start();
        transport.respond(200, codeAnswer());
    }

    // Time passes; the controller's tick fires once.
    function tick(seconds as Number) as Void {
        clock.now += seconds;
        ticker.fire();
    }

    function lastBody() as Dictionary {
        return transport.requests[transport.requests.size() - 1].body as Dictionary;
    }

    function lastUrl() as String {
        return transport.urls[transport.urls.size() - 1];
    }
}

(:test)
function pairingStartsUnpairedWithoutToken(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_NONE);
    Test.assert(!rig.controller.isPaired());
    return true;
}

(:test)
function pairingRestoresReadyFromStoredToken(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.restartPaired();
    Expect.equal(rig.controller.state, PairingController.STATE_READY);
    Expect.equal(rig.controller.accountLabel, "Arnold · ab12");
    // the token is used for the next request
    rig.client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, new CallRecorder().method(:onDone)));
    Expect.equal(rig.transport.headers[0]["Authorization"] as String, "Bearer " + rig.TOKEN);
    return true;
}

(:test)
function pairingIgnoresUnreadableStoredToken(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.store.setValue(StoreKeys.AUTH, { "token" => "not-a-watch-token", "device_id" => "dev_1" });
    Test.assert(rig.auth.load() == null);
    rig.store.setValue(StoreKeys.AUTH, { "token" => rig.TOKEN });
    Test.assert(rig.auth.load() == null);
    rig.store.setValue(StoreKeys.AUTH, "text");
    Test.assert(rig.auth.load() == null);
    rig.store.deleteValue(StoreKeys.AUTH);
    Test.assert(rig.auth.load() == null);
    return true;
}

(:test)
function pairingStartAsksForCodeAndShowsIt(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.controller.start();
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    Expect.equal(rig.controller.phase, PairingController.PHASE_REQUESTING);
    Expect.equal(rig.transport.sentCount(), 1);
    Expect.equal(rig.lastUrl(), "http://mock/api/watch/v1/pair/start");
    var body = rig.lastBody();
    Expect.equal(body["device_label"] as String, "Forerunner 255");
    Expect.equal(body["part_number"] as String, "006-B3992-00");
    Expect.equal(body["app_version"] as String, AppInfo.VERSION);
    Test.assert(!rig.transport.headers[0].hasKey("Authorization"));
    rig.transport.respond(200, rig.codeAnswer());
    Expect.equal(rig.controller.phase, PairingController.PHASE_SHOWING);
    Expect.equal(rig.controller.userCode, "ABCD-2345");
    Expect.equal(rig.controller.remainingSeconds(), 600);
    rig.clock.now += 61;
    Expect.equal(rig.controller.remainingSeconds(), 539);
    return true;
}

(:test)
function pairingPollsEveryFiveSeconds(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(1);
    rig.tick(1);
    rig.tick(1);
    Expect.equal(rig.transport.sentCount(), 1);   // nothing yet after 3 s
    rig.tick(2);
    Expect.equal(rig.transport.sentCount(), 2);
    Expect.equal(rig.lastUrl(), "http://mock/api/watch/v1/pair/token");
    Expect.equal(rig.lastBody()["device_code"] as String, "device-code-secret");
    rig.transport.respond(200, { "status" => "pending" });
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    rig.tick(4);
    Expect.equal(rig.transport.sentCount(), 2);
    rig.tick(1);
    Expect.equal(rig.transport.sentCount(), 3);
    return true;
}

(:test)
function pairingDoesNotPollWhileAnswerIsOutstanding(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);
    Expect.equal(rig.transport.sentCount(), 2);
    rig.tick(5);
    rig.tick(5);
    Expect.equal(rig.transport.sentCount(), 2);   // still waiting for the first poll's answer
    return true;
}

(:test)
function pairingSlowDownWaitsLonger(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);
    rig.transport.respond(200, { "status" => "slow_down" });
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    rig.tick(5);
    Expect.equal(rig.transport.sentCount(), 2);   // 5 s are no longer enough
    rig.tick(5);
    Expect.equal(rig.transport.sentCount(), 3);   // 10 s
    rig.transport.respond(200, { "status" => "slow_down", "interval" => 30 });
    rig.tick(10);
    rig.tick(10);
    Expect.equal(rig.transport.sentCount(), 3);
    rig.tick(10);
    Expect.equal(rig.transport.sentCount(), 4);   // the server's 30 s win
    return true;
}

(:test)
function pairingTokenCompletesPairing(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);
    rig.transport.respond(200, rig.tokenAnswer());
    Expect.equal(rig.controller.state, PairingController.STATE_READY);
    Expect.equal(rig.controller.accountLabel, "Arnold · ab12");
    Test.assert(rig.controller.userCode == null);
    Test.assert(rig.ticker.pendingCallback == null);   // no more ticks
    var stored = rig.auth.load() as Credentials;
    Expect.equal(stored.token, rig.TOKEN);
    Expect.equal(stored.deviceId, "dev_1");
    Expect.equal(stored.accountLabel, "Arnold · ab12");
    // the token is kept only under "auth"; the device code is not stored anywhere
    var keys = rig.store.values.keys();
    Expect.equal(keys.size(), 1);
    Expect.equal(keys[0], StoreKeys.AUTH);
    // and used from now on
    rig.client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, new CallRecorder().method(:onDone)));
    Expect.equal(rig.transport.headers[2]["Authorization"] as String, "Bearer " + rig.TOKEN);
    return true;
}

(:test)
function pairingRejectsAnswerWithoutWatchToken(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);
    rig.transport.respond(200, { "access_token" => "eyJ-not-a-watch-token", "device_id" => "dev_1", "account_label" => "x" });
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_FAILED);
    Test.assert(rig.auth.load() == null);
    Expect.equal(rig.store.values.size(), 0);
    return true;
}

(:test)
function pairingServerSaysExpired(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);
    rig.transport.respond(200, { "status" => "expired" });
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_EXPIRED);
    Test.assert(rig.ticker.pendingCallback == null);
    // a new code can be asked for
    rig.controller.start();
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_NONE);
    return true;
}

(:test)
function pairingCodeExpiresByTheClock(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(599);
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    rig.tick(1);
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_EXPIRED);
    Test.assert(rig.controller.userCode == null);
    return true;
}

(:test)
function pairingStartFailureShowsNotice(logger as Logger) as Boolean {
    var upgrade = new PairingRig(false);
    upgrade.controller.start();
    upgrade.transport.respond(426, { "error" => { "code" => "UPGRADE_REQUIRED", "retryable" => false } });
    Expect.equal(upgrade.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(upgrade.controller.notice, PairingController.NOTICE_UPGRADE);

    var refused = new PairingRig(false);
    refused.controller.start();
    refused.transport.respond(400, { "error" => { "code" => "VALIDATION_ERROR", "retryable" => false } });
    Expect.equal(refused.controller.notice, PairingController.NOTICE_FAILED);

    var broken = new PairingRig(false);
    broken.controller.start();
    broken.transport.respond(200, { "user_code" => "ABCD-2345" });   // no device_code
    Expect.equal(broken.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(broken.controller.notice, PairingController.NOTICE_FAILED);
    return true;
}

(:test)
function pairingStartGivesUpAfterRetriesAndForgetsTheRequest(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.controller.start();
    for (var i = 0; i < 3; i++) {
        rig.transport.respond(503, null);
        rig.clientTimer.fire();     // pause over, sent again
    }
    rig.transport.respond(503, null);
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_FAILED);
    Expect.equal(rig.client.pendingCount(), 0);   // nothing waits in the queue to be sent later
    return true;
}

(:test)
function pairingResendsParkedPollAtNextTick(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);
    for (var i = 0; i < 3; i++) {
        rig.transport.respond(503, null);
        rig.clientTimer.fire();
    }
    rig.transport.respond(503, null);      // the client gives up for now
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    var before = rig.transport.sentCount();
    rig.tick(1);
    Expect.equal(rig.transport.sentCount(), before);
    rig.tick(4);
    Expect.equal(rig.transport.sentCount(), before + 1);   // same request again, not a second one
    Expect.equal(rig.client.pendingCount(), 1);
    rig.transport.respond(200, rig.tokenAnswer());
    Expect.equal(rig.controller.state, PairingController.STATE_READY);
    return true;
}

(:test)
function pairingCancelIgnoresALateToken(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.showCode();
    rig.tick(5);                           // poll is on its way
    rig.controller.cancel();
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_NONE);
    Test.assert(rig.ticker.pendingCallback == null);
    rig.transport.respond(200, rig.tokenAnswer());   // confirmed in ChatGPT just now: too late
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Test.assert(rig.auth.load() == null);
    Expect.equal(rig.client.pendingCount(), 0);
    return true;
}

(:test)
function pairingAnswerOfOldAttemptDoesNotTouchNewOne(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.controller.start();
    rig.controller.cancel();
    rig.controller.start();                // second attempt; the first request is still on its way
    rig.transport.respond(200, rig.codeAnswer());   // answers the first one
    Expect.equal(rig.controller.phase, PairingController.PHASE_REQUESTING);
    Test.assert(rig.controller.userCode == null);
    rig.transport.respond(200, rig.codeAnswer());   // answers the second
    Expect.equal(rig.controller.phase, PairingController.PHASE_SHOWING);
    return true;
}

(:test)
function pairingAuthRejectedAsksToConnectAgain(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.restartPaired();
    rig.controller.onAuthRejected();
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_RECONNECT);
    Test.assert(rig.auth.load() == null);
    Expect.equal(rig.controller.accountLabel, "");
    rig.client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, new CallRecorder().method(:onDone)));
    Test.assert(!rig.transport.headers[0].hasKey("Authorization"));
    // connecting again works and clears the hint
    rig.controller.start();
    Expect.equal(rig.controller.state, PairingController.STATE_PAIRING);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_NONE);
    return true;
}

(:test)
function pairingAuthRejectedIsIgnoredWhenNotConnected(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.controller.onAuthRejected();
    Expect.equal(rig.controller.notice, PairingController.NOTICE_NONE);
    return true;
}

(:test)
function pairingSignOutSendsDeleteAndForgetsToken(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.restartPaired();
    rig.controller.signOut();
    Test.assert(rig.controller.isSigningOut());
    Expect.equal(rig.lastUrl(), "http://mock/api/watch/v1/device");
    Test.assert(rig.transport.requests[0].method == Communications.HTTP_REQUEST_METHOD_DELETE);
    Expect.equal(rig.transport.headers[0]["Authorization"] as String, "Bearer " + rig.TOKEN);
    rig.controller.signOut();              // a second tap does not send a second request
    Expect.equal(rig.transport.sentCount(), 1);
    rig.transport.respond(200, { "unpaired" => true });
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_NONE);
    Test.assert(!rig.controller.isSigningOut());
    Test.assert(rig.auth.load() == null);
    return true;
}

(:test)
function pairingSignOutAnswer401StillDisconnects(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.restartPaired();
    rig.controller.signOut();
    rig.transport.respond(401, { "error" => { "code" => "AUTH_REQUIRED", "retryable" => false } });
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Test.assert(rig.auth.load() == null);
    return true;
}

(:test)
function pairingSignOutFailureKeepsTheConnection(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.restartPaired();
    rig.controller.signOut();
    rig.transport.respond(400, { "error" => { "code" => "VALIDATION_ERROR", "retryable" => false } });
    Expect.equal(rig.controller.state, PairingController.STATE_READY);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_SIGNOUT_FAILED);
    Test.assert(rig.auth.load() != null);

    // the server cannot be reached: the request is not left to be sent later
    var offline = new PairingRig(false);
    offline.restartPaired();
    offline.controller.signOut();
    for (var i = 0; i < 3; i++) {
        offline.transport.respond(503, null);
        offline.clientTimer.fire();
    }
    offline.transport.respond(503, null);
    Expect.equal(offline.controller.state, PairingController.STATE_READY);
    Expect.equal(offline.controller.notice, PairingController.NOTICE_SIGNOUT_FAILED);
    Expect.equal(offline.client.pendingCount(), 0);
    Test.assert(!offline.controller.isSigningOut());
    return true;
}

(:test)
function pairingBlockedStorageNeitherReadsTokenNorPairs(logger as Logger) as Boolean {
    var rig = new PairingRig(true);
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    Expect.equal(rig.controller.notice, PairingController.NOTICE_STORAGE);
    rig.controller.start();
    Expect.equal(rig.transport.sentCount(), 0);
    Expect.equal(rig.controller.state, PairingController.STATE_UNPAIRED);
    return true;
}

(:test)
function pairingTellsTheObserver(logger as Logger) as Boolean {
    var rig = new PairingRig(false);
    rig.controller.start();
    Test.assert(rig.changes >= 1);
    var before = rig.changes;
    rig.transport.respond(200, rig.codeAnswer());
    Test.assert(rig.changes > before);
    before = rig.changes;
    rig.tick(1);
    Test.assert(rig.changes > before);     // the countdown redraws every second
    rig.controller.setObserver(null);
    rig.tick(1);
    Expect.equal(rig.changes, before + 1);
    return true;
}

(:test)
function deviceNamesCoverTargetsAndFallBack(logger as Logger) as Boolean {
    Expect.equal(DeviceNames.label("006-B3992-00"), "Forerunner 255");
    Expect.equal(DeviceNames.label("006-B4315-00"), "Forerunner 965");
    Expect.equal(DeviceNames.label("006-B4341-00"), "fenix 7X");
    Expect.equal(DeviceNames.label("006-B9999-00"), "Garmin 006-B9999-00");
    Expect.equal(DeviceNames.label(""), "Garmin");
    return true;
}

(:test)
function authTokenShapeIsChecked(logger as Logger) as Boolean {
    Test.assert(AuthStore.isWatchToken("arn_w_abc"));
    Test.assert(!AuthStore.isWatchToken("arn_w_"));
    Test.assert(!AuthStore.isWatchToken("Bearer arn_w_abc"));
    Test.assert(!AuthStore.isWatchToken(""));
    return true;
}

(:garminProduct, :test)
function productBuildUsesTheProductionAddress(logger as Logger) as Boolean {
    var url = AuthConfig.baseUrl();
    Test.assert(url.find("https://") == 0);
    Test.assert(url.find("/api/watch/v1") != null);
    Test.assert(url.find("trycloudflare") == null);
    Test.assert(url.find("127.0.0.1") == null);
    Test.assert(url.find("localhost") == null);
    return true;
}

(:test)
function pairingTimeIsShownAsMinutesAndSeconds(logger as Logger) as Boolean {
    Expect.equal(PairingScreen.minutesAndSeconds(581), "9:41");
    Expect.equal(PairingScreen.minutesAndSeconds(600), "10:00");
    Expect.equal(PairingScreen.minutesAndSeconds(5), "0:05");
    Expect.equal(PairingScreen.minutesAndSeconds(0), "0:00");
    return true;
}

(:test)
function pairingLayoutWrapsToTheTextWidth(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var width = PairingLayout.textWidth(dc);
    var lines = PairingLayout.wrap(dc, "Garmin Connect am Handy öffnen und danach noch einmal versuchen", Graphics.FONT_XTINY, width);
    Test.assert(lines.size() >= 2);
    for (var i = 0; i < lines.size(); i++) {
        Test.assertMessage(dc.getTextWidthInPixels(lines[i], Graphics.FONT_XTINY) <= width, "too wide: " + lines[i]);
    }
    Expect.equal(PairingLayout.wrap(dc, "", Graphics.FONT_XTINY, width).size(), 0);
    var fonts = [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY] as Array<Graphics.FontType>;
    var chosen = PairingLayout.fitFont(dc, "ABCD-2345", width, fonts);
    Test.assert(dc.getTextWidthInPixels("ABCD-2345", chosen) <= width);
    return true;
}

// Draws every pairing screen into a bitmap of the device's display size.
(:test)
function pairingViewDrawsEveryState(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var drawn = 0;

    var unpaired = new PairingRig(false);
    drawn += PairingScreens.draw(dc, unpaired.controller);

    var expired = new PairingRig(false);
    expired.showCode();
    expired.tick(600);
    drawn += PairingScreens.draw(dc, expired.controller);

    var failed = new PairingRig(false);
    failed.controller.start();
    failed.transport.respond(400, null);
    drawn += PairingScreens.draw(dc, failed.controller);

    var upgrade = new PairingRig(false);
    upgrade.controller.start();
    upgrade.transport.respond(426, null);
    drawn += PairingScreens.draw(dc, upgrade.controller);

    var blocked = new PairingRig(true);
    drawn += PairingScreens.draw(dc, blocked.controller);

    var requesting = new PairingRig(false);
    requesting.controller.start();
    drawn += PairingScreens.draw(dc, requesting.controller);
    requesting.clock.now += 13;
    drawn += PairingScreens.draw(dc, requesting.controller);

    var showing = new PairingRig(false);
    showing.showCode();
    showing.clock.now += 19;
    drawn += PairingScreens.draw(dc, showing.controller);

    var ready = new PairingRig(false);
    ready.restartPaired();
    drawn += PairingScreens.draw(dc, ready.controller);
    ready.controller.signOut();
    drawn += PairingScreens.draw(dc, ready.controller);

    var reconnect = new PairingRig(false);
    reconnect.restartPaired();
    reconnect.controller.onAuthRejected();
    drawn += PairingScreens.draw(dc, reconnect.controller);

    var signOutFailed = new PairingRig(false);
    signOutFailed.restartPaired();
    signOutFailed.controller.signOut();
    signOutFailed.transport.respond(400, null);
    drawn += PairingScreens.draw(dc, signOutFailed.controller);

    Expect.equal(drawn, 12);
    return true;
}

(:test)
function pairingScreenShowsCodeAndTimeLeft(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = new PairingRig(false);
    rig.showCode();
    rig.clock.now += 19;
    var lines = PairingScreen.lines(dc, rig.controller);
    var texts = "";
    for (var i = 0; i < lines.size(); i++) {
        texts += lines[i].text + "|";
    }
    Test.assertMessage(texts.find("ABCD-2345") != null, texts);
    Test.assertMessage(texts.find("9:41") != null, texts);
    return true;
}

(:test)
function pairingScreenNamesTheConnectedAccount(logger as Logger) as Boolean {
    var dc = PairingScreens.deviceDc();
    var rig = new PairingRig(false);
    rig.restartPaired();
    var lines = PairingScreen.lines(dc, rig.controller);
    var texts = "";
    for (var i = 0; i < lines.size(); i++) {
        texts += lines[i].text + "|";
    }
    Test.assertMessage(texts.find("Arnold · ab12") != null, texts);
    return true;
}

// Helpers of the screen tests (a module, so the test runner does not take them for tests).
(:test)
module PairingScreens {
    function deviceDc() as Dc {
        var settings = System.getDeviceSettings();
        var bitmap = Graphics.createBufferedBitmap({
            :width => settings.screenWidth,
            :height => settings.screenHeight
        }).get() as BufferedBitmap;
        return bitmap.getDc();
    }

    function draw(dc as Dc, controller as PairingController) as Number {
        PairingLayout.draw(dc, PairingScreen.lines(dc, controller));
        return 1;
    }
}
