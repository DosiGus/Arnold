import Toybox.Communications;
import Toybox.Lang;

// Sends the frozen mobility requests of the outbox one after the other (MOB-010), the way RunSender sends runs:
//   confirmed (200 or 201)                      -> the entry goes and the routine is marked done on this watch
//   DUPLICATE_WORKOUT / DUPLICATE_OPERATION     -> Arnold has it already: counts as sent
//   no answer / 5xx / no phone                  -> stays; the same request is tried again at the next start of the
//                                                  app or after the next routine, never by a timer
//   401                                         -> the pairing path (the token is gone)
//   anything else (a refusal)                   -> stays with the server's text, dropped after 14 days
// Foreground only (the ApiClient uses timers).
class MobilitySender {
    var tries as Number;   // requests sent so far, for tests and diagnosis

    private var _client as ApiClient;
    private var _outbox as MobilityOutbox;
    private var _cache as MobilityCache;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _observer as (Method() as Void) or Null;
    private var _current as ApiRequest or Null;
    private var _currentId as String or Null;

    function initialize(client as ApiClient, outbox as MobilityOutbox, cache as MobilityCache, clock as PairingClock, authRejected as Method() as Void) {
        _client = client;
        _outbox = outbox;
        _cache = cache;
        _clock = clock;
        _authRejected = authRejected;
        _observer = null;
        _current = null;
        _currentId = null;
        tries = 0;
    }

    function outbox() as MobilityOutbox {
        return _outbox;
    }

    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    function isSending() as Boolean {
        return _current != null;
    }

    // Starts sending the next entry that is ready. One request at a time. Entries the server refused long ago go.
    function sendAll() as Void {
        if (_current != null) {
            return;
        }
        var old = _outbox.stale(_clock.nowSeconds());
        for (var i = 0; i < old.size(); i++) {
            _outbox.remove(old[i]);
        }
        var ids = _outbox.ids();
        for (var j = 0; j < ids.size(); j++) {
            var entry = _outbox.get(ids[j]) as Dictionary;
            if ((entry["s"] as Number) == MobilityOutbox.STATUS_READY) {
                send(ids[j], entry);
                return;
            }
        }
    }

    function onSendDone(uuid as String, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (_currentId == null || !(_currentId as String).equals(uuid)) {
            return;
        }
        var request = _current;
        _current = null;
        _currentId = null;
        var entry = _outbox.get(uuid);
        if (entry == null) {
            sendAll();
            return;
        }
        var e = entry as Dictionary;
        if (outcome == ApiClient.DONE_OK) {
            confirmed(uuid, e);
            return;
        }
        e["n"] = (e["n"] as Number) + 1;
        if (outcome == ApiClient.WAITING) {
            if (request != null) {
                _client.drop(request as ApiRequest);
            }
        } else if (code == 401) {
            _authRejected.invoke();
        } else {
            var errorCode = field(data, "code");
            if (code == 409 && errorCode != null && ((errorCode as String).equals("DUPLICATE_WORKOUT") || (errorCode as String).equals("DUPLICATE_OPERATION"))) {
                confirmed(uuid, e);
                return;
            }
            e["s"] = MobilityOutbox.STATUS_REJECTED;
            e["e"] = errorCode == null ? code.toString() : errorCode;
            var text = field(data, "message");
            if (text != null) {
                e["m"] = text;
            }
        }
        _outbox.update(uuid, e);
        changed();
        // After "no answer" or an expired token the next try waits for the next occasion.
        if (outcome != ApiClient.WAITING && code != 401) {
            sendAll();
        }
    }

    hidden function send(uuid as String, entry as Dictionary) as Void {
        _currentId = uuid;
        var handler = new MobilitySendHandler(self, uuid);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/mobility", entry["b"] as Dictionary, handler.method(:onDone));
        _current = request;
        tries++;
        _client.enqueue(request);
        changed();
    }

    // Arnold has the routine: the entry goes and the start screen no longer offers it.
    hidden function confirmed(uuid as String, entry as Dictionary) as Void {
        var now = _clock.nowSeconds();
        if (entry["i"] instanceof String && entry["d"] instanceof String) {
            _cache.markDone(entry["d"] as String, entry["i"] as String, now, _clock.utcOffsetMinutes());
        }
        _outbox.remove(uuid);
        changed();
        sendAll();
    }

    // A text of the error object of an answer (code or message), or null.
    hidden function field(data as Dictionary or String or Null, key as String) as String or Null {
        if (!(data instanceof Dictionary)) {
            return null;
        }
        var error = (data as Dictionary)["error"];
        if (!(error instanceof Dictionary)) {
            return null;
        }
        var value = (error as Dictionary)[key];
        return value instanceof String ? value as String : null;
    }

    hidden function changed() as Void {
        if (_observer != null) {
            (_observer as Method() as Void).invoke();
        }
    }
}

class MobilitySendHandler {
    private var _owner as MobilitySender;
    private var _uuid as String;

    function initialize(owner as MobilitySender, uuid as String) {
        _owner = owner;
        _uuid = uuid;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onSendDone(_uuid, code, data, outcome);
    }
}
