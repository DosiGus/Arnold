import Toybox.Application;
import Toybox.Lang;

// Health values of finished workouts waiting to be sent (GAR-B4-02, UMSETZUNG 3.4).
// Same idea as the workout outbox, but separate: a problem here never touches the
// workout upload. Each entry holds the frozen request body.
//
//   hout:index   ids (the workout uuids), oldest first
//   hout:<id>    { "u": uuid, "b": request, "t": saved at, "n": tries }
class HealthOutbox {
    const STALE_AFTER_S as Number = 14 * 24 * 3600;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    function store() as KeyValueStore {
        return _store;
    }

    function ids() as Array<String> {
        var raw = _store.getValue(StoreKeys.HEALTH_INDEX);
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
        var raw = _store.getValue(StoreKeys.healthOutbox(id));
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var entry = raw as Dictionary;
        if (!(entry["b"] instanceof Dictionary) || !(entry["t"] instanceof Number)) {
            return null;
        }
        return entry;
    }

    // Saving twice never builds a second entry (a workout saved again from the summary).
    function add(id as String, request as Dictionary, now as Number) as Boolean {
        if (contains(id)) {
            return false;
        }
        var entry = { "u" => id, "b" => request, "t" => now, "n" => 0 };
        _store.setValue(StoreKeys.healthOutbox(id), entry as Application.Storage.ValueType);
        var list = rawIds();
        list.add(id);
        _store.setValue(StoreKeys.HEALTH_INDEX, list as Application.Storage.ValueType);
        return true;
    }

    function countTry(id as String) as Void {
        var entry = get(id);
        if (entry != null) {
            (entry as Dictionary)["n"] = ((entry as Dictionary)["n"] as Number) + 1;
            _store.setValue(StoreKeys.healthOutbox(id), entry as Application.Storage.ValueType);
        }
    }

    function remove(id as String) as Void {
        var list = rawIds();
        list.remove(id);
        if (list.size() == 0) {
            _store.deleteValue(StoreKeys.HEALTH_INDEX);
        } else {
            _store.setValue(StoreKeys.HEALTH_INDEX, list as Application.Storage.ValueType);
        }
        _store.deleteValue(StoreKeys.healthOutbox(id));
    }

    function clear() as Void {
        var list = rawIds();
        for (var i = 0; i < list.size(); i++) {
            _store.deleteValue(StoreKeys.healthOutbox(list[i]));
        }
        _store.deleteValue(StoreKeys.HEALTH_INDEX);
    }

    // Entries older than 14 days are dropped: the values lose their meaning.
    function prune(now as Number) as Void {
        var all = ids();
        for (var i = 0; i < all.size(); i++) {
            var entry = get(all[i]) as Dictionary;
            if (now - (entry["t"] as Number) >= STALE_AFTER_S) {
                remove(all[i]);
            }
        }
    }

    hidden function rawIds() as Array<String> {
        var raw = _store.getValue(StoreKeys.HEALTH_INDEX);
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
