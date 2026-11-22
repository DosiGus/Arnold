import Toybox.Communications;
import Toybox.Lang;

// Loads the mobility routines into the MobilityCache (MOB-008): first the list (GET /mobility/today),
// then every routine that is missing or has a new tag, one after the other (GET /mobility/<id> with
// If-None-Match, 304 confirms). Whatever is loaded stays, even if a later part fails.
//
// An older server has no mobility routes and answers 404: that means "no mobility". The stored state is
// removed, the start screen looks as it did before, there is no message and no repeated try (the state is
// DONE, `available` is false). Without the phone or on a server error the old state stays. A 401 goes the
// usual way (the watch must connect again). Foreground only (the ApiClient uses timers).
class MobilitySync {
    enum State {
        MOB_IDLE,
        MOB_LOADING,
        MOB_DONE,
        MOB_FAILED      // see `problem`
    }

    enum Problem {
        MOB_PROBLEM_NONE,
        MOB_PROBLEM_UNREACHABLE,  // no answer or a server error after the retries
        MOB_PROBLEM_AUTH,         // 401: the watch must connect again
        MOB_PROBLEM_UPGRADE,      // 426: the app is too old
        MOB_PROBLEM_INVALID       // the answer did not look like mobility, or a routine is missing
    }

    var state as Number;
    var problem as Number;
    var available as Boolean;   // false once the server answered 404: no mobility there
    var missing as Number;      // routines that could not be loaded in the last run
    var cache as MobilityCache;

    private var _client as ApiClient;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _observer as (Method() as Void) or Null;
    private var _generation as Number;
    private var _queue as Array<String>;
    private var _current as ApiRequest or Null;

    function initialize(client as ApiClient, mobilityCache as MobilityCache, clock as PairingClock, authRejected as Method() as Void) {
        _client = client;
        cache = mobilityCache;
        _clock = clock;
        _authRejected = authRejected;
        _observer = null;
        _generation = 0;
        _queue = [] as Array<String>;
        _current = null;
        state = MOB_IDLE;
        problem = MOB_PROBLEM_NONE;
        available = true;
        missing = 0;
    }

    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    // True while a request waits for the phone (Bluetooth link to the phone is down).
    function isPhoneMissing() as Boolean {
        return state == MOB_LOADING && _client.lastCode == RetryPolicy.BLE_CONNECTION_UNAVAILABLE;
    }

    // Starts a run of the loader. Does nothing while one is running.
    function start() as Void {
        if (state == MOB_LOADING) {
            return;
        }
        _generation++;
        state = MOB_LOADING;
        problem = MOB_PROBLEM_NONE;
        missing = 0;
        var handler = new MobilityTodayHandler(self, _generation);
        send(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/mobility/today", null, handler.method(:onDone)));
        changed();
    }

    function onTodayDone(generation as Number, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != MOB_LOADING) {
            return;
        }
        // An older server: no mobility. Clear what was stored; quiet, and no new try.
        if (outcome == ApiClient.DONE_FAILED && code == 404) {
            _current = null;
            cache.clear();
            available = false;
            finish();
            return;
        }
        if (!succeeded(code, outcome)) {
            return;
        }
        available = true;
        if (code != 304) {
            if (!(data instanceof Dictionary && cache.putToday(data as Dictionary, _clock.nowSeconds()))) {
                fail(MOB_PROBLEM_INVALID);   // the old state stays
                return;
            }
        }
        _queue = [] as Array<String>;
        var all = cache.items();
        for (var i = 0; i < all.size(); i++) {
            if (cache.routineState(all[i] as Dictionary) != MobilityCache.ROUTINE_LOADED) {
                _queue.add((all[i] as Dictionary)["id"] as String);
            }
        }
        changed();
        loadNext();
    }

    hidden function loadNext() as Void {
        if (_queue.size() == 0) {
            finish();
            return;
        }
        var id = _queue[0];
        _queue.remove(id);
        var entry = cache.item(id);
        if (entry == null) {
            missing++;
            loadNext();
            return;
        }
        var tag = (entry as Dictionary)["tag"] as String;
        var handler = new MobilityRoutineHandler(self, _generation, id, tag);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/mobility/" + id, null, handler.method(:onDone));
        var stored = cache.routineTag(id);
        request.etag = stored == null ? null : "\"" + (stored as String) + "\"";
        send(request);
    }

    function onRoutineDone(generation as Number, id as String, tag as String, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != MOB_LOADING) {
            return;
        }
        // The routine left the plan since the list was loaded: this one is missing, the others go on.
        if (outcome == ApiClient.DONE_FAILED && (code == 404 || code == 422)) {
            _current = null;
            missing++;
            loadNext();
            return;
        }
        if (!succeeded(code, outcome)) {
            return;
        }
        var now = _clock.nowSeconds();
        if (code == 304) {
            cache.confirmRoutine(id, tag, now);
        } else if (!(data instanceof Dictionary && cache.putRoutine(id, tag, data as Dictionary, now))) {
            missing++;
        }
        changed();
        loadNext();
    }

    // Common handling of a final answer: true for success (200 or 304), otherwise the run is over.
    hidden function succeeded(code as Number, outcome as Number) as Boolean {
        var request = _current;
        _current = null;
        if (outcome == ApiClient.DONE_OK) {
            return true;
        }
        if (outcome == ApiClient.WAITING) {
            if (request != null) {
                _client.drop(request as ApiRequest);
            }
            fail(MOB_PROBLEM_UNREACHABLE);
            return false;
        }
        if (code == 401) {
            fail(MOB_PROBLEM_AUTH);
            _authRejected.invoke();
            return false;
        }
        if (code == 426) {
            fail(MOB_PROBLEM_UPGRADE);
            return false;
        }
        fail(MOB_PROBLEM_UNREACHABLE);
        return false;
    }

    hidden function send(request as ApiRequest) as Void {
        _current = request;
        _client.enqueue(request);
    }

    hidden function fail(reason as Number) as Void {
        _generation++;
        _queue = [] as Array<String>;
        state = MOB_FAILED;
        problem = reason;
        changed();
    }

    hidden function finish() as Void {
        _generation++;
        state = missing > 0 ? MOB_FAILED : MOB_DONE;
        problem = missing > 0 ? MOB_PROBLEM_INVALID : MOB_PROBLEM_NONE;
        changed();
    }

    hidden function changed() as Void {
        if (_observer != null) {
            (_observer as Method() as Void).invoke();
        }
    }
}

class MobilityTodayHandler {
    private var _owner as MobilitySync;
    private var _generation as Number;

    function initialize(owner as MobilitySync, generation as Number) {
        _owner = owner;
        _generation = generation;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onTodayDone(_generation, code, data, outcome);
    }
}

class MobilityRoutineHandler {
    private var _owner as MobilitySync;
    private var _generation as Number;
    private var _id as String;
    private var _tag as String;

    function initialize(owner as MobilitySync, generation as Number, id as String, tag as String) {
        _owner = owner;
        _generation = generation;
        _id = id;
        _tag = tag;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onRoutineDone(_generation, _id, _tag, code, data, outcome);
    }
}
