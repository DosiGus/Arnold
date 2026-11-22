import Toybox.Application;
import Toybox.Lang;

// The mobility routines on the watch (ARN-MOB, MOB-008), in parts like the plan (PlanCache):
//
//   mob:up              { "d": date of the list (local, by the server), "mv": mobility mark, "at": load time,
//                         "items": [{ "id", "k", "n", "m", "w", "a", "dn", "tag" }] }   at most 5 entries
//   mob:r:<id>          { "tag": tag it was loaded with, "at": time, "r": { "id", "tot", "ex": [...] } }
//   mob:done:<date>     [session ids finished on this watch that day] (written when the result is sent, MOB-010)
//
// Entry of the list: id = session id, k = "m" morning routine or "s" session, n = name, m = minutes,
// w = weekday bits (1..127, bit 0 = Monday), a = strength session it follows (null: own day),
// dn = done today (by the server), tag = ETag of the routine. Exercise: c, n, h = cue, s = sides (1|2),
// t = seconds per side, r = repetitions or null. Only these keys are stored; unknown keys are dropped.
// The server bounds the sizes (list 1200, routine 2500 bytes), and again here: more than 5 entries or
// 15 exercises are not stored. The watch cannot read response headers, so the list is always loaded in full.
// A broken or incomplete answer leaves the stored state as it is.
class MobilityCache {
    enum RoutineState {
        ROUTINE_MISSING,
        ROUTINE_STALE,     // loaded, but the list shows another tag
        ROUTINE_LOADED
    }

    const MAX_ITEMS as Number = 5;
    const MAX_EXERCISES as Number = 15;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    // The stored list, or null when there is none (or it is unreadable).
    function today() as Dictionary or Null {
        var entry = _store.getValue(StoreKeys.MOB_TODAY);
        if (!(entry instanceof Dictionary)) {
            return null;
        }
        var dict = entry as Dictionary;
        if (!MobilityCache.isList(dict) || !(dict["at"] instanceof Number)) {
            return null;
        }
        return dict;
    }

    // True once a list is stored.
    function hasToday() as Boolean {
        return today() != null;
    }

    // The entries of the stored list (none without a list).
    function items() as Array {
        var dict = today();
        return dict == null ? [] as Array : (dict as Dictionary)["items"] as Array;
    }

    // The mobility mark of the stored list, or null.
    function mark() as String or Null {
        var dict = today();
        return dict == null ? null : (dict as Dictionary)["mv"] as String;
    }

    // The date the list was loaded for ("2026-11-23"), or null.
    function listDate() as String or Null {
        var dict = today();
        return dict == null ? null : (dict as Dictionary)["d"] as String;
    }

    // One entry of the list, or null.
    function item(id as String) as Dictionary or Null {
        var all = items();
        for (var i = 0; i < all.size(); i++) {
            if (((all[i] as Dictionary)["id"] as String).equals(id)) {
                return all[i] as Dictionary;
            }
        }
        return null;
    }

    // Stores a list from the server. Routines that are no longer in the list lose their stored copy.
    // False (and nothing changed) if the answer is malformed.
    function putToday(body as Dictionary, now as Number) as Boolean {
        if (!MobilityCache.isList(body)) {
            return false;
        }
        var source = body["items"] as Array;
        var kept = [] as Array;
        for (var i = 0; i < source.size(); i++) {
            var raw = source[i] as Dictionary;
            kept.add({
                "id" => raw["id"], "k" => raw["k"], "n" => raw["n"], "m" => raw["m"],
                "w" => raw["w"], "a" => raw["a"], "dn" => raw["dn"], "tag" => raw["tag"]
            });
        }
        var old = items();
        for (var j = 0; j < old.size(); j++) {
            var id = (old[j] as Dictionary)["id"] as String;
            if (!MobilityCache.hasItem(kept, id)) {
                _store.deleteValue(StoreKeys.mobRoutine(id));
            }
        }
        var entry = { "d" => body["d"], "mv" => body["mv"], "at" => now, "items" => kept };
        _store.setValue(StoreKeys.MOB_TODAY, entry as Application.Storage.ValueType);
        return true;
    }

    // How current the stored copy of a routine (an entry of the list) is.
    function routineState(entry as Dictionary) as RoutineState {
        var stored = readRoutine(entry["id"] as String);
        if (stored == null) {
            return ROUTINE_MISSING;
        }
        var tag = (stored as Dictionary)["tag"];
        return tag instanceof String && (tag as String).equals(entry["tag"] as String) ? ROUTINE_LOADED : ROUTINE_STALE;
    }

    // The tag a stored routine was loaded with (sent as If-None-Match), or null.
    function routineTag(id as String) as String or Null {
        var stored = readRoutine(id);
        return stored == null ? null : (stored as Dictionary)["tag"] as String;
    }

    // One routine, or null if it is not stored.
    function routine(id as String) as Dictionary or Null {
        var stored = readRoutine(id);
        return stored == null ? null : (stored as Dictionary)["r"] as Dictionary;
    }

    // Stores a routine under the tag the list named for it. False (nothing changed) if malformed.
    function putRoutine(id as String, tag as String, body as Dictionary, now as Number) as Boolean {
        if (!MobilityCache.isRoutine(body) || !(body["id"] as String).equals(id)) {
            return false;
        }
        var source = body["ex"] as Array;
        var exercises = [] as Array;
        for (var i = 0; i < source.size(); i++) {
            var raw = source[i] as Dictionary;
            exercises.add({ "c" => raw["c"], "n" => raw["n"], "h" => raw["h"], "s" => raw["s"], "t" => raw["t"], "r" => raw["r"] });
        }
        var routine = { "id" => body["id"], "tot" => body["tot"], "ex" => exercises };
        var entry = { "tag" => tag, "at" => now, "r" => routine };
        _store.setValue(StoreKeys.mobRoutine(id), entry as Application.Storage.ValueType);
        return true;
    }

    // The server confirmed (304) that the stored routine is still current.
    function confirmRoutine(id as String, tag as String, now as Number) as Void {
        var stored = readRoutine(id);
        if (stored == null) {
            return;
        }
        var entry = { "tag" => tag, "at" => now, "r" => (stored as Dictionary)["r"] };
        _store.setValue(StoreKeys.mobRoutine(id), entry as Application.Storage.ValueType);
    }

    // True when a list is stored and every routine in it is loaded with the tag of the list.
    function isComplete() as Boolean {
        var dict = today();
        if (dict == null) {
            return false;
        }
        var all = (dict as Dictionary)["items"] as Array;
        for (var i = 0; i < all.size(); i++) {
            if (routineState(all[i] as Dictionary) != ROUTINE_LOADED) {
                return false;
            }
        }
        return true;
    }

    // The mark that goes to the server with the plan confirmation: only after a complete, successful sync.
    function completeMark() as String or Null {
        return isComplete() ? mark() : null;
    }

    // Removes everything mobility (no mobility on the server, sign-out, other account).
    function clear() as Void {
        var all = items();
        for (var i = 0; i < all.size(); i++) {
            _store.deleteValue(StoreKeys.mobRoutine((all[i] as Dictionary)["id"] as String));
        }
        _store.deleteValue(StoreKeys.MOB_TODAY);
    }

    // Session ids marked done on this watch for a local date ("2026-11-23"), written by MOB-010 when a result is sent.
    function doneLocal(date as String) as Array<String> {
        var stored = _store.getValue(StoreKeys.mobDone(date));
        var out = [] as Array<String>;
        if (!(stored instanceof Array)) {
            return out;
        }
        var list = stored as Array;
        for (var i = 0; i < list.size(); i++) {
            if (list[i] instanceof String) {
                out.add(list[i] as String);
            }
        }
        return out;
    }

    // Done today: the server says so (only for the date of its list) or this watch noted it.
    function isDone(entry as Dictionary, date as String) as Boolean {
        var listed = listDate();
        if (entry["dn"] == true && listed != null && (listed as String).equals(date)) {
            return true;
        }
        var local = doneLocal(date);
        for (var i = 0; i < local.size(); i++) {
            if (local[i].equals(entry["id"] as String)) {
                return true;
            }
        }
        return false;
    }

    hidden function readRoutine(id as String) as Dictionary or Null {
        var stored = _store.getValue(StoreKeys.mobRoutine(id));
        if (!(stored instanceof Dictionary)) {
            return null;
        }
        var entry = stored as Dictionary;
        var body = entry["r"] as Object or Null;
        if (!(entry["tag"] instanceof String) || !MobilityCache.isRoutine(body)) {
            return null;
        }
        return entry;
    }

    static function hasItem(items as Array, id as String) as Boolean {
        for (var i = 0; i < items.size(); i++) {
            if (((items[i] as Dictionary)["id"] as String).equals(id)) {
                return true;
            }
        }
        return false;
    }

    // Shape of the list: d (a date), mv and 0 to 5 entries.
    static function isList(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var dict = value as Dictionary;
        if (!(dict["d"] instanceof String) || RunDate.dayNumber(dict["d"] as String) == null || !(dict["mv"] instanceof String) || !(dict["items"] instanceof Array)) {
            return false;
        }
        var all = dict["items"] as Array;
        if (all.size() > 5) {
            return false;
        }
        for (var i = 0; i < all.size(); i++) {
            if (!MobilityCache.isItem(all[i] as Object or Null)) {
                return false;
            }
        }
        return true;
    }

    // Shape of one entry: id, k ("m" or "s"), n, m (1 or more), w (1 to 127), a (null or a text), dn, tag.
    static function isItem(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var item = value as Dictionary;
        if (!(item["id"] instanceof String) || !(item["k"] instanceof String) || !(item["n"] instanceof String)
            || !(item["tag"] instanceof String) || !(item["dn"] instanceof Boolean)) {
            return false;
        }
        var kind = item["k"] as String;
        if (!kind.equals("m") && !kind.equals("s")) {
            return false;
        }
        var minutes = item["m"];
        var weekdays = item["w"];
        if (!(minutes instanceof Number) || (minutes as Number) < 1 || !(weekdays instanceof Number)
            || (weekdays as Number) < 1 || (weekdays as Number) > 127) {
            return false;
        }
        var after = item["a"];
        return after == null || after instanceof String;
    }

    // Shape of one routine: id, tot (0 or more seconds) and 1 to 15 exercises.
    static function isRoutine(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var routine = value as Dictionary;
        if (!(routine["id"] instanceof String) || !(routine["tot"] instanceof Number) || !(routine["ex"] instanceof Array)) {
            return false;
        }
        var all = routine["ex"] as Array;
        if (all.size() < 1 || all.size() > 15) {
            return false;
        }
        for (var i = 0; i < all.size(); i++) {
            if (!MobilityCache.isExercise(all[i] as Object or Null)) {
                return false;
            }
        }
        return true;
    }

    static function isExercise(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var ex = value as Dictionary;
        if (!(ex["c"] instanceof String) || !(ex["n"] instanceof String) || !(ex["h"] instanceof String)) {
            return false;
        }
        var sides = ex["s"];
        var seconds = ex["t"];
        var reps = ex["r"];
        return sides instanceof Number && ((sides as Number) == 1 || (sides as Number) == 2)
            && seconds instanceof Number && (seconds as Number) >= 1
            && (reps == null || reps instanceof Number);
    }
}

// Which day and time it is for the watch. Weekdays count from Monday (bit 0), the morning is 04:00 to 11:59 local time.
module MobilityDay {

    // Bit of a local calendar day in the weekday mask (day 0 = 1970-01-01 was a Thursday, bit 3).
    function weekdayBit(localDayNumber as Number) as Number {
        var index = ((localDayNumber + 3) % 7 + 7) % 7;
        return 1 << index;
    }

    // The local date ("2026-11-23") of a moment.
    function localDate(now as Number, offsetMinutes as Number) as String {
        return RunDate.iso(RunDate.localDay(now, offsetMinutes));
    }

    // Morning on the watch: 04:00 up to and including 11:59 local time.
    function isMorning(now as Number, offsetMinutes as Number) as Boolean {
        var seconds = (((now + offsetMinutes * 60) % 86400) + 86400) % 86400;
        return seconds >= 4 * 3600 && seconds < 12 * 3600;
    }

    // Whether the entry is on today's weekday.
    function onToday(entry as Dictionary, now as Number, offsetMinutes as Number) as Boolean {
        var bits = entry["w"] as Number;
        return (bits & weekdayBit(RunDate.localDay(now, offsetMinutes))) != 0;
    }
}
