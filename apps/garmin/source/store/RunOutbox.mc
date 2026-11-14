import Toybox.Application;
import Toybox.Lang;

// Finished runs waiting to be sent (RUN-018), after the outbox of the strength part: each entry holds the request of
// POST /runs, built once and frozen, so a repeated send is the same request and Arnold never gets a run twice.
// An entry is removed only after the server confirmed it (or said it has the run already).
//
//   rout:index   ids (the run uuids), oldest first
//   rout:<id>    { "u": uuid, "b": request, "t": saved at, "n": tries, "s": status, "e": error code, "m": error text }
class RunOutbox {
    enum Status {
        STATUS_READY,       // to be sent (again)
        STATUS_REJECTED     // the server refused it for good; shown, dropped after 14 days
    }

    const STALE_AFTER_S as Number = 14 * 24 * 3600;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    function ids() as Array<String> {
        var raw = _store.getValue(StoreKeys.RUN_OUTBOX_INDEX);
        var list = [] as Array<String>;
        if (!(raw instanceof Array)) {
            return list;
        }
        for (var i = 0; i < (raw as Array).size(); i++) {
            var id = (raw as Array)[i];
            if (id instanceof String && get(id as String) != null) {
                list.add(id as String);
            }
        }
        return list;
    }

    function count() as Number {
        return ids().size();
    }

    function contains(id as String) as Boolean {
        return get(id) != null;
    }

    function get(id as String) as Dictionary or Null {
        var raw = _store.getValue(StoreKeys.runOutbox(id));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var entry = raw as Dictionary;
        if (!(entry["b"] instanceof Dictionary) || !(entry["t"] instanceof Number) || !(entry["s"] instanceof Number) || !(entry["n"] instanceof Number)) {
            return null;
        }
        return entry;
    }

    // Saves a new entry with the frozen request: the entry first, then the index. Nothing happens when the run is in
    // the outbox already (building the result twice never makes a second request).
    function add(id as String, request as Dictionary, now as Number) as Boolean {
        if (contains(id)) {
            return false;
        }
        var entry = { "u" => id, "b" => request, "t" => now, "n" => 0, "s" => STATUS_READY };
        _store.setValue(StoreKeys.runOutbox(id), entry as Application.Storage.ValueType);
        var list = rawIds();
        list.add(id);
        _store.setValue(StoreKeys.RUN_OUTBOX_INDEX, list as Application.Storage.ValueType);
        return true;
    }

    function update(id as String, entry as Dictionary) as Void {
        _store.setValue(StoreKeys.runOutbox(id), entry as Application.Storage.ValueType);
    }

    function remove(id as String) as Void {
        var list = rawIds();
        list.remove(id);
        if (list.size() == 0) {
            _store.deleteValue(StoreKeys.RUN_OUTBOX_INDEX);
        } else {
            _store.setValue(StoreKeys.RUN_OUTBOX_INDEX, list as Application.Storage.ValueType);
        }
        _store.deleteValue(StoreKeys.runOutbox(id));
    }

    // Refused entries older than 14 days.
    function stale(now as Number) as Array<String> {
        var out = [] as Array<String>;
        var all = ids();
        for (var i = 0; i < all.size(); i++) {
            var entry = get(all[i]) as Dictionary;
            if ((entry["s"] as Number) == STATUS_REJECTED && now - (entry["t"] as Number) >= STALE_AFTER_S) {
                out.add(all[i]);
            }
        }
        return out;
    }

    hidden function rawIds() as Array<String> {
        var raw = _store.getValue(StoreKeys.RUN_OUTBOX_INDEX);
        var list = [] as Array<String>;
        if (raw instanceof Array) {
            for (var i = 0; i < (raw as Array).size(); i++) {
                if ((raw as Array)[i] instanceof String) {
                    list.add((raw as Array)[i] as String);
                }
            }
        }
        return list;
    }
}
