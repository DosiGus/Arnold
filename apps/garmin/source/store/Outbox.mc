import Toybox.Application;
import Toybox.Lang;

// Finished workouts waiting to be sent (UMSETZUNG 7.3, 07 D-08). Each entry holds
// the upload request, built once and frozen: a repeated send is the same request,
// so the server never stores a workout twice. An entry is removed only after the
// server confirmed it (or the user discarded the workout).
//
//   out:index   ids (the workout uuids), oldest first
//   out:<id>    { "u": uuid, "b": request, "t": saved at, "n": tries, "s": status,
//                 "e": error code, "m": error text, "q": asked about it at }
class Outbox {
    enum Status {
        STATUS_READY,       // to be sent (again)
        STATUS_DUPLICATE,   // the server has the same workout already: ask the user
        STATUS_UNUSUAL,     // unusual values: ask the user
        STATUS_REJECTED     // the server refused it; shown, sent again on "Send now"
    }

    const STALE_AFTER_S as Number = 14 * 24 * 3600;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    // Ids of the entries that can be read, oldest first.
    function ids() as Array<String> {
        var raw = _store.getValue(StoreKeys.OUTBOX_INDEX);
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
        var raw = _store.getValue(StoreKeys.outbox(id));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var entry = raw as Dictionary;
        if (!(entry["b"] instanceof Dictionary) || !(entry["t"] instanceof Number) || !(entry["s"] instanceof Number)) {
            return null;
        }
        return entry;
    }

    // Saves a new entry with a frozen request: the entry first, then the index.
    // Nothing happens if the workout is in the outbox already (saving twice never builds a second request).
    function add(id as String, request as Dictionary, now as Number) as Boolean {
        if (contains(id)) {
            return false;
        }
        var entry = { "u" => id, "b" => request, "t" => now, "n" => 0, "s" => STATUS_READY, "q" => now };
        _store.setValue(StoreKeys.outbox(id), entry as Application.Storage.ValueType);
        var list = rawIds();
        list.add(id);
        _store.setValue(StoreKeys.OUTBOX_INDEX, list as Application.Storage.ValueType);
        return true;
    }

    function update(id as String, entry as Dictionary) as Void {
        _store.setValue(StoreKeys.outbox(id), entry as Application.Storage.ValueType);
    }

    function remove(id as String) as Void {
        var list = rawIds();
        list.remove(id);
        if (list.size() == 0) {
            _store.deleteValue(StoreKeys.OUTBOX_INDEX);
        } else {
            _store.setValue(StoreKeys.OUTBOX_INDEX, list as Application.Storage.ValueType);
        }
        _store.deleteValue(StoreKeys.outbox(id));
    }

    // Entries that waited longer than 14 days since they were saved or last asked about.
    function stale(now as Number) as Array<String> {
        var out = [] as Array<String>;
        var all = ids();
        for (var i = 0; i < all.size(); i++) {
            var entry = get(all[i]) as Dictionary;
            var asked = entry["q"] instanceof Number ? entry["q"] as Number : entry["t"] as Number;
            if (now - asked >= STALE_AFTER_S) {
                out.add(all[i]);
            }
        }
        return out;
    }

    hidden function rawIds() as Array<String> {
        var raw = _store.getValue(StoreKeys.OUTBOX_INDEX);
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
