import Toybox.Application;
import Toybox.Lang;

// The journal of the mobility routine in progress (MOB-010, after RunJournal): what the watch knows about it if the
// app or the watch stops. Kept in Application.Storage:
//
//   mob:active     uuid of the routine (stays until the result is in the outbox or the routine is thrown away)
//   mob:<uuid>:h   head: state, session, kind, times, the exercises done so far, checksum
//
// The head is one value written in one go, with a checksum: a half-written head is ignored. It is written after
// every exercise and every 30 seconds of movement. A routine that was interrupted is not continued: when the app
// opens, MobilityHandover puts what was done into the outbox once, as ended early.
class MobilityJournal {
    enum State {
        STATE_RUNNING,
        STATE_ENDED
    }

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    function activeId() as String or Null {
        var id = _store.getValue(StoreKeys.MOB_ACTIVE);
        return id instanceof String && Uuid.isV4(id as String) ? id as String : null;
    }

    // Head first, the active marker last.
    function begin(uuid as String, head as Dictionary) as Void {
        saveHead(uuid, head);
        _store.setValue(StoreKeys.MOB_ACTIVE, uuid);
    }

    function saveHead(uuid as String, head as Dictionary) as Void {
        head["c"] = checksum(head);
        _store.setValue(StoreKeys.mobHead(uuid), head as Application.Storage.ValueType);
    }

    // The head, or null when it is missing, incomplete or damaged.
    function readHead(uuid as String) as Dictionary or Null {
        var raw = _store.getValue(StoreKeys.mobHead(uuid));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var head = raw as Dictionary;
        var numbers = ["st", "o", "a", "lt", "tm", "el", "ee", "cs", "c"];
        for (var i = 0; i < numbers.size(); i++) {
            if (!(head[numbers[i]] instanceof Number)) {
                return null;
            }
        }
        if (!(head["id"] instanceof String) || !(head["k"] instanceof String) || !(head["ci"] instanceof String) || !(head["ex"] instanceof Array)) {
            return null;
        }
        var all = head["ex"] as Array;
        for (var j = 0; j < all.size(); j++) {
            var item = all[j];
            if (!(item instanceof Dictionary) || !((item as Dictionary)["c"] instanceof String) || !((item as Dictionary)["st"] instanceof String) || !((item as Dictionary)["t"] instanceof Number)) {
                return null;
            }
        }
        return (head["c"] as Number) == checksum(head) ? head : null;
    }

    function discard(uuid as String) as Void {
        _store.deleteValue(StoreKeys.mobHead(uuid));
        var active = activeId();
        if (active != null && (active as String).equals(uuid)) {
            _store.deleteValue(StoreKeys.MOB_ACTIVE);
        }
    }

    // Checksum over the numbers of the head and the exercises; catches an entry written only in part.
    function checksum(head as Dictionary) as Number {
        var keys = ["st", "o", "a", "lt", "tm", "el", "ee", "cs"];
        var acc = 7;
        for (var i = 0; i < keys.size(); i++) {
            var value = head[keys[i]];
            var v = value instanceof Number ? (value as Number) : -1;
            acc = (acc * 31 + (v % 65521) + 65521 + i) % 65521;
        }
        var all = head["ex"];
        var count = all instanceof Array ? (all as Array).size() : 0;
        acc = (acc * 31 + count) % 65521;
        for (var j = 0; j < count; j++) {
            var item = (all as Array)[j];
            var t = item instanceof Dictionary && (item as Dictionary)["t"] instanceof Number ? (item as Dictionary)["t"] as Number : -1;
            acc = (acc * 31 + (t % 65521) + 65521 + j) % 65521;
        }
        return acc;
    }
}

// Where a mobility result goes on its way to Arnold: the routine in progress is told by the journal, the finished one
// is frozen in the outbox once (request_id "gm_" + uuid), and a routine the app lost is put there when the app opens.
module MobilityHandover {
    var live as String or Null = null;   // the routine this process is running (it is not "interrupted")

    // The request of POST /mobility for a result (MobilityPlayer.result). session_id and plan_version_id go together
    // or not at all: a routine whose answer did not name its plan version (an older cache) is sent as a free routine.
    // The outbox keeps the session id in any case, to mark the routine done on this watch.
    function request(result as Dictionary) as Dictionary {
        var keys = ["session_uuid", "kind", "workout_date_local", "utc_offset_min", "started_at_utc", "ended_at_utc", "timer_s", "elapsed_s", "ended_early", "ex"];
        var body = { "request_id" => "gm_" + (result["session_uuid"] as String) } as Dictionary;
        for (var i = 0; i < keys.size(); i++) {
            body[keys[i]] = result[keys[i]];
        }
        if (result["plan_version_id"] instanceof String) {
            body["plan_version_id"] = result["plan_version_id"];
            body["session_id"] = result["session_id"];
        }
        return body;
    }

    // What an interrupted routine did, as a result; null when nothing was done. The exercise under way counts as partial.
    function resultOf(uuid as String, head as Dictionary) as Dictionary or Null {
        var done = [] as Array;
        var all = head["ex"] as Array;
        for (var i = 0; i < all.size(); i++) {
            done.add(all[i]);
        }
        var running = (head["st"] as Number) == MobilityJournal.STATE_RUNNING;
        if (running && (head["cs"] as Number) > 0 && (head["ci"] as String).length() > 0) {
            done.add({ "c" => head["ci"], "st" => "partial", "t" => head["cs"] } as Dictionary);
        }
        if (done.size() == 0) {
            return null;
        }
        var started = head["a"] as Number;
        var offset = head["o"] as Number;
        var ended = head["lt"] as Number;
        var out = {
            "session_uuid" => uuid,
            "kind" => head["k"],
            "session_id" => head["id"],
            "workout_date_local" => Clock.localDate(started, offset),
            "utc_offset_min" => offset,
            "started_at_utc" => Clock.isoUtc(started),
            "ended_at_utc" => Clock.isoUtc(ended < started ? started : ended),
            "timer_s" => head["tm"],
            "elapsed_s" => head["el"],
            "ended_early" => running || (head["ee"] as Number) == 1,
            "ex" => done
        } as Dictionary;
        if (head["pv"] instanceof String && (head["pv"] as String).length() > 0) {
            out["plan_version_id"] = head["pv"];
        }
        return out;
    }

    // The app opens: a routine the journal still holds goes into the outbox, once (the journal is dropped with it).
    // True when something was queued.
    function recover(journal as MobilityJournal, outbox as MobilityOutbox, now as Number) as Boolean {
        var id = journal.activeId();
        if (id == null || (live != null && (live as String).equals(id as String))) {
            return false;
        }
        var head = journal.readHead(id as String);
        var queued = false;
        if (head != null) {
            var result = resultOf(id as String, head as Dictionary);
            if (result != null) {
                queued = outbox.addResult(result as Dictionary, now);
            }
        }
        journal.discard(id as String);
        return queued;
    }

    // The same with the real services, when the app opens (never lets a failure reach the screen).
    function recoverOnOpen() as Void {
        try {
            var sender = Session.mobilitySender();
            recover(new MobilityJournal(new KeyValueStore()), sender.outbox(), new PairingClock().nowSeconds());
            sender.sendAll();
        } catch (e) {
            // the journal stays; the next start of the app tries again
        }
    }

    // Signing out: nothing of the old account stays in the outbox or the journal.
    function wipe(outbox as MobilityOutbox, journal as MobilityJournal) as Void {
        outbox.clear();
        var id = journal.activeId();
        if (id != null) {
            journal.discard(id as String);
        }
    }
}
