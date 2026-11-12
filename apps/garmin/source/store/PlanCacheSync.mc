import Toybox.Communications;
import Toybox.Lang;

// Loads the plan into the PlanCache (07 D-22): first the directory (GET /plan),
// then every day that is missing or has a new tag, one after the other
// (GET /plan/sessions/{id} with If-None-Match), then the list for "add exercise"
// (GET /plan/recent). Whatever is loaded stays, even if a later part fails, so
// a patchy connection still brings the plan in over several tries.
// Foreground only (the ApiClient uses timers).
class PlanSync {
    enum State {
        SYNC_IDLE,      // nothing started yet
        SYNC_LOADING,
        SYNC_DONE,
        SYNC_FAILED     // see `problem`
    }

    enum Problem {
        PROBLEM_NONE,
        PROBLEM_NO_PLAN,      // NO_ACTIVE_PLAN: no plan to train yet
        PROBLEM_SETUP,        // SETUP_REQUIRED: finish setup in ChatGPT first
        PROBLEM_UNREACHABLE,  // no answer or a server error after the retries
        PROBLEM_AUTH,         // 401: the watch must connect again
        PROBLEM_UPGRADE,      // 426: the app is too old
        PROBLEM_INVALID       // the server's answer did not look like a plan
    }

    var state as Number;
    var problem as Number;
    var missingDays as Number;   // days that could not be loaded in the last run
    var cache as PlanCache;

    private var _client as ApiClient;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _observer as (Method() as Void) or Null;
    private var _generation as Number;
    private var _queue as Array<String>;     // ids of the days still to load
    private var _directory as Dictionary or Null;
    private var _current as ApiRequest or Null;
    private var _restarted as Boolean;       // a vanished day restarts the run once

    // `authRejected` is called on a 401 answer (PairingController.onAuthRejected).
    function initialize(client as ApiClient, planCache as PlanCache, clock as PairingClock, authRejected as Method() as Void) {
        _client = client;
        cache = planCache;
        _clock = clock;
        _authRejected = authRejected;
        _observer = null;
        _generation = 0;
        _queue = [] as Array<String>;
        _directory = null;
        _current = null;
        _restarted = false;
        state = SYNC_IDLE;
        problem = PROBLEM_NONE;
        missingDays = 0;
    }

    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    // True while a request waits for the phone (Bluetooth link to the phone is down).
    function isPhoneMissing() as Boolean {
        return state == SYNC_LOADING && _client.lastCode == RetryPolicy.BLE_CONNECTION_UNAVAILABLE;
    }

    // Starts a run. Does nothing while one is running.
    function start() as Void {
        if (state == SYNC_LOADING) {
            return;
        }
        _generation++;
        state = SYNC_LOADING;
        problem = PROBLEM_NONE;
        missingDays = 0;
        _restarted = false;
        requestDirectory();
        changed();
    }

    hidden function requestDirectory() as Void {
        _queue = [] as Array<String>;
        _directory = null;
        var handler = new PlanDirectoryHandler(self, _generation);
        send(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, handler.method(:onDone)));
    }

    function onDirectoryDone(generation as Number, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != SYNC_LOADING) {
            return;
        }
        if (!succeeded(code, data, outcome)) {
            return;
        }
        var now = _clock.nowSeconds();
        if (code == 304) {
            _directory = cache.directory();   // unchanged
        } else if (data instanceof Dictionary && cache.putDirectory(data as Dictionary, now)) {
            _directory = cache.directory();
        }
        if (_directory == null) {
            fail(PROBLEM_INVALID);
            return;
        }
        // The next day first, then the others in plan order.
        var dir = _directory as Dictionary;
        var days = dir["days"] as Array;
        var nextId = dir["next"] as String;
        for (var i = 0; i < days.size(); i++) {
            var entry = days[i] as Dictionary;
            if ((entry["id"] as String).equals(nextId) && cache.dayState(entry) != PlanCache.DAY_LOADED) {
                _queue.add(nextId);
            }
        }
        for (var j = 0; j < days.size(); j++) {
            var other = days[j] as Dictionary;
            if (!(other["id"] as String).equals(nextId) && cache.dayState(other) != PlanCache.DAY_LOADED) {
                _queue.add(other["id"] as String);
            }
        }
        loadNextDay();
    }

    hidden function loadNextDay() as Void {
        if (_queue.size() == 0) {
            requestRecent();
            return;
        }
        var id = _queue[0];
        _queue.remove(id);
        var tag = tagOf(id);
        if (tag == null) {
            missingDays++;
            loadNextDay();
            return;
        }
        var handler = new PlanDayHandler(self, _generation, id, tag as String);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan/sessions/" + id, null, handler.method(:onDone));
        request.etag = cache.dayTag(id);
        send(request);
    }

    function onDayDone(generation as Number, id as String, tag as String, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != SYNC_LOADING) {
            return;
        }
        // The day left the plan since the directory was loaded: start over once.
        if (outcome == ApiClient.DONE_FAILED && code == 404 && !_restarted) {
            _current = null;
            _restarted = true;
            requestDirectory();
            return;
        }
        if (outcome == ApiClient.DONE_FAILED && (code == 404 || code == 422)) {
            _current = null;
            missingDays++;
            loadNextDay();
            return;
        }
        if (!succeeded(code, data, outcome)) {
            return;
        }
        var now = _clock.nowSeconds();
        if (code == 304) {
            cache.confirmDay(id, tag, now);
        } else if (!(data instanceof Dictionary && cache.putDay(id, tag, data as Dictionary, now))) {
            missingDays++;
        }
        changed();
        loadNextDay();
    }

    hidden function requestRecent() as Void {
        var handler = new PlanRecentHandler(self, _generation);
        send(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan/recent", null, handler.method(:onDone)));
    }

    // The list for "add exercise" is a bonus: a failure does not fail the run.
    function onRecentDone(generation as Number, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != SYNC_LOADING) {
            return;
        }
        if (outcome == ApiClient.WAITING) {
            if (_current != null) {
                _client.drop(_current as ApiRequest);
            }
            _current = null;
            finish();
            return;
        }
        if (outcome == ApiClient.DONE_FAILED && code != 401 && code != 426 && !isSetupOrNoPlan(data)) {
            _current = null;
            finish();
            return;
        }
        if (!succeeded(code, data, outcome)) {
            return;
        }
        if (code != 304 && data instanceof Dictionary) {
            cache.putRecent(data as Dictionary, _clock.nowSeconds());
        }
        finish();
    }

    // Common handling of a final answer: true for success (200 or 304), otherwise the run is over.
    hidden function succeeded(code as Number, data as Dictionary or String or Null, outcome as Number) as Boolean {
        var request = _current;
        _current = null;
        if (outcome == ApiClient.DONE_OK) {
            return true;
        }
        if (outcome == ApiClient.WAITING) {
            if (request != null) {
                _client.drop(request as ApiRequest);
            }
            fail(PROBLEM_UNREACHABLE);
            return false;
        }
        if (code == 401) {
            fail(PROBLEM_AUTH);
            _authRejected.invoke();
            return false;
        }
        if (code == 426) {
            fail(PROBLEM_UPGRADE);
            return false;
        }
        var errorCode = errorCodeOf(data);
        if (errorCode != null && (errorCode as String).equals("NO_ACTIVE_PLAN")) {
            cache.clear();
            fail(PROBLEM_NO_PLAN);
            return false;
        }
        if (errorCode != null && (errorCode as String).equals("SETUP_REQUIRED")) {
            cache.clear();
            fail(PROBLEM_SETUP);
            return false;
        }
        fail(PROBLEM_UNREACHABLE);
        return false;
    }

    hidden function isSetupOrNoPlan(data as Dictionary or String or Null) as Boolean {
        var errorCode = errorCodeOf(data);
        return errorCode != null && ((errorCode as String).equals("NO_ACTIVE_PLAN") || (errorCode as String).equals("SETUP_REQUIRED"));
    }

    hidden function errorCodeOf(data as Dictionary or String or Null) as String or Null {
        if (!(data instanceof Dictionary)) {
            return null;
        }
        var error = (data as Dictionary)["error"];
        if (!(error instanceof Dictionary)) {
            return null;
        }
        var code = (error as Dictionary)["code"];
        return code instanceof String ? code as String : null;
    }

    hidden function tagOf(id as String) as String or Null {
        if (_directory == null) {
            return null;
        }
        var days = (_directory as Dictionary)["days"] as Array;
        for (var i = 0; i < days.size(); i++) {
            var entry = days[i] as Dictionary;
            if ((entry["id"] as String).equals(id)) {
                return entry["tag"] as String;
            }
        }
        return null;
    }

    hidden function send(request as ApiRequest) as Void {
        _current = request;
        _client.enqueue(request);
    }

    hidden function fail(reason as Number) as Void {
        _generation++;
        _queue = [] as Array<String>;
        state = SYNC_FAILED;
        problem = reason;
        changed();
    }

    hidden function finish() as Void {
        _generation++;
        state = missingDays > 0 ? SYNC_FAILED : SYNC_DONE;
        problem = missingDays > 0 ? PROBLEM_INVALID : PROBLEM_NONE;
        changed();
    }

    hidden function changed() as Void {
        if (_observer != null) {
            (_observer as Method() as Void).invoke();
        }
    }
}

class PlanDirectoryHandler {
    private var _owner as PlanSync;
    private var _generation as Number;

    function initialize(owner as PlanSync, generation as Number) {
        _owner = owner;
        _generation = generation;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onDirectoryDone(_generation, code, data, outcome);
    }
}

class PlanDayHandler {
    private var _owner as PlanSync;
    private var _generation as Number;
    private var _id as String;
    private var _tag as String;

    function initialize(owner as PlanSync, generation as Number, id as String, tag as String) {
        _owner = owner;
        _generation = generation;
        _id = id;
        _tag = tag;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onDayDone(_generation, _id, _tag, code, data, outcome);
    }
}

class PlanRecentHandler {
    private var _owner as PlanSync;
    private var _generation as Number;

    function initialize(owner as PlanSync, generation as Number) {
        _owner = owner;
        _generation = generation;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onRecentDone(_generation, code, data, outcome);
    }
}
