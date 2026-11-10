import Toybox.Application;
import Toybox.Lang;

// The journal of the workout in progress (UMSETZUNG 7.2, 7.3, PRD S-01): the truth
// about what was trained, kept in Application.Storage.
//
//   sess:active       uuid of the running workout
//   sess:<uuid>:head  small state entry (where the workout is, how many events)
//   sess:<uuid>:plan  the training day the workout runs on (copied at the start)
//   sess:<uuid>:<n>   one event per set or change, appended and never rewritten
//
// Writing order: the event first, then the head. A crash in between leaves an
// event the head does not count yet; reading finds it by its number and its
// checksum and takes it over. An event that was only half written fails its
// checksum and is ignored, together with anything after it.
class Journal {
    enum Kind {
        EVENT_SET = 1,      // a set confirmed (or later corrected)
        EVENT_SKIP = 2,     // an exercise was passed over (without sets, or by the user)
        EVENT_ADJUST = 3    // planned values of a set changed: r, g; d = 1 also for the sets after it
    }

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    // The uuid of the workout in progress, or null.
    function activeId() as String or Null {
        var id = _store.getValue(StoreKeys.ACTIVE_SESSION);
        return id instanceof String && Uuid.isV4(id as String) ? id as String : null;
    }

    // True once the workout was saved for sending (its outbox entry exists).
    function isSaved(uuid as String) as Boolean {
        return _store.getValue(StoreKeys.outbox(uuid)) != null;
    }

    // Creates a workout: plan copy and head first, the active marker last, so a
    // start that was interrupted never looks like a running workout.
    function begin(uuid as String, head as Dictionary, planDay as Dictionary) as Void {
        _store.setValue(StoreKeys.sessionPlan(uuid), planDay as Application.Storage.ValueType);
        _store.setValue(StoreKeys.sessionHead(uuid), head as Application.Storage.ValueType);
        _store.setValue(StoreKeys.ACTIVE_SESSION, uuid);
    }

    function saveHead(uuid as String, head as Dictionary) as Void {
        _store.setValue(StoreKeys.sessionHead(uuid), head as Application.Storage.ValueType);
    }

    function readHead(uuid as String) as Dictionary or Null {
        var head = _store.getValue(StoreKeys.sessionHead(uuid));
        if (!(head instanceof Dictionary)) {
            return null;
        }
        var entry = head as Dictionary;
        if (!(entry["n"] instanceof Number) || !(entry["st"] instanceof Number) || !(entry["ex"] instanceof Number)
            || !(entry["s"] instanceof Number) || !(entry["t"] instanceof Number)) {
            return null;
        }
        return entry;
    }

    function readPlan(uuid as String) as Dictionary or Null {
        var day = _store.getValue(StoreKeys.sessionPlan(uuid));
        return PlanCache.isDay(day as Object or Null) ? day as Dictionary : null;
    }

    // Appends event number `n` (the head's count) with its checksum. The caller
    // raises the head's count and saves the head afterwards.
    function appendEvent(uuid as String, n as Number, event as Dictionary) as Void {
        event["n"] = n;
        event["c"] = checksum(event);
        _store.setValue(StoreKeys.sessionEvent(uuid, n), event as Application.Storage.ValueType);
    }

    // The valid events from number 0 on. Reading stops at the first missing or
    // damaged one. The result can be longer than the head's count (see above).
    function events(uuid as String) as Array<Dictionary> {
        var list = [] as Array<Dictionary>;
        var n = 0;
        while (true) {
            var event = readEvent(uuid, n);
            if (event == null) {
                break;
            }
            list.add(event as Dictionary);
            n++;
        }
        return list;
    }

    // Removes everything of a workout.
    function discard(uuid as String) as Void {
        var n = 0;
        while (_store.getValue(StoreKeys.sessionEvent(uuid, n)) != null) {
            _store.deleteValue(StoreKeys.sessionEvent(uuid, n));
            n++;
        }
        _store.deleteValue(StoreKeys.sessionHead(uuid));
        _store.deleteValue(StoreKeys.sessionPlan(uuid));
        if (activeId() != null && (activeId() as String).equals(uuid)) {
            _store.deleteValue(StoreKeys.ACTIVE_SESSION);
        }
    }

    // Marker only (used when the head or the plan copy cannot be read, and once
    // a finished workout is saved for sending).
    function forgetActive() as Void {
        _store.deleteValue(StoreKeys.ACTIVE_SESSION);
    }

    // Makes a workout the one in progress again (back from the "send?" question to the summary).
    function setActive(uuid as String) as Void {
        _store.setValue(StoreKeys.ACTIVE_SESSION, uuid);
    }

    hidden function readEvent(uuid as String, n as Number) as Dictionary or Null {
        var raw = _store.getValue(StoreKeys.sessionEvent(uuid, n));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var event = raw as Dictionary;
        if (!(event["n"] instanceof Number) || (event["n"] as Number) != n || !(event["c"] instanceof Number)) {
            return null;
        }
        if ((event["c"] as Number) != checksum(event)) {
            return null;
        }
        return event;
    }

    // Small checksum over the fields of an event; catches an entry that was written only in part.
    function checksum(event as Dictionary) as Number {
        var keys = ["k", "e", "s", "r", "g", "d", "a", "b", "n"];
        var acc = 7;
        for (var i = 0; i < keys.size(); i++) {
            var value = event[keys[i]];
            var v = value instanceof Number ? (value as Number) : -1;
            acc = (acc * 31 + (v % 65521) + 65521 + i) % 65521;
        }
        return acc;
    }
}
