import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;

// Whether the account allows health values from the watch (GET /device, health_consent).
// The answer is kept; an unknown answer counts as "no" (fail closed): without a known
// consent nothing is collected and nothing is sent.
class HealthConsent {
    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    function isOn() as Boolean {
        var raw = _store.getValue(StoreKeys.HEALTH_CONSENT);
        if (!(raw instanceof Dictionary)) {
            return false;
        }
        var on = (raw as Dictionary)["v"];
        if (on instanceof Boolean) {
            return on as Boolean;
        }
        return false;
    }

    function set(on as Boolean, now as Number) as Void {
        var entry = { "v" => on, "t" => now };
        _store.setValue(StoreKeys.HEALTH_CONSENT, entry as Application.Storage.ValueType);
    }

    function clear() as Void {
        _store.deleteValue(StoreKeys.HEALTH_CONSENT);
    }
}

// Sends the health values of confirmed workouts (PUT /workouts/{session_uuid}/health,
// GAR-B4-02). The workout comes first and is never held up:
//   - an entry is sent only when its workout is no longer in the workout outbox, that is,
//     the server confirmed it (before that the server would answer WORKOUT_PENDING);
//   - without consent (asked first with GET /device) nothing is sent and the entries are deleted;
//   - a waiting health request is dropped as soon as the workout sender starts a request;
//   - WORKOUT_PENDING or no connection: the entry stays and is tried at the next occasion;
//   - a refusal that cannot succeed (invalid values) deletes the entry, so it never blocks.
// Missing values are not in the request, never 0. Foreground only (like the ApiClient).
class HealthSender {
    private var _client as ApiClient;
    private var _health as HealthOutbox;
    private var _workouts as Outbox;
    private var _consent as HealthConsent;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _current as ApiRequest or Null;
    private var _tried as Array<String>;

    function initialize(
        client as ApiClient, health as HealthOutbox, workouts as Outbox,
        consent as HealthConsent, clock as PairingClock, authRejected as Method() as Void
    ) {
        _client = client;
        _health = health;
        _workouts = workouts;
        _consent = consent;
        _clock = clock;
        _authRejected = authRejected;
        _current = null;
        _tried = [] as Array<String>;
    }

    function consent() as HealthConsent {
        return _consent;
    }

    function outbox() as HealthOutbox {
        return _health;
    }

    function pendingCount() as Number {
        return _health.count();
    }

    function isSending() as Boolean {
        return _current != null;
    }

    // A new capture for a workout (the launcher puts it on the recorder).
    function newCapture(workoutUuid as String) as HealthCapture {
        return new HealthCapture(workoutUuid, new WatchHealthSource(), _health.store(), _consent, _health, _clock);
    }

    // An occasion (app start, workout start, a confirmed workout): ask for the consent,
    // then send what is waiting. One request at a time, the consent question first.
    function sendAll() as Void {
        if (_current != null) {
            return;
        }
        try {
            _health.prune(_clock.nowSeconds());
            _tried = [] as Array<String>;
            var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/device", null, new HealthHandler(self, "").method(:onConsent));
            _current = request;
            _client.enqueue(request);
        } catch (e) {
            _current = null;
        }
    }

    // The workout sender is about to send: a waiting health request steps aside.
    function cancel() as Void {
        var request = _current;
        _current = null;
        if (request != null) {
            _client.drop(request as ApiRequest);
        }
    }

    // The workout was thrown away (duplicate declined, discarded): its values go too.
    function forget(workoutUuid as String) as Void {
        try {
            _health.remove(workoutUuid);
        } catch (e) {
        }
    }

    // Answer of GET /device.
    function onConsentDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        var finished = _current;
        _current = null;
        try {
            if (outcome == ApiClient.DONE_OK && data instanceof Dictionary && (data as Dictionary)["health_consent"] instanceof Boolean) {
                _consent.set((data as Dictionary)["health_consent"] as Boolean, _clock.nowSeconds());
            } else {
                if (outcome == ApiClient.WAITING) {
                    if (finished != null) {
                        _client.drop(finished as ApiRequest);
                    }
                    return;   // no connection: the state stays as it was, tried at the next occasion
                }
                if (code == 401) {
                    _authRejected.invoke();
                }
                return;
            }
            if (!_consent.isOn()) {
                _health.clear();   // consent withdrawn or never given: nothing waits for a send
                return;
            }
            next();
        } catch (e) {
            _current = null;
        }
    }

    // Answer of PUT /health for one workout.
    function onSendDone(uuid as String, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        var finished = _current;
        _current = null;
        try {
            if (outcome == ApiClient.DONE_OK) {
                _health.remove(uuid);
                next();
                return;
            }
            _health.countTry(uuid);
            var errorCode = errorCodeOf(data);
            if (outcome == ApiClient.WAITING) {
                if (finished != null) {
                    _client.drop(finished as ApiRequest);
                }
                if (code == 409 && errorCode != null && (errorCode as String).equals("WORKOUT_PENDING")) {
                    next();   // the server does not have the workout yet: later; others may go on
                }
                return;       // no connection or server trouble: at the next occasion
            }
            if (code == 401) {
                _authRejected.invoke();
                return;
            }
            if (code == 403 && errorCode != null && (errorCode as String).equals("CONSENT_REQUIRED")) {
                _consent.set(false, _clock.nowSeconds());
                _health.clear();
                return;
            }
            // Refused for good (invalid values and the like): dropped, so it cannot block later ones.
            _health.remove(uuid);
            next();
        } catch (e) {
            _current = null;
        }
    }

    // The next entry whose workout the server has.
    hidden function next() as Void {
        var ids = _health.ids();
        for (var i = 0; i < ids.size(); i++) {
            var id = ids[i];
            if (_tried.indexOf(id) >= 0 || _workouts.contains(id)) {
                continue;
            }
            var entry = _health.get(id);
            if (entry == null) {
                continue;
            }
            _tried.add(id);
            var request = new ApiRequest(
                Communications.HTTP_REQUEST_METHOD_PUT, "/workouts/" + id + "/health",
                (entry as Dictionary)["b"] as Dictionary, new HealthHandler(self, id).method(:onSend)
            );
            _current = request;
            _client.enqueue(request);
            return;
        }
    }

    hidden function errorCodeOf(data as Dictionary or String or Null) as String or Null {
        if (!(data instanceof Dictionary)) {
            return null;
        }
        var error = (data as Dictionary)["error"];
        if (!(error instanceof Dictionary)) {
            return null;
        }
        var code = (error as Dictionary)["code"];
        return code instanceof String ? code as String : null;
    }
}

class HealthHandler {
    private var _owner as HealthSender;
    private var _uuid as String;

    function initialize(owner as HealthSender, uuid as String) {
        _owner = owner;
        _uuid = uuid;
    }

    function onConsent(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onConsentDone(code, data, outcome);
    }

    function onSend(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onSendDone(_uuid, code, data, outcome);
    }
}
