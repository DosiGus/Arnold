import Toybox.Communications;
import Toybox.Lang;

// Receives the final result of a request: code is the HTTP status or a negative
// Connect IQ error, outcome is ApiClient.DONE_OK, DONE_FAILED or WAITING.
typedef ApiCallback as Method(code as Number, data as Dictionary or String or Null, outcome as Number) as Void;

// One call to the Arnold watch API.
(:background)
class ApiRequest {
    var method as Communications.HttpRequestMethod;
    var path as String;                  // e.g. "/plan", appended to the base URL
    var body as Dictionary or Null;      // JSON body for POST and PUT
    var etag as String or Null;          // sent as If-None-Match
    var callback as ApiCallback;
    var failures as Number = 0;          // counted failures (not -104)
    var waiting as Boolean = false;      // gave up for now, sent at the next occasion
    var dropped as Boolean = false;      // the caller no longer wants it (ApiClient.drop)

    function initialize(
        httpMethod as Communications.HttpRequestMethod,
        requestPath as String,
        requestBody as Dictionary or Null,
        onDone as ApiCallback
    ) {
        method = httpMethod;
        path = requestPath;
        body = requestBody;
        etag = null;
        callback = onDone;
    }
}
