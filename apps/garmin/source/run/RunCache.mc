import Toybox.Application;
import Toybox.Lang;

// The planned runs on the watch (RUN-012), in parts like the plan (PlanCache):
//
//   run:up        { "d": today by the server, "ld": local day number when it was loaded,
//                   "hc": heart rate consent, "at": load time,
//                   "runs": [{ "id", "d", "n", "m", "tag" }] }       at most 7 entries
//   run:p:<id>    { "tag": tag it was loaded with, "at": time, "p": prescription }
//
// Starting a run works from here without a connection: the prescriptions of today
// and the next six days are loaded ahead. The size is bounded by the server
// (list 1500 bytes, prescription 3000 bytes, 7 runs) and again here: more than
// 7 entries or 80 segments are not stored. The watch cannot read response
// headers, so the list is always loaded in full; the `tag` of an entry is the ETag
// of its prescription (sent as If-None-Match in quotes).
class RunCache {
    enum PrescriptionState {
        PRESCRIPTION_MISSING,
        PRESCRIPTION_STALE,     // loaded, but the list shows another tag
        PRESCRIPTION_LOADED
    }

    const MAX_RUNS as Number = 7;
    const MAX_SEGMENTS as Number = 80;

    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    hidden function readUpcoming() as Dictionary or Null {
        var entry = _store.getValue(StoreKeys.RUN_UPCOMING);
        if (!(entry instanceof Dictionary)) {
            return null;
        }
        var dict = entry as Dictionary;
        if (!(dict["d"] instanceof String) || !(dict["ld"] instanceof Number) || !(dict["runs"] instanceof Array)) {
            return null;
        }
        return dict;
    }

    // True once a list is stored.
    function hasUpcoming() as Boolean {
        return readUpcoming() != null;
    }

    // Heart rate consent of the account as the server last said it; null before the first list.
    function healthConsent() as Boolean or Null {
        var dict = readUpcoming();
        if (dict == null || !((dict as Dictionary)["hc"] instanceof Boolean)) {
            return null;
        }
        return (dict as Dictionary)["hc"] as Boolean;
    }

    // Seconds since epoch when the list was loaded, or null.
    function fetchedAt() as Number or Null {
        var dict = readUpcoming();
        if (dict == null || !((dict as Dictionary)["at"] instanceof Number)) {
            return null;
        }
        return (dict as Dictionary)["at"] as Number;
    }

    // Today's date: the server's date of the last list, moved on by the local calendar
    // days that passed since. Null before the first list.
    function today(now as Number, offsetMinutes as Number) as String or Null {
        var dict = readUpcoming();
        if (dict == null) {
            return null;
        }
        var base = RunDate.dayNumber((dict as Dictionary)["d"] as String);
        if (base == null) {
            return null;
        }
        var passed = RunDate.localDay(now, offsetMinutes) - ((dict as Dictionary)["ld"] as Number);
        return RunDate.iso((base as Number) + (passed > 0 ? passed : 0));
    }

    // Stored entries, ascending by date.
    function runs() as Array<Dictionary> {
        var dict = readUpcoming();
        var out = [] as Array<Dictionary>;
        if (dict == null) {
            return out;
        }
        var all = (dict as Dictionary)["runs"] as Array;
        for (var i = 0; i < all.size(); i++) {
            if (all[i] instanceof Dictionary) {
                out.add(all[i] as Dictionary);
            }
        }
        return out;
    }

    // The runs planned for today (see `today`), in list order.
    function todayRuns(now as Number, offsetMinutes as Number) as Array<Dictionary> {
        var out = [] as Array<Dictionary>;
        var date = today(now, offsetMinutes);
        if (date == null) {
            return out;
        }
        var all = runs();
        for (var i = 0; i < all.size(); i++) {
            var run = all[i];
            var runDate = run["d"] as Object or Null;
            if (runDate instanceof String && (runDate as String).equals(date as String)) {
                out.add(run);
            }
        }
        return out;
    }

    // Stores the answer of GET /runs/upcoming. Prescriptions of runs that are no longer
    // in the list lose their copy. False (and nothing changed) if it is malformed.
    function putUpcoming(body as Dictionary, now as Number, offsetMinutes as Number) as Boolean {
        if (!(body["d"] instanceof String) || RunDate.dayNumber(body["d"] as String) == null
            || !(body["hc"] instanceof Boolean) || !(body["runs"] instanceof Array)) {
            return false;
        }
        var incoming = body["runs"] as Array;
        if (incoming.size() > MAX_RUNS) {
            return false;
        }
        var kept = [] as Array<Dictionary>;
        for (var i = 0; i < incoming.size(); i++) {
            var entry = compactEntry(incoming[i] as Object or Null);
            if (entry == null) {
                return false;
            }
            kept.add(entry as Dictionary);
        }
        var old = runs();
        var record = {
            "d" => body["d"],
            "ld" => RunDate.localDay(now, offsetMinutes),
            "hc" => body["hc"],
            "at" => now,
            "runs" => kept
        };
        _store.setValue(StoreKeys.RUN_UPCOMING, record as Application.Storage.ValueType);
        for (var j = 0; j < old.size(); j++) {
            var id = old[j]["id"] as String;
            if (!hasEntry(kept, id)) {
                _store.deleteValue(StoreKeys.runPrescription(id));
            }
        }
        return true;
    }

    // Takes over past runs: entries dated before today lose their copy. Called when
    // the app opens, also without a connection.
    function prune(now as Number, offsetMinutes as Number) as Void {
        var date = today(now, offsetMinutes);
        var dict = readUpcoming();
        if (date == null || dict == null) {
            return;
        }
        var all = runs();
        var kept = [] as Array<Dictionary>;
        for (var i = 0; i < all.size(); i++) {
            var run = all[i];
            if ((run["d"] as String).compareTo(date as String) < 0) {
                _store.deleteValue(StoreKeys.runPrescription(run["id"] as String));
            } else {
                kept.add(run);
            }
        }
        if (kept.size() != all.size()) {
            var record = {
                "d" => (dict as Dictionary)["d"],
                "ld" => (dict as Dictionary)["ld"],
                "hc" => (dict as Dictionary)["hc"],
                "at" => (dict as Dictionary)["at"],
                "runs" => kept
            };
            _store.setValue(StoreKeys.RUN_UPCOMING, record as Application.Storage.ValueType);
        }
    }

    // How current the stored prescription of a list entry is.
    function prescriptionState(entry as Dictionary) as PrescriptionState {
        var stored = readPrescription(entry["id"] as String);
        if (stored == null) {
            return PRESCRIPTION_MISSING;
        }
        var tag = (stored as Dictionary)["tag"] as String;
        return tag.equals(entry["tag"] as String) ? PRESCRIPTION_LOADED : PRESCRIPTION_STALE;
    }

    // The tag a stored prescription was loaded with, or null.
    function prescriptionTag(id as String) as String or Null {
        var stored = readPrescription(id);
        return stored == null ? null : (stored as Dictionary)["tag"] as String;
    }

    // The prescription of a run (compact form of GET /runs/:id), or null if not stored.
    function prescription(id as String) as Dictionary or Null {
        var stored = readPrescription(id);
        return stored == null ? null : (stored as Dictionary)["p"] as Dictionary;
    }

    // The entry of the list with this id, or null.
    function entry(id as String) as Dictionary or Null {
        var all = runs();
        for (var i = 0; i < all.size(); i++) {
            if ((all[i]["id"] as String).equals(id)) {
                return all[i];
            }
        }
        return null;
    }

    // Stores a prescription under the tag the list named for it. Only runs of the
    // list are stored. False if malformed.
    function putPrescription(id as String, tag as String, body as Dictionary, now as Number) as Boolean {
        if (entry(id) == null || !RunCache.isPrescription(body["p"] as Object or Null) || !(body["id"] instanceof String)
            || !(body["id"] as String).equals(id)) {
            return false;
        }
        var record = { "tag" => tag, "at" => now, "p" => body["p"] };
        _store.setValue(StoreKeys.runPrescription(id), record as Application.Storage.ValueType);
        return true;
    }

    // The server confirmed (304) that the stored prescription is still current.
    function confirmPrescription(id as String, tag as String, now as Number) as Void {
        var stored = readPrescription(id);
        if (stored == null) {
            return;
        }
        var record = { "tag" => tag, "at" => now, "p" => (stored as Dictionary)["p"] };
        _store.setValue(StoreKeys.runPrescription(id), record as Application.Storage.ValueType);
    }

    // Removes everything (sign-out, other account).
    function clear() as Void {
        var all = runs();
        for (var i = 0; i < all.size(); i++) {
            _store.deleteValue(StoreKeys.runPrescription(all[i]["id"] as String));
        }
        _store.deleteValue(StoreKeys.RUN_UPCOMING);
    }

    hidden function readPrescription(id as String) as Dictionary or Null {
        var stored = _store.getValue(StoreKeys.runPrescription(id));
        if (!(stored instanceof Dictionary)) {
            return null;
        }
        var record = stored as Dictionary;
        if (!(record["tag"] instanceof String) || !RunCache.isPrescription(record["p"] as Object or Null)) {
            return null;
        }
        return record;
    }

    // An entry as the watch keeps it: id, d (date), n (name), m (minutes or null), tag.
    hidden function compactEntry(value as Object or Null) as Dictionary or Null {
        if (!(value instanceof Dictionary)) {
            return null;
        }
        var run = value as Dictionary;
        var minutes = run["m"];
        if (!(run["id"] instanceof String) || (run["id"] as String).length() == 0 || !(run["d"] instanceof String)
            || RunDate.dayNumber(run["d"] as String) == null || !(run["n"] instanceof String)
            || !(run["tag"] instanceof String) || !(minutes == null || minutes instanceof Number)) {
            return null;
        }
        return { "id" => run["id"], "d" => run["d"], "n" => run["n"], "m" => minutes, "tag" => run["tag"] };
    }

    hidden function hasEntry(list as Array<Dictionary>, id as String) as Boolean {
        for (var i = 0; i < list.size(); i++) {
            if ((list[i]["id"] as String).equals(id)) {
                return true;
            }
        }
        return false;
    }

    // Shape of a prescription: k (type code), n (name), e (environment code) and 1 to 80 segments s.
    static function isPrescription(value as Object or Null) as Boolean {
        if (!(value instanceof Dictionary)) {
            return false;
        }
        var p = value as Dictionary;
        if (!(p["k"] instanceof Number) || !(p["n"] instanceof String) || !(p["e"] instanceof Number) || !(p["s"] instanceof Array)) {
            return false;
        }
        var count = (p["s"] as Array).size();
        return count >= 1 && count <= 80;
    }
}
