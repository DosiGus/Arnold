import Toybox.Lang;

// When a failed request is tried again (UMSETZUNG 7.7): after 5 s, 30 s and 2 min,
// then only at the next occasion. "No phone" (-104) is not counted as a try.
(:background)
module RetryPolicy {

    enum Outcome {
        OUTCOME_OK,       // 2xx or 304
        OUTCOME_RETRY,    // temporary: try again after the next pause
        OUTCOME_OFFLINE,  // no phone connection: try again, not counted
        OUTCOME_FAIL      // permanent: retrying cannot help
    }

    const BLE_CONNECTION_UNAVAILABLE as Number = -104;
    const RESPONSE_TOO_LARGE as Number = -402;
    const RESPONSE_OUT_OF_MEMORY as Number = -403;
    const SECURE_CONNECTION_REQUIRED as Number = -1001;
    const INVALID_REQUEST_HEADERS as Number = -200;
    const INVALID_REQUEST_BODY as Number = -201;
    const INVALID_REQUEST_METHOD as Number = -202;
    const OFFLINE_DELAY_S as Number = 30;
    const REQUEST_TIMEOUT_MS as Number = 35000;  // a request without an answer counts as failed

    // Pause in seconds after the given number of counted failures, or null when
    // the request should wait for the next occasion.
    function delayAfter(failures as Number) as Number or Null {
        if (failures == 1) {
            return 5;
        }
        if (failures == 2) {
            return 30;
        }
        if (failures == 3) {
            return 120;
        }
        return null;
    }

    function classify(code as Number, data as Dictionary or String or Null) as Outcome {
        if ((code >= 200 && code < 300) || code == 304) {
            return OUTCOME_OK;
        }
        if (code == BLE_CONNECTION_UNAVAILABLE) {
            return OUTCOME_OFFLINE;
        }
        // Errors a retry cannot fix: answer too big, plain HTTP, broken request.
        if (code == RESPONSE_TOO_LARGE || code == RESPONSE_OUT_OF_MEMORY || code == SECURE_CONNECTION_REQUIRED
            || code == INVALID_REQUEST_HEADERS || code == INVALID_REQUEST_BODY || code == INVALID_REQUEST_METHOD) {
            return OUTCOME_FAIL;
        }
        if (code < 0 || code == 429 || code >= 500) {
            return OUTCOME_RETRY;
        }
        // 4xx: permanent unless the server marks the error as retryable
        // (e.g. 409 WORKOUT_PENDING).
        return isRetryableError(data) ? OUTCOME_RETRY : OUTCOME_FAIL;
    }

    function isRetryableError(data as Dictionary or String or Null) as Boolean {
        if (!(data instanceof Dictionary)) {
            return false;
        }
        var error = (data as Dictionary)["error"];
        if (!(error instanceof Dictionary)) {
            return false;
        }
        var flag = (error as Dictionary)["retryable"];
        if (flag instanceof Boolean) {
            return flag as Boolean;
        }
        return false;
    }
}
