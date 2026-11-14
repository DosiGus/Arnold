import Toybox.Application;
import Toybox.Lang;

// The journal of the run in progress (RUN-015, after Journal for strength): the truth about the run
// if the app or the watch stops. Kept in Application.Storage:
//
//   run:active          uuid of the run (stays after saving until the summary has sent it, RUN-018)
//   run:<uuid>:h        head: state, segment, totals, zone seconds, counters, checksum
//   run:<uuid>:p        copy of the prescription (a plan change later does not touch the run)
//   run:<uuid>:s<k>     100 m splits, chunk k of 60 (tenths of a second of the timer)
//   run:<uuid>:g        finished segments, pauses, end, corrected distance, calories, effect (RUN-018)
//
// The head is one value written in one go, with a checksum: a half-written head is ignored and the run
// is not offered for continuing. The head is written every 30 s and at every end of a segment or lap.
class RunJournal {
    const SPLIT_CHUNK as Number = 60;
    const VERSION as Number = 1;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    // The uuid of the run in progress, or null.
    function activeId() as String or Null {
        var id = _store.getValue(StoreKeys.RUN_ACTIVE);
        return id instanceof String && Uuid.isV4(id as String) ? id as String : null;
    }

    // Whether a run waits to be continued: an active run that is not saved and whose head is intact.
    function hasInterrupted() as Boolean {
        var id = activeId();
        if (id == null) {
            return false;
        }
        var head = readHead(id as String);
        return head != null && ((head as Dictionary)["st"] as Number) != RunSession.STATE_FINISHED;
    }

    // Creates a run: copy and head first, the active marker last.
    function begin(uuid as String, head as Dictionary, prescription as Dictionary or Null) as Void {
        if (prescription != null) {
            _store.setValue(StoreKeys.runCopy(uuid), prescription as Application.Storage.ValueType);
        }
        saveHead(uuid, head);
        _store.setValue(StoreKeys.RUN_ACTIVE, uuid);
    }

    function saveHead(uuid as String, head as Dictionary) as Void {
        head["c"] = checksum(head);
        _store.setValue(StoreKeys.runHead(uuid), head as Application.Storage.ValueType);
    }

    // The head, or null when it is missing, incomplete or damaged.
    function readHead(uuid as String) as Dictionary or Null {
        var raw = _store.getValue(StoreKeys.runHead(uuid));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var head = raw as Dictionary;
        var numbers = ["v", "st", "o", "ss", "sd", "t", "d", "a", "sc", "km", "lp", "np", "hs", "hn", "hx", "cs", "cn", "md", "en", "at", "c"];
        for (var i = 0; i < numbers.size(); i++) {
            if (!(head[numbers[i]] instanceof Number)) {
                return null;
            }
        }
        if (!(head["rid"] instanceof String) || !(head["z"] instanceof Array) || (head["z"] as Array).size() != 5) {
            return null;
        }
        for (var z = 0; z < 5; z++) {
            if (!((head["z"] as Array)[z] instanceof Number)) {
                return null;
            }
        }
        return (head["c"] as Number) == checksum(head) ? head : null;
    }

    // The copy of the prescription (null for a free run or when it cannot be read).
    function readPrescription(uuid as String) as Dictionary or Null {
        var body = _store.getValue(StoreKeys.runCopy(uuid));
        return RunCache.isPrescription(body as Object or Null) ? body as Dictionary : null;
    }

    // Writes the splits `from` to `count` (exclusive) from `source`; only the chunks that changed.
    function saveSplits(uuid as String, tick as RunTick, from as Number, count as Number) as Void {
        if (count <= from) {
            return;
        }
        for (var chunk = from / SPLIT_CHUNK; chunk <= (count - 1) / SPLIT_CHUNK; chunk++) {
            var start = chunk * SPLIT_CHUNK;
            var end = count < start + SPLIT_CHUNK ? count : start + SPLIT_CHUNK;
            var values = [] as Array<Number>;
            for (var i = start; i < end; i++) {
                values.add(tick.splitAt(i));
            }
            _store.setValue(StoreKeys.runSplits(uuid, chunk), values as Application.Storage.ValueType);
        }
    }

    // Puts the stored splits (the first `count`) back into the tick.
    function readSplits(uuid as String, tick as RunTick, count as Number) as Void {
        for (var chunk = 0; chunk <= (count - 1) / SPLIT_CHUNK && count > 0; chunk++) {
            var values = _store.getValue(StoreKeys.runSplits(uuid, chunk));
            if (values instanceof Array) {
                tick.restoreSplits(chunk * SPLIT_CHUNK, values as Array<Number>);
            }
        }
    }

    // What the summary needs besides the head (finished segments, pauses, end of the run, corrected distance, calories,
    // training effect); null when nothing was written yet or it is damaged.
    function readExtra(uuid as String) as Dictionary or Null {
        var raw = _store.getValue(StoreKeys.runExtra(uuid));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var extra = raw as Dictionary;
        var numbers = ["pc", "e", "cm", "kc", "te"];
        for (var i = 0; i < numbers.size(); i++) {
            if (!(extra[numbers[i]] instanceof Number)) {
                return null;
            }
        }
        return extra["r"] instanceof Array ? extra : null;
    }

    function saveExtra(uuid as String, extra as Dictionary) as Void {
        _store.setValue(StoreKeys.runExtra(uuid), extra as Application.Storage.ValueType);
    }

    // Removes everything of a run.
    function discard(uuid as String) as Void {
        var head = readHead(uuid);
        var splits = head == null ? 600 : (head as Dictionary)["sc"] as Number;
        for (var chunk = 0; chunk <= splits / SPLIT_CHUNK; chunk++) {
            _store.deleteValue(StoreKeys.runSplits(uuid, chunk));
        }
        _store.deleteValue(StoreKeys.runHead(uuid));
        _store.deleteValue(StoreKeys.runCopy(uuid));
        _store.deleteValue(StoreKeys.runExtra(uuid));
        var active = activeId();
        if (active != null && (active as String).equals(uuid)) {
            _store.deleteValue(StoreKeys.RUN_ACTIVE);
        }
    }

    function forgetActive() as Void {
        _store.deleteValue(StoreKeys.RUN_ACTIVE);
    }

    // Checksum over the numbers of the head; catches an entry that was written only in part.
    function checksum(head as Dictionary) as Number {
        var keys = ["v", "st", "o", "ss", "sd", "t", "d", "a", "sc", "km", "lp", "np", "hs", "hn", "hx", "cs", "cn", "md", "en", "at"];
        var acc = 11;
        for (var i = 0; i < keys.size(); i++) {
            var value = head[keys[i]];
            var v = value instanceof Number ? (value as Number) : -1;
            acc = (acc * 31 + (v % 65521) + 65521 + i) % 65521;
        }
        var zones = head["z"];
        if (zones instanceof Array) {
            for (var z = 0; z < (zones as Array).size(); z++) {
                var seconds = (zones as Array)[z];
                var s = seconds instanceof Number ? (seconds as Number) : -1;
                acc = (acc * 31 + (s % 65521) + 65521 + z) % 65521;
            }
        }
        return acc;
    }
}
