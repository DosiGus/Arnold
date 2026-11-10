import Toybox.Communications;
import Toybox.Lang;

// Pairing of the watch with an Arnold account (UMSETZUNG 5 and 7.2, 07 D-07).
//
//   UNPAIRED -start()-> PAIRING (asks for a code, then shows it) -token-> READY
//   READY -sign out / 401-> UNPAIRED
//
// The watch asks for a code, shows it, and asks every 5 s whether the code was
// confirmed in ChatGPT (slow_down makes it wait longer). The token arrives once,
// is stored only under the key "auth" and is never logged.
// Foreground only: it uses timers.
class PairingController {
    enum State {
        STATE_UNPAIRED,
        STATE_PAIRING,
        STATE_READY
    }

    // PAIRING: asking the server for a code, or showing it.
    enum Phase {
        PHASE_REQUESTING,
        PHASE_SHOWING
    }

    // Why the watch is UNPAIRED (or why a sign-out did not work).
    enum Notice {
        NOTICE_NONE,
        NOTICE_EXPIRED,         // the code ran out
        NOTICE_RECONNECT,       // 401: the token is no longer valid
        NOTICE_FAILED,          // no code could be fetched
        NOTICE_UPGRADE,         // the server wants a newer app (426)
        NOTICE_STORAGE,         // saved data belongs to a newer app
        NOTICE_SIGNOUT_FAILED   // stays READY: the server did not confirm
    }

    const POLL_SECONDS as Number = 5;
    const SLOW_DOWN_STEP_SECONDS as Number = 5;
    const TICK_MS as Number = 1000;

    var state as Number;
    var phase as Number;
    var notice as Number;
    var userCode as String or Null;      // "ABCD-2345", only while the code is shown
    var accountLabel as String;          // only while READY

    private var _client as ApiClient;
    private var _auth as AuthStore;
    private var _ticker as Scheduler;
    private var _clock as PairingClock;
    private var _deviceLabel as String;
    private var _partNumber as String;
    private var _blocked as Boolean;
    private var _observer as (Method() as Void) or Null;

    private var _generation as Number;   // answers of an older attempt are ignored
    private var _tickArmed as Boolean;
    private var _startedAt as Number;
    private var _deviceCode as String or Null;
    private var _expiresAt as Number;
    private var _interval as Number;
    private var _lastPollAt as Number;
    private var _startRequest as ApiRequest or Null;
    private var _pollRequest as ApiRequest or Null;
    private var _pollParked as Boolean;  // the client gave up for now; resend at the next tick
    private var _signOutRequest as ApiRequest or Null;

    // `blocked` is true when the saved data belongs to a newer app version: the
    // watch then neither reads the token nor pairs (fail closed).
    function initialize(
        client as ApiClient,
        auth as AuthStore,
        ticker as Scheduler,
        clock as PairingClock,
        deviceLabel as String,
        partNumber as String,
        blocked as Boolean
    ) {
        _client = client;
        _auth = auth;
        _ticker = ticker;
        _clock = clock;
        _deviceLabel = deviceLabel;
        _partNumber = partNumber;
        _blocked = blocked;
        _observer = null;
        _generation = 0;
        _tickArmed = false;
        _startedAt = 0;
        _deviceCode = null;
        _expiresAt = 0;
        _interval = POLL_SECONDS;
        _lastPollAt = 0;
        _startRequest = null;
        _pollRequest = null;
        _pollParked = false;
        _signOutRequest = null;
        state = STATE_UNPAIRED;
        phase = PHASE_REQUESTING;
        notice = NOTICE_NONE;
        userCode = null;
        accountLabel = "";
        if (blocked) {
            notice = NOTICE_STORAGE;
            return;
        }
        var credentials = auth.load();
        if (credentials != null) {
            _client.setToken((credentials as Credentials).token);
            accountLabel = (credentials as Credentials).accountLabel;
            state = STATE_READY;
        }
    }

    // The screen in front redraws when this is called. One observer at a time.
    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    function isPaired() as Boolean {
        return state == STATE_READY;
    }

    function isSigningOut() as Boolean {
        return _signOutRequest != null;
    }

    // Seconds until the shown code expires.
    function remainingSeconds() as Number {
        var left = _expiresAt - _clock.nowSeconds();
        return left > 0 ? left : 0;
    }

    // Seconds since the code was asked for (the screen hints at the phone after a while).
    function waitedSeconds() as Number {
        return _clock.nowSeconds() - _startedAt;
    }

    // Asks for a new code. Does nothing unless the watch is UNPAIRED.
    function start() as Void {
        if (state != STATE_UNPAIRED || _blocked) {
            return;
        }
        _generation++;
        state = STATE_PAIRING;
        phase = PHASE_REQUESTING;
        notice = NOTICE_NONE;
        userCode = null;
        _startedAt = _clock.nowSeconds();
        var handler = new PairStartHandler(self, _generation);
        var request = new ApiRequest(
            Communications.HTTP_REQUEST_METHOD_POST,
            "/pair/start",
            {
                "device_label" => _deviceLabel,
                "part_number" => _partNumber,
                "app_version" => AppInfo.VERSION
            },
            handler.method(:onDone)
        );
        _startRequest = request;
        _client.enqueue(request);
        armTick();
        changed();
    }

    // BACK while the code is shown or asked for.
    function cancel() as Void {
        if (state != STATE_PAIRING) {
            return;
        }
        giveUpPairing(NOTICE_NONE);
    }

    // Disconnects the watch: DELETE /device, then the local token is gone.
    function signOut() as Void {
        if (state != STATE_READY || _signOutRequest != null) {
            return;
        }
        notice = NOTICE_NONE;
        var handler = new SignOutHandler(self);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_DELETE, "/device", null, handler.method(:onDone));
        _signOutRequest = request;
        _client.enqueue(request);
        changed();
    }

    // Any part of the app that gets 401 from the server calls this: the token is
    // gone and the watch asks to connect again.
    function onAuthRejected() as Void {
        if (state != STATE_READY) {
            return;
        }
        dropSignOut();
        forgetToken();
        notice = NOTICE_RECONNECT;
        changed();
    }

    // Timer: once a second while a code is asked for or shown.
    function onTick() as Void {
        _tickArmed = false;
        if (state != STATE_PAIRING) {
            return;
        }
        if (phase == PHASE_SHOWING) {
            var now = _clock.nowSeconds();
            if (now >= _expiresAt) {
                giveUpPairing(NOTICE_EXPIRED);
                return;
            }
            if (now - _lastPollAt >= _interval) {
                poll(now);
            }
        }
        armTick();
        changed();
    }

    function onStartDone(generation as Number, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != STATE_PAIRING || phase != PHASE_REQUESTING) {
            return;
        }
        var request = _startRequest;
        _startRequest = null;
        if (outcome == ApiClient.DONE_OK && data instanceof Dictionary) {
            var answer = data as Dictionary;
            var deviceCode = answer["device_code"];
            var shown = answer["user_code"];
            var expiresIn = answer["expires_in"];
            var interval = answer["interval"];
            if (deviceCode instanceof String && shown instanceof String && expiresIn instanceof Number && (expiresIn as Number) > 0) {
                _deviceCode = deviceCode as String;
                userCode = shown as String;
                var now = _clock.nowSeconds();
                _expiresAt = now + (expiresIn as Number);
                _interval = interval instanceof Number && (interval as Number) > 0 ? interval as Number : POLL_SECONDS;
                _lastPollAt = now;
                phase = PHASE_SHOWING;
                changed();
                return;
            }
        }
        if (outcome == ApiClient.WAITING && request != null) {
            _client.drop(request as ApiRequest);
        }
        giveUpPairing(code == 426 ? NOTICE_UPGRADE : NOTICE_FAILED);
    }

    function onPollDone(generation as Number, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != STATE_PAIRING) {
            return;
        }
        if (outcome == ApiClient.WAITING) {
            // The client gave up for now (no phone or server down); the next tick sends it again.
            _pollParked = true;
            return;
        }
        _pollRequest = null;
        _pollParked = false;
        if (outcome != ApiClient.DONE_OK || !(data instanceof Dictionary)) {
            giveUpPairing(code == 426 ? NOTICE_UPGRADE : NOTICE_FAILED);
            return;
        }
        var answer = data as Dictionary;
        if (answer["access_token"] instanceof String) {
            complete(answer);
            return;
        }
        var status = answer["status"];
        if (status instanceof String && (status as String).equals("pending")) {
            return;
        }
        if (status instanceof String && (status as String).equals("slow_down")) {
            var suggested = answer["interval"];
            var slower = _interval + SLOW_DOWN_STEP_SECONDS;
            _interval = suggested instanceof Number && (suggested as Number) > slower ? suggested as Number : slower;
            return;
        }
        if (status instanceof String && (status as String).equals("expired")) {
            giveUpPairing(NOTICE_EXPIRED);
            return;
        }
        giveUpPairing(NOTICE_FAILED);
    }

    function onSignOutDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        var request = _signOutRequest;
        if (request == null) {
            return;
        }
        // 401 means the server no longer knows this token: the watch is disconnected either way.
        if (outcome == ApiClient.DONE_OK || code == 401) {
            _signOutRequest = null;
            forgetToken();
            notice = NOTICE_NONE;
            changed();
            return;
        }
        if (outcome == ApiClient.WAITING) {
            _client.drop(request as ApiRequest);
        }
        _signOutRequest = null;
        notice = NOTICE_SIGNOUT_FAILED;
        changed();
    }

    hidden function poll(now as Number) as Void {
        _lastPollAt = now;
        if (_pollParked) {
            _pollParked = false;
            _client.kick();
            return;
        }
        if (_pollRequest != null) {
            return;  // the answer to the last poll is still on its way
        }
        var handler = new PairPollHandler(self, _generation);
        var request = new ApiRequest(
            Communications.HTTP_REQUEST_METHOD_POST,
            "/pair/token",
            { "device_code" => _deviceCode },
            handler.method(:onDone)
        );
        _pollRequest = request;
        _client.enqueue(request);
    }

    // The server confirmed the code: keep the token, drop everything else of the pairing.
    hidden function complete(answer as Dictionary) as Void {
        var token = answer["access_token"] as String;
        var deviceId = answer["device_id"];
        var label = answer["account_label"];
        if (!AuthStore.isWatchToken(token) || !(deviceId instanceof String)) {
            giveUpPairing(NOTICE_FAILED);
            return;
        }
        var credentials = new Credentials(token, deviceId as String, label instanceof String ? label as String : "");
        _auth.save(credentials);
        _client.setToken(token);
        accountLabel = credentials.accountLabel;
        endPairing();
        state = STATE_READY;
        notice = NOTICE_NONE;
        changed();
    }

    hidden function giveUpPairing(reason as Number) as Void {
        if (_startRequest != null) {
            _client.drop(_startRequest as ApiRequest);
        }
        if (_pollRequest != null) {
            _client.drop(_pollRequest as ApiRequest);
        }
        endPairing();
        state = STATE_UNPAIRED;
        notice = reason;
        changed();
    }

    // Forgets the code and the attempt; late answers of this attempt are ignored.
    hidden function endPairing() as Void {
        _generation++;
        _startRequest = null;
        _pollRequest = null;
        _pollParked = false;
        _deviceCode = null;
        userCode = null;
        phase = PHASE_REQUESTING;
        _ticker.cancel();
        _tickArmed = false;
    }

    hidden function forgetToken() as Void {
        _auth.clear();
        _client.setToken(null);
        accountLabel = "";
        state = STATE_UNPAIRED;
    }

    hidden function dropSignOut() as Void {
        if (_signOutRequest != null) {
            _client.drop(_signOutRequest as ApiRequest);
            _signOutRequest = null;
        }
    }

    hidden function armTick() as Void {
        if (!_tickArmed) {
            _tickArmed = true;
            _ticker.schedule(TICK_MS, method(:onTick));
        }
    }

    hidden function changed() as Void {
        if (_observer != null) {
            (_observer as Method() as Void).invoke();
        }
    }
}

// Ties the answer of pair/start to the attempt that asked.
class PairStartHandler {
    private var _owner as PairingController;
    private var _generation as Number;

    function initialize(owner as PairingController, generation as Number) {
        _owner = owner;
        _generation = generation;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onStartDone(_generation, code, data, outcome);
    }
}

// Ties the answer of pair/token to the attempt that asked.
class PairPollHandler {
    private var _owner as PairingController;
    private var _generation as Number;

    function initialize(owner as PairingController, generation as Number) {
        _owner = owner;
        _generation = generation;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onPollDone(_generation, code, data, outcome);
    }
}

class SignOutHandler {
    private var _owner as PairingController;

    function initialize(owner as PairingController) {
        _owner = owner;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onSignOutDone(code, data, outcome);
    }
}
