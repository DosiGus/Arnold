import Toybox.Communications;
import Toybox.Lang;

// Loads the planned runs into the RunCache (RUN-012): first the list (GET /runs/upcoming:
// today, the next six days and the heart rate consent), then the prescription of every
// run that is missing or has a new tag, one after the other (GET /runs/:id with
// If-None-Match). Whatever is loaded stays, even if a later part fails, so a patchy
// connection still brings the runs in over several tries. Entries of days that
// have passed are removed first. Foreground only (the ApiClient uses timers).
class RunSync {
    enum State {
        RUN_IDLE,
        RUN_LOADING,
        RUN_DONE,
        RUN_FAILED      // see `problem`
    }

    enum Problem {
        RUN_PROBLEM_NONE,
        RUN_PROBLEM_SETUP,        // SETUP_REQUIRED: finish setup in ChatGPT first
        RUN_PROBLEM_UNREACHABLE,  // no answer or a server error after the retries
        RUN_PROBLEM_AUTH,         // 401: the watch must connect again
        RUN_PROBLEM_UPGRADE,      // 426: the app is too old
        RUN_PROBLEM_INVALID       // the answer did not look like runs, or a prescription is missing
    }

    var state as Number;
    var problem as Number;
    var missing as Number;      // prescriptions that could not be loaded in the last run
    var cache as RunCache;

    private var _client as ApiClient;
    private var _clock as PairingClock;
    private var _authRejected as Method() as Void;
    private var _observer as (Method() as Void) or Null;
    private var _generation as Number;
    private var _queue as Array<String>;
    private var _current as ApiRequest or Null;

    function initialize(client as ApiClient, runCache as RunCache, clock as PairingClock, authRejected as Method() as Void) {
        _client = client;
        cache = runCache;
        _clock = clock;
        _authRejected = authRejected;
        _observer = null;
        _generation = 0;
        _queue = [] as Array<String>;
        _current = null;
        state = RUN_IDLE;
        problem = RUN_PROBLEM_NONE;
        missing = 0;
    }

    function setObserver(observer as (Method() as Void) or Null) as Void {
        _observer = observer;
    }

    // True while a request waits for the phone (Bluetooth link to the phone is down).
    function isPhoneMissing() as Boolean {
        return state == RUN_LOADING && _client.lastCode == RetryPolicy.BLE_CONNECTION_UNAVAILABLE;
    }

    // Starts a run of the loader. Does nothing while one is running.
    function start() as Void {
        if (state == RUN_LOADING) {
            return;
        }
        _generation++;
        state = RUN_LOADING;
        problem = RUN_PROBLEM_NONE;
        missing = 0;
        cache.prune(_clock.nowSeconds(), _clock.utcOffsetMinutes());
        var handler = new RunUpcomingHandler(self, _generation);
        send(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/runs/upcoming", null, handler.method(:onDone)));
        changed();
    }

    function onUpcomingDone(generation as Number, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != RUN_LOADING) {
            return;
        }
        if (!succeeded(code, data, outcome)) {
            return;
        }
        if (code != 304) {
            if (!(data instanceof Dictionary && cache.putUpcoming(data as Dictionary, _clock.nowSeconds(), _clock.utcOffsetMinutes()))) {
                fail(RUN_PROBLEM_INVALID);
                return;
            }
        }
        _queue = [] as Array<String>;
        var all = cache.runs();
        for (var i = 0; i < all.size(); i++) {
            if (cache.prescriptionState(all[i]) != RunCache.PRESCRIPTION_LOADED) {
                _queue.add(all[i]["id"] as String);
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
        var entry = cache.entry(id);
        if (entry == null) {
            missing++;
            loadNext();
            return;
        }
        var tag = (entry as Dictionary)["tag"] as String;
        var handler = new RunPrescriptionHandler(self, _generation, id, tag);
        var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/runs/" + id, null, handler.method(:onDone));
        var stored = cache.prescriptionTag(id);
        request.etag = stored == null ? null : "\"" + (stored as String) + "\"";
        send(request);
    }

    function onPrescriptionDone(generation as Number, id as String, tag as String, code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (generation != _generation || state != RUN_LOADING) {
            return;
        }
        // The run left the plan since the list was loaded: this one is missing, the others go on.
        if (outcome == ApiClient.DONE_FAILED && (code == 404 || code == 422)) {
            _current = null;
            missing++;
            loadNext();
            return;
        }
        if (!succeeded(code, data, outcome)) {
            return;
        }
        var now = _clock.nowSeconds();
        if (code == 304) {
            cache.confirmPrescription(id, tag, now);
        } else if (!(data instanceof Dictionary && cache.putPrescription(id, tag, data as Dictionary, now))) {
            missing++;
        }
        changed();
        loadNext();
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
            fail(RUN_PROBLEM_UNREACHABLE);
            return false;
        }
        if (code == 401) {
            fail(RUN_PROBLEM_AUTH);
            _authRejected.invoke();
            return false;
        }
        if (code == 426) {
            fail(RUN_PROBLEM_UPGRADE);
            return false;
        }
        if (errorCodeOf(data).equals("SETUP_REQUIRED")) {
            cache.clear();
            fail(RUN_PROBLEM_SETUP);
            return false;
        }
        fail(RUN_PROBLEM_UNREACHABLE);
        return false;
    }

    hidden function errorCodeOf(data as Dictionary or String or Null) as String {
        if (!(data instanceof Dictionary)) {
            return "";
        }
        var error = (data as Dictionary)["error"];
        if (!(error instanceof Dictionary)) {
            return "";
        }
        var code = (error as Dictionary)["code"];
        return code instanceof String ? code as String : "";
    }

    hidden function send(request as ApiRequest) as Void {
        _current = request;
        _client.enqueue(request);
    }

    hidden function fail(reason as Number) as Void {
        _generation++;
        _queue = [] as Array<String>;
        state = RUN_FAILED;
        problem = reason;
        changed();
    }

    hidden function finish() as Void {
        _generation++;
        state = missing > 0 ? RUN_FAILED : RUN_DONE;
        problem = missing > 0 ? RUN_PROBLEM_INVALID : RUN_PROBLEM_NONE;
        changed();
    }

    hidden function changed() as Void {
        if (_observer != null) {
            (_observer as Method() as Void).invoke();
        }
    }
}

class RunUpcomingHandler {
    private var _owner as RunSync;
    private var _generation as Number;

    function initialize(owner as RunSync, generation as Number) {
        _owner = owner;
        _generation = generation;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onUpcomingDone(_generation, code, data, outcome);
    }
}

class RunPrescriptionHandler {
    private var _owner as RunSync;
    private var _generation as Number;
    private var _id as String;
    private var _tag as String;

    function initialize(owner as RunSync, generation as Number, id as String, tag as String) {
        _owner = owner;
        _generation = generation;
        _id = id;
        _tag = tag;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        _owner.onPrescriptionDone(_generation, _id, _tag, code, data, outcome);
    }
}
