import Toybox.Application;
import Toybox.Lang;

// Finished mobility routines waiting to be sent (MOB-010), after RunOutbox: each entry holds the request of
// POST /mobility, built once and frozen (request_id "gm_" + uuid), so a repeated send is the same request.
// An entry is removed only after the server confirmed it (or said it has the routine already).
//
//   mout:index   uuids, oldest first
//   mout:<uuid>  { "u": uuid, "b": request, "t": saved at, "n": tries, "s": status, "i": session id, "d": local date,
//                  "e": error code, "m": error text }
class MobilityOutbox {
    enum Status {
        STATUS_READY,       // to be sent (again)
        STATUS_REJECTED     // the server refused it for good; dropped after 14 days
    }

    const STALE_AFTER_S as Number = 14 * 24 * 3600;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    function ids() as Array<String> {
        var raw = _store.getValue(StoreKeys.MOB_OUTBOX_INDEX);
        var list = [] as Array<String>;
        if (raw instanceof Array) {
            for (var i = 0; i < (raw as Array).size(); i++) {
                var id = (raw as Array)[i];
                if (id instanceof String && get(id as String) != null) {
                    list.add(id as String);
                }
            }
        }
        return list;
    }

    function count() as Number {
        return ids().size();
    }

    function get(id as String) as Dictionary or Null {
        var raw = _store.getValue(StoreKeys.mobOutbox(id));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var entry = raw as Dictionary;
        if (!(entry["b"] instanceof Dictionary) || !(entry["t"] instanceof Number) || !(entry["s"] instanceof Number) || !(entry["n"] instanceof Number)) {
            return null;
        }
        return entry;
    }

    // Freezes the request of a result (once; a second call with the same uuid does nothing): the entry first, then the index.
    function addResult(result as Dictionary, now as Number) as Boolean {
        var id = result["session_uuid"] as String;
        if (get(id) != null) {
            return false;
        }
        var entry = { "u" => id, "b" => MobilityHandover.request(result), "t" => now, "n" => 0, "s" => STATUS_READY,
            "i" => result["session_id"], "d" => result["workout_date_local"] } as Dictionary;
        _store.setValue(StoreKeys.mobOutbox(id), entry as Application.Storage.ValueType);
        var list = rawIds();
        list.add(id);
        _store.setValue(StoreKeys.MOB_OUTBOX_INDEX, list as Application.Storage.ValueType);
        return true;
    }

    function update(id as String, entry as Dictionary) as Void {
        _store.setValue(StoreKeys.mobOutbox(id), entry as Application.Storage.ValueType);
    }

    function remove(id as String) as Void {
        var list = rawIds();
        list.remove(id);
        if (list.size() == 0) {
            _store.deleteValue(StoreKeys.MOB_OUTBOX_INDEX);
        } else {
            _store.setValue(StoreKeys.MOB_OUTBOX_INDEX, list as Application.Storage.ValueType);
        }
        _store.deleteValue(StoreKeys.mobOutbox(id));
    }

    function clear() as Void {
        var list = rawIds();
        for (var i = 0; i < list.size(); i++) {
            _store.deleteValue(StoreKeys.mobOutbox(list[i]));
        }
        _store.deleteValue(StoreKeys.MOB_OUTBOX_INDEX);
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
        var raw = _store.getValue(StoreKeys.MOB_OUTBOX_INDEX);
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
