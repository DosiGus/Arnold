import Toybox.Communications;
import Toybox.Lang;

// The only way the app talks to Arnold (UMSETZUNG 7.7): one queue, one request
// at a time, a timeout per request and pauses of 5 s, 30 s and 2 min between tries.
// After the third pause a request waits until kick() (the next occasion).
// "No phone" (-104) does not count as a try and is retried every 30 s.
// Foreground only (timers do not exist in the background process).
class ApiClient {
    enum Done {
        DONE_OK,
        DONE_FAILED,
        WAITING
    }

    private var _baseUrl as String;
    private var _transport as Transport;
    private var _scheduler as Scheduler;
    private var _queue as Array<ApiRequest>;
    private var _inFlight as ApiRequest or Null;
    private var _ticket as Number;
    private var _pausing as Boolean;
    private var _token as String or Null;
    private var _clientHeader as String;
    private var _language as String;

    function initialize(baseUrl as String, transport as Transport, scheduler as Scheduler) {
        _baseUrl = baseUrl;
        _transport = transport;
        _scheduler = scheduler;
        _queue = [] as Array<ApiRequest>;
        _inFlight = null;
        _ticket = 0;
        _pausing = false;
        _token = null;
        _clientHeader = AppInfo.VERSION;
        _language = "en";
    }

    // Watch token after pairing; null before pairing and after unpairing.
    function setToken(token as String or Null) as Void {
        _token = token;
    }

    // X-Arnold-Watch: "<app version>/<part number>"; Accept-Language: "de" or "en".
    function setClientInfo(partNumber as String, language as String) as Void {
        _clientHeader = AppInfo.VERSION + "/" + partNumber;
        _language = language;
    }

    function enqueue(request as ApiRequest) as Void {
        _queue.add(request);
        pump();
    }

    // The next occasion (app start, new screen, background run): waiting
    // requests get a fresh set of tries.
    function kick() as Void {
        for (var i = 0; i < _queue.size(); i++) {
            var request = _queue[i];
            if (request.waiting) {
                request.waiting = false;
                request.failures = 0;
            }
        }
        if (_pausing) {
            _scheduler.cancel();
            _pausing = false;
        }
        pump();
    }

    function pendingCount() as Number {
        return _queue.size();
    }

    function isBusy() as Boolean {
        return _inFlight != null;
    }

    // Called by the transport. Answers to an old ticket (after a timeout) are ignored.
    function onResponse(ticket as Number, code as Number, data as Dictionary or String or Null) as Void {
        if (ticket != _ticket || _inFlight == null) {
            return;
        }
        _scheduler.cancel();
        finish(_inFlight as ApiRequest, code, data);
    }

    function onTimeout() as Void {
        if (_inFlight == null) {
            return;
        }
        _ticket++;
        _transport.cancel();
        finish(_inFlight as ApiRequest, Communications.NETWORK_REQUEST_TIMED_OUT, null);
    }

    function onPauseOver() as Void {
        _pausing = false;
        pump();
    }

    hidden function pump() as Void {
        if (_inFlight != null || _pausing) {
            return;
        }
        var next = null;
        for (var i = 0; i < _queue.size(); i++) {
            if (!_queue[i].waiting) {
                next = _queue[i];
                break;
            }
        }
        if (next == null) {
            return;
        }
        var request = next as ApiRequest;
        _inFlight = request;
        _ticket++;
        _scheduler.schedule(RetryPolicy.REQUEST_TIMEOUT_MS, method(:onTimeout));
        _transport.send(_baseUrl + request.path, request, headersFor(request), self, _ticket);
    }

    hidden function finish(request as ApiRequest, code as Number, data as Dictionary or String or Null) as Void {
        _inFlight = null;
        var outcome = RetryPolicy.classify(code, data);
        if (outcome == RetryPolicy.OUTCOME_OK || outcome == RetryPolicy.OUTCOME_FAIL) {
            _queue.remove(request);
            request.callback.invoke(code, data, outcome == RetryPolicy.OUTCOME_OK ? DONE_OK : DONE_FAILED);
            pump();
            return;
        }
        var delayS = RetryPolicy.OFFLINE_DELAY_S as Number or Null;
        if (outcome == RetryPolicy.OUTCOME_RETRY) {
            request.failures++;
            delayS = RetryPolicy.delayAfter(request.failures);
        }
        if (delayS == null) {
            request.waiting = true;
            request.callback.invoke(code, data, WAITING);
            pump();
            return;
        }
        _pausing = true;
        _scheduler.schedule((delayS as Number) * 1000, method(:onPauseOver));
    }

    hidden function headersFor(request as ApiRequest) as Dictionary<String, String> {
        var headers = {
            "X-Arnold-Watch" => _clientHeader,
            "Accept-Language" => _language
        } as Dictionary<String, String>;
        if (request.body != null) {
            headers["Content-Type"] = Communications.REQUEST_CONTENT_TYPE_JSON as String;
        }
        if (_token != null) {
            headers["Authorization"] = "Bearer " + (_token as String);
        }
        if (request.etag != null) {
            headers["If-None-Match"] = request.etag as String;
        }
        return headers;
    }
}
