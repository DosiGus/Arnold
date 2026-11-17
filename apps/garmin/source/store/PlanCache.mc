import Toybox.Application;
import Toybox.Lang;

// The plan on the watch, in parts (07 D-22): a directory (plan version, next
// day, per day id, name, exercise count, minutes, tag) and every day under its
// own key with its own tag. The tag of a day is its ETag, so a day is loaded
// again only when the directory shows another tag. Training works from here
// without a connection (PRD P-04).
//
//   plan          { "dir": directory, "at": fetch time }
//   plan:day:<id> { "tag": tag the day was loaded with, "at": time, "day": day }
//   plan:recent   { "at": time, "cat": [exercises for "add exercise"] }
//
// The watch cannot read response headers, so there is no ETag for the
// directory itself; it is small and always loaded in full.
class PlanCache {
    enum DayState {
        DAY_MISSING,   // never loaded
        DAY_STALE,     // loaded, but the directory shows a newer tag
        DAY_LOADED     // loaded and current
    }

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    // The stored directory, or null when there is none (or it is unreadable).
    function directory() as Dictionary or Null {
        var entry = _store.getValue(StoreKeys.PLAN);
        if (!(entry instanceof Dictionary)) {
            return null;
        }
        var dir = (entry as Dictionary)["dir"] as Object or Null;
        return PlanCache.isDirectory(dir) ? dir as Dictionary : null;
    }

    // Seconds since epoch when the directory was loaded, or null.
    function fetchedAt() as Number or Null {
        var entry = _store.getValue(StoreKeys.PLAN);
        if (!(entry instanceof Dictionary)) {
            return null;
        }
        var at = (entry as Dictionary)["at"];
        return at instanceof Number ? at as Number : null;
    }

    // Stores a directory from the server. Days that are no longer in the plan
    // lose their stored copy. False (and nothing changed) if it is malformed.
    function putDirectory(body as Dictionary, now as Number) as Boolean {
        if (!PlanCache.isDirectory(body)) {
            return false;
        }
        var kept = {
            "p" => body["p"],
            "next" => body["next"],
            "days" => body["days"]
        };
        // UX-007: the plan mark, sent back after a complete sync (PlanSync).
        if (body["v"] instanceof String) {
            kept["v"] = body["v"];
        }
        var old = directory();
        if (old != null) {
            var oldDays = (old as Dictionary)["days"] as Array;
            for (var i = 0; i < oldDays.size(); i++) {
                var id = (oldDays[i] as Dictionary)["id"] as String;
                if (!PlanCache.hasDay(kept["days"] as Array, id)) {
                    _store.deleteValue(StoreKeys.planDay(id));
                }
            }
        }
        var entry = { "dir" => kept, "at" => now };
        _store.setValue(StoreKeys.PLAN, entry as Application.Storage.ValueType);
        return true;
    }

    // The plan mark of the stored directory, or null (older server).
    function mark() as String or Null {
        var dir = directory();
        if (dir == null) {
            return null;
        }
        var v = (dir as Dictionary)["v"];
        return v instanceof String ? v as String : null;
    }

    // How current the stored copy of a day (an entry of the directory) is.
    function dayState(dayEntry as Dictionary) as DayState {
        var stored = readDay(dayEntry["id"] as String);
        if (stored == null) {
            return DAY_MISSING;
        }
        var tag = (stored as Dictionary)["tag"];
        return tag instanceof String && (tag as String).equals(dayEntry["tag"] as String) ? DAY_LOADED : DAY_STALE;
    }

    // The tag a stored day was loaded with (sent as If-None-Match), or null.
    function dayTag(id as String) as String or Null {
        var stored = readDay(id);
        return stored == null ? null : (stored as Dictionary)["tag"] as String;
    }

    // One day of the plan, or null if it is not stored.
    function day(id as String) as Dictionary or Null {
        var stored = readDay(id);
        return stored == null ? null : (stored as Dictionary)["day"] as Dictionary;
    }

    // Stores a day under the tag the directory named for it. False if malformed.
    function putDay(id as String, tag as String, body as Dictionary, now as Number) as Boolean {
        if (!PlanCache.isDay(body) || !(body["id"] as String).equals(id)) {
            return false;
        }
        var day = {
            "p" => body["p"],
            "id" => body["id"],
            "n" => body["n"],
            "cat" => body["cat"],
            "items" => body["items"]
        };
        var entry = { "tag" => tag, "at" => now, "day" => day };
        _store.setValue(StoreKeys.planDay(id), entry as Application.Storage.ValueType);
        return true;
    }

    // The server confirmed (304) that the stored day is still current.
    function confirmDay(id as String, tag as String, now as Number) as Void {
        var stored = readDay(id);
        if (stored == null) {
            return;
        }
        var entry = { "tag" => tag, "at" => now, "day" => (stored as Dictionary)["day"] };
        _store.setValue(StoreKeys.planDay(id), entry as Application.Storage.ValueType);
    }

    function putRecent(body as Dictionary, now as Number) as Boolean {
        if (!(body["cat"] instanceof Array)) {
            return false;
        }
        var entry = { "at" => now, "cat" => body["cat"] };
        _store.setValue(StoreKeys.PLAN_RECENT, entry as Application.Storage.ValueType);
        return true;
    }

    // Exercises for "add exercise" (up to 10), or null.
    function recent() as Array or Null {
        var entry = _store.getValue(StoreKeys.PLAN_RECENT);
        if (!(entry instanceof Dictionary)) {
            return null;
        }
        var cat = (entry as Dictionary)["cat"];
        return cat instanceof Array ? cat as Array : null;
    }

    // Removes the whole plan (sign-out, other account, no active plan).
    function clear() as Void {
        var dir = directory();
        if (dir != null) {
            var days = (dir as Dictionary)["days"] as Array;
            for (var i = 0; i < days.size(); i++) {
                _store.deleteValue(StoreKeys.planDay((days[i] as Dictionary)["id"] as String));
            }
        }
        _store.deleteValue(StoreKeys.PLAN);
        _store.deleteValue(StoreKeys.PLAN_RECENT);
    }

    hidden function readDay(id as String) as Dictionary or Null {
        var stored = _store.getValue(StoreKeys.planDay(id));
        if (!(stored instanceof Dictionary)) {
            return null;
        }
        var entry = stored as Dictionary;
        var storedDay = entry["day"] as Object or Null;
        if (!(entry["tag"] instanceof String) || !PlanCache.isDay(storedDay)) {
            return null;
        }
        return entry;
    }

    static function hasDay(days as Array, id as String) as Boolean {
        for (var i = 0; i < days.size(); i++) {
            if (((days[i] as Dictionary)["id"] as String).equals(id)) {
                return true;
            }
        }
        return false;
    }

    // Shape of a directory (D-22): p, next, and days with id, n, c, m (or null) and tag.
    static function isDirectory(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var dir = value as Dictionary;
        if (!(dir["p"] instanceof String) || !(dir["next"] instanceof String) || !(dir["days"] instanceof Array)) {
            return false;
        }
        var days = dir["days"] as Array;
        if (days.size() == 0) {
            return false;
        }
        for (var i = 0; i < days.size(); i++) {
            if (!(days[i] instanceof Dictionary)) {
                return false;
            }
            var day = days[i] as Dictionary;
            var minutes = day["m"];
            if (!(day["id"] instanceof String) || !(day["n"] instanceof String) || !(day["c"] instanceof Number)
                || !(day["tag"] instanceof String) || !(minutes == null || minutes instanceof Number)) {
                return false;
            }
        }
        return true;
    }

    // Shape of one day (D-22): p, id, n, cat (catalog) and items.
    static function isDay(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var day = value as Dictionary;
        if (!(day["p"] instanceof String) || !(day["id"] instanceof String) || !(day["n"] instanceof String)) {
            return false;
        }
        return day["cat"] instanceof Array && day["items"] instanceof Array ? true : false;
    }
}
