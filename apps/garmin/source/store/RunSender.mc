import Toybox.Communications;
import Toybox.Lang;

// Sends the frozen run requests of the run outbox one after the other (RUN-018), the way OutboxSender sends workouts:
//   confirmed (200 or 201)                      -> entry and journal are removed; the marker run:active goes with the journal
//   DUPLICATE_WORKOUT / DUPLICATE_OPERATION     -> the run is at Arnold already: counts as sent ("already sent")
//   no answer / 5xx / no phone                  -> stays, the same request is tried again later (same request_id)
//   anything else (a refusal)                   -> stays with the server's text, dropped after 14 days
// The effort travels in the request of the run. The route that sets it later (PATCH) cannot be called from a Connect IQ
// watch (the SDK knows GET, POST, PUT and DELETE only), so the effort is asked for before the request is built.
// Foreground only (the ApiClient uses timers).
class RunSender {
    enum Phase {
        PHASE_NONE,        // nothing known about this run
        PHASE_QUEUED,      // saved, waiting for the phone or the network
        PHASE_SENDING,
        PHASE_SENT,
        PHASE_REJECTED     // the server refused it
    }

    var tries as Number;   // requests sent so far (all runs), for tests and diagnosis

    private var _client as ApiClient;
    private var _outbox as RunOutbox;
    private var _journal as RunJournal;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _observer as (Method() as Void) or Null;
    private var _health as HealthSender or Null;
    private var _current as ApiRequest or Null;
    private var _currentId as String or Null;
    private var _sent as Array<String>;
    private var _already as Array<String>;

    function initialize(client as ApiClient, outbox as RunOutbox, journal as RunJournal, clock as PairingClock, authRejected as Method() as Void) {
        _client = client;
        _outbox = outbox;
        _journal = journal;
        _clock = clock;
        _authRejected = authRejected;
        _observer = null;
        _health = null;
        _current = null;
        _currentId = null;
        _sent = [] as Array<String>;
        _already = [] as Array<String>;
        tries = 0;
    }

    function setHealth(health as HealthSender or Null) as Void {
        _health = health;
    }

    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    function outbox() as RunOutbox {
        return _outbox;
    }

    function pendingCount() as Number {
        return _outbox.count();
    }

    function isSending() as Boolean {
        return _current != null;
    }

    // True while the request waits for the phone (no Bluetooth link to the phone).
    function isPhoneMissing() as Boolean {
        return _current != null && _client.lastCode == RetryPolicy.BLE_CONNECTION_UNAVAILABLE;
    }

    // Where a run stands, for its screen.
    function phaseOf(uuid as String) as Number {
        var entry = _outbox.get(uuid);
        if (entry == null) {
            return _sent.indexOf(uuid) >= 0 ? PHASE_SENT : PHASE_NONE;
        }
        if (((entry as Dictionary)["s"] as Number) == RunOutbox.STATUS_REJECTED) {
            return PHASE_REJECTED;
        }
        return _currentId != null && (_currentId as String).equals(uuid) ? PHASE_SENDING : PHASE_QUEUED;
    }

    // True when the server told us it had the run already.
    function wasAlreadySent(uuid as String) as Boolean {
        return _already.indexOf(uuid) >= 0;
    }

    function errorTextOf(uuid as String) as String or Null {
        var entry = _outbox.get(uuid);
        if (entry == null || !((entry as Dictionary)["m"] instanceof String)) {
            return null;
        }
        return (entry as Dictionary)["m"] as String;
    }

    // Puts a finished run's request into the outbox (once) and starts sending.
    function enqueue(uuid as String, request as Dictionary) as Void {
        _outbox.add(uuid, request, _clock.nowSeconds());
        changed();
        sendAll();
    }

    // Starts sending the next entry that is ready. One request at a time. Entries the server refused long ago go.
    function sendAll() as Void {
        if (_current != null) {
            return;
        }
        var old = _outbox.stale(_clock.nowSeconds());
        for (var i = 0; i < old.size(); i++) {
            discard(old[i]);
        }
        var ids = _outbox.ids();
        for (var i = 0; i < ids.size(); i++) {
            var entry = _outbox.get(ids[i]) as Dictionary;
            if ((entry["s"] as Number) == RunOutbox.STATUS_READY) {
                send(ids[i], entry);
                return;
            }
        }
    }

    // A refused run is thrown away (after 14 days): the outbox entry and what the journal still holds of it.
    function discard(uuid as String) as Void {
        _outbox.remove(uuid);
        _journal.discard(uuid);
        changed();
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
            changed();
            sendAll();
            return;
        }
        var e = entry as Dictionary;
        if (outcome == ApiClient.DONE_OK) {
            confirmed(uuid);
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
            var errorCode = errorCodeOf(data);
            if (code == 409 && errorCode != null
                && ((errorCode as String).equals("DUPLICATE_WORKOUT") || (errorCode as String).equals("DUPLICATE_OPERATION"))) {
                _already.add(uuid);
                confirmed(uuid);
                return;
            }
            e["s"] = RunOutbox.STATUS_REJECTED;
            e["e"] = errorCode == null ? code.toString() : errorCode;
            var text = errorTextOf2(data);
            if (text != null) {
                e["m"] = text;
            }
        }
        _outbox.update(uuid, e);
        changed();
        // After "no answer" or an expired token the next try waits for the next occasion (app start, a new run).
        if (outcome != ApiClient.WAITING && code != 401) {
            sendAll();
        }
    }

    hidden function send(uuid as String, entry as Dictionary) as Void {
        _currentId = uuid;
        if (_health != null) {
            (_health as HealthSender).cancel();   // the run never waits for health values
        }
        var handler = new RunSendHandler(self, uuid);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/runs", entry["b"] as Dictionary, handler.method(:onDone));
        _current = request;
        tries++;
        _client.enqueue(request);
        changed();
    }

    // The server has the run: the entry goes, the journal and its marker with it. Then the heart rate series may follow.
    hidden function confirmed(uuid as String) as Void {
        _outbox.remove(uuid);
        _journal.discard(uuid);
        _sent.add(uuid);
        changed();
        sendAll();
        if (_health != null && _current == null) {
            (_health as HealthSender).sendAll();
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

    hidden function errorTextOf2(data as Dictionary or String or Null) as String or Null {
        if (!(data instanceof Dictionary)) {
            return null;
        }
        var error = (data as Dictionary)["error"];
        if (!(error instanceof Dictionary)) {
            return null;
        }
        var message = (error as Dictionary)["message"];
        return message instanceof String ? message as String : null;
    }

    hidden function changed() as Void {
        if (_observer != null) {
            (_observer as Method() as Void).invoke();
        }
    }
}

class RunSendHandler {
    private var _owner as RunSender;
    private var _uuid as String;

    function initialize(owner as RunSender, uuid as String) {
        _owner = owner;
        _uuid = uuid;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onSendDone(_uuid, code, data, outcome);
    }
}
