import Toybox.Communications;
import Toybox.Lang;

// Sends the frozen requests of the outbox one after the other (PRD S-02 to S-05).
// An answer from the server decides what happens to an entry:
//   confirmed (200, also a repeated one)  -> entry and journal are removed
//   SCHEMA_MISMATCH                       -> counts as sent (the workout was changed in ChatGPT)
//   DUPLICATE_WORKOUT / CONFIRMATION_REQUIRED -> the user is asked (see SyncPrompts)
//   no answer / 5xx / no phone            -> stays, tried again later (same request)
//   anything else                         -> stays with the server's text, tried again on "Send now"
// Foreground only (the ApiClient uses timers).
class OutboxSender {
    enum Phase {
        PHASE_NONE,        // nothing known about this workout (not saved)
        PHASE_QUEUED,      // saved, waiting to be sent
        PHASE_SENDING,
        PHASE_SENT,
        PHASE_REJECTED,    // the server refused it
        PHASE_ASKING       // the user has to decide (duplicate or unusual values)
    }

    var lastResult as Dictionary or Null;   // { "u": uuid, "records": [...], "next": [...] } of the last confirmed send

    private var _client as ApiClient;
    private var _outbox as Outbox;
    private var _journal as Journal;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _observer as (Method() as Void) or Null;
    private var _current as ApiRequest or Null;
    private var _currentId as String or Null;

    function initialize(client as ApiClient, outbox as Outbox, journal as Journal, clock as PairingClock, authRejected as Method() as Void) {
        _client = client;
        _outbox = outbox;
        _journal = journal;
        _clock = clock;
        _authRejected = authRejected;
        _observer = null;
        _current = null;
        _currentId = null;
        lastResult = null;
    }

    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    function outbox() as Outbox {
        return _outbox;
    }

    // Number of workouts that wait to be sent (PRD S-05: "1 workout waiting").
    function pendingCount() as Number {
        return _outbox.count();
    }

    // True while the request waits for the phone (no Bluetooth link to the phone).
    function isPhoneMissing() as Boolean {
        return _current != null && _client.lastCode == RetryPolicy.BLE_CONNECTION_UNAVAILABLE;
    }

    function isSending() as Boolean {
        return _current != null;
    }

    // Where a workout stands, for its screen.
    function phaseOf(uuid as String) as Number {
        var entry = _outbox.get(uuid);
        if (entry == null) {
            var result = lastResult;
            return result != null && ((result as Dictionary)["u"] as String).equals(uuid) ? PHASE_SENT : PHASE_NONE;
        }
        var status = (entry as Dictionary)["s"] as Number;
        if (status == Outbox.STATUS_DUPLICATE || status == Outbox.STATUS_UNUSUAL) {
            return PHASE_ASKING;
        }
        if (status == Outbox.STATUS_REJECTED) {
            return PHASE_REJECTED;
        }
        return _currentId != null && (_currentId as String).equals(uuid) ? PHASE_SENDING : PHASE_QUEUED;
    }

    // The text the server gave for a refused entry, or null.
    function errorTextOf(uuid as String) as String or Null {
        var entry = _outbox.get(uuid);
        if (entry == null || !((entry as Dictionary)["m"] instanceof String)) {
            return null;
        }
        return (entry as Dictionary)["m"] as String;
    }

    // Starts sending the next entry that is ready. One request at a time.
    function sendAll() as Void {
        if (_current != null) {
            return;
        }
        var ids = _outbox.ids();
        for (var i = 0; i < ids.size(); i++) {
            var entry = _outbox.get(ids[i]) as Dictionary;
            if ((entry["s"] as Number) == Outbox.STATUS_READY) {
                send(ids[i], entry);
                return;
            }
        }
    }

    // "Send now": entries the server refused are tried again too.
    function sendNow() as Void {
        var ids = _outbox.ids();
        for (var i = 0; i < ids.size(); i++) {
            var entry = _outbox.get(ids[i]) as Dictionary;
            if ((entry["s"] as Number) == Outbox.STATUS_REJECTED) {
                entry["s"] = Outbox.STATUS_READY;
                _outbox.update(ids[i], entry);
            }
        }
        changed();
        sendAll();
    }

    // "Save anyway": a NEW request with confirm_duplicate. The old request stays unchanged on the server.
    function confirmDuplicate(uuid as String) as Void {
        reissue(uuid, "confirm_duplicate");
    }

    // "Yes, the values are right": a new request with confirm_unusual_values.
    function confirmUnusual(uuid as String) as Void {
        reissue(uuid, "confirm_unusual_values");
    }

    // "No, the values are wrong": back to the summary of the workout.
    function backToSummary(uuid as String) as Void {
        _outbox.remove(uuid);
        _journal.setActive(uuid);
        changed();
    }

    // The workout is thrown away (duplicate declined, or discarded after 14 days).
    function discard(uuid as String) as Void {
        _outbox.remove(uuid);
        _journal.discard(uuid);
        changed();
    }

    // The question after 14 days was answered "keep": ask again in 14 days.
    function keep(uuid as String) as Void {
        var entry = _outbox.get(uuid);
        if (entry != null) {
            (entry as Dictionary)["q"] = _clock.nowSeconds();
            _outbox.update(uuid, entry as Dictionary);
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
            changed();
            sendAll();
            return;
        }
        var e = entry as Dictionary;
        if (outcome == ApiClient.DONE_OK) {
            confirmed(uuid, data);
            changed();
            sendAll();
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
            if (code == 409 && errorCode != null && (errorCode as String).equals("SCHEMA_MISMATCH")) {
                confirmed(uuid, null);   // it arrived and was changed in ChatGPT since: counts as sent
                changed();
                sendAll();
                return;
            }
            if (code == 409 && errorCode != null && (errorCode as String).equals("DUPLICATE_WORKOUT")) {
                e["s"] = Outbox.STATUS_DUPLICATE;
            } else if (errorCode != null && (errorCode as String).equals("CONFIRMATION_REQUIRED")) {
                e["s"] = Outbox.STATUS_UNUSUAL;
            } else {
                e["s"] = Outbox.STATUS_REJECTED;
                e["e"] = errorCode == null ? code.toString() : errorCode;
                var text = errorTextOf2(data);
                if (text != null) {
                    e["m"] = text;
                }
            }
        }
        _outbox.update(uuid, e);
        changed();
        // After "no answer" or an expired token the next try waits for the next occasion
        // (app start, "Send now"); the other entries would fail the same way.
        if (outcome != ApiClient.WAITING && code != 401) {
            sendAll();
        }
    }

    hidden function send(uuid as String, entry as Dictionary) as Void {
        _currentId = uuid;
        var handler = new OutboxSendHandler(self, uuid);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/workouts", entry["b"] as Dictionary, handler.method(:onDone));
        _current = request;
        _client.enqueue(request);
        changed();
    }

    // A new request for the same workout with one confirmation flag; it is frozen again.
    hidden function reissue(uuid as String, flag as String) as Void {
        var entry = _outbox.get(uuid);
        if (entry == null) {
            return;
        }
        var e = entry as Dictionary;
        var body = e["b"] as Dictionary;
        var copy = {};
        var keys = body.keys();
        for (var i = 0; i < keys.size(); i++) {
            copy[keys[i]] = body[keys[i]];
        }
        copy["request_id"] = "gw_" + Uuid.v4();
        copy[flag] = true;
        e["b"] = copy;
        e["s"] = Outbox.STATUS_READY;
        e["n"] = 0;
        _outbox.update(uuid, e);
        changed();
        sendAll();
    }

    hidden function confirmed(uuid as String, data as Dictionary or String or Null) as Void {
        var records = [] as Array;
        var next = [] as Array;
        if (data instanceof Dictionary) {
            var summary = (data as Dictionary)["summary"];
            if (summary instanceof Dictionary) {
                var r = (summary as Dictionary)["records"];
                var n = (summary as Dictionary)["next"];
                records = r instanceof Array ? r as Array : records;
                next = n instanceof Array ? n as Array : next;
            }
        }
        _outbox.remove(uuid);
        _journal.discard(uuid);
        lastResult = { "u" => uuid, "records" => records, "next" => next };
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

class OutboxSendHandler {
    private var _owner as OutboxSender;
    private var _uuid as String;

    function initialize(owner as OutboxSender, uuid as String) {
        _owner = owner;
        _uuid = uuid;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onSendDone(_uuid, code, data, outcome);
    }
}
