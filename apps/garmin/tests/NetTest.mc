import Toybox.Communications;
import Toybox.Lang;
import Toybox.Test;

(:test)
function retryPausesAre5s30s2minThenWait(logger as Logger) as Boolean {
    Expect.equal(RetryPolicy.delayAfter(1), 5);
    Expect.equal(RetryPolicy.delayAfter(2), 30);
    Expect.equal(RetryPolicy.delayAfter(3), 120);
    Test.assert(RetryPolicy.delayAfter(4) == null);
    return true;
}

(:test)
function retryClassifiesAnswers(logger as Logger) as Boolean {
    var pending = { "error" => { "code" => "WORKOUT_PENDING", "retryable" => true } };
    var duplicate = { "error" => { "code" => "DUPLICATE_WORKOUT", "retryable" => false } };
    Expect.equal(RetryPolicy.classify(200, null), RetryPolicy.OUTCOME_OK);
    Expect.equal(RetryPolicy.classify(204, null), RetryPolicy.OUTCOME_OK);
    Expect.equal(RetryPolicy.classify(304, null), RetryPolicy.OUTCOME_OK);
    Expect.equal(RetryPolicy.classify(-104, null), RetryPolicy.OUTCOME_OFFLINE);
    Expect.equal(RetryPolicy.classify(-2, null), RetryPolicy.OUTCOME_RETRY);
    Expect.equal(RetryPolicy.classify(-300, null), RetryPolicy.OUTCOME_RETRY);
    Expect.equal(RetryPolicy.classify(-402, null), RetryPolicy.OUTCOME_FAIL);
    Expect.equal(RetryPolicy.classify(-403, null), RetryPolicy.OUTCOME_FAIL);
    Expect.equal(RetryPolicy.classify(-1001, null), RetryPolicy.OUTCOME_FAIL);
    Expect.equal(RetryPolicy.classify(-201, null), RetryPolicy.OUTCOME_FAIL);
    Expect.equal(RetryPolicy.classify(-400, null), RetryPolicy.OUTCOME_RETRY);
    Expect.equal(RetryPolicy.classify(429, null), RetryPolicy.OUTCOME_RETRY);
    Expect.equal(RetryPolicy.classify(503, null), RetryPolicy.OUTCOME_RETRY);
    Expect.equal(RetryPolicy.classify(401, null), RetryPolicy.OUTCOME_FAIL);
    Expect.equal(RetryPolicy.classify(409, pending), RetryPolicy.OUTCOME_RETRY);
    Expect.equal(RetryPolicy.classify(409, duplicate), RetryPolicy.OUTCOME_FAIL);
    Expect.equal(RetryPolicy.classify(422, "not json"), RetryPolicy.OUTCOME_FAIL);
    return true;
}

(:test)
function apiSendsOneRequestAtATime(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock/api/watch/v1", transport, new FakeScheduler());
    var calls = new CallRecorder();
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, calls.method(:onDone)));
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan/recent", null, calls.method(:onDone)));
    Expect.equal(transport.sentCount(), 1);
    Expect.equal(transport.urls[0], "http://mock/api/watch/v1/plan");
    transport.respond(200, { "ok" => true });
    Expect.equal(calls.count(), 1);
    Expect.equal(calls.outcomes[0], ApiClient.DONE_OK);
    Expect.equal(transport.sentCount(), 2);
    Expect.equal(transport.urls[1], "http://mock/api/watch/v1/plan/recent");
    transport.respond(304, null);
    Expect.equal(calls.count(), 2);
    Expect.equal(client.pendingCount(), 0);
    return true;
}

(:test)
function apiSetsHeaders(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock", transport, new FakeScheduler());
    var calls = new CallRecorder();
    client.setToken("arn_w_test");
    client.setClientInfo("006-B3992-00", "de");
    var get = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, calls.method(:onDone));
    get.etag = "\"abc\"";
    client.enqueue(get);
    var h = transport.headers[0];
    Expect.equal(h["Authorization"], "Bearer arn_w_test");
    Expect.equal(h["X-Arnold-Watch"], AppInfo.VERSION + "/006-B3992-00");
    Expect.equal(h["Accept-Language"], "de");
    Expect.equal(h["If-None-Match"], "\"abc\"");
    Test.assert(!h.hasKey("Content-Type"));
    transport.respond(200, null);
    client.setToken(null);
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/pair/start", { "a" => 1 }, calls.method(:onDone)));
    h = transport.headers[1];
    Test.assert(!h.hasKey("Authorization"));
    Test.assert(h.hasKey("Content-Type"));
    return true;
}

(:test)
function apiBacksOffThenWaitsForNextOccasion(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var scheduler = new FakeScheduler();
    var client = new ApiClient("http://mock", transport, scheduler);
    var calls = new CallRecorder();
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/workouts", { "request_id" => "r1" }, calls.method(:onDone)));
    var expected = [5000, 30000, 120000];
    for (var i = 0; i < 3; i++) {
        transport.respond(503, null);
        Expect.equal(scheduler.pendingDelayMs, expected[i]);
        Expect.equal(transport.sentCount(), i + 1);
        scheduler.fire();
        Expect.equal(transport.sentCount(), i + 2);
    }
    transport.respond(503, null);
    Expect.equal(calls.count(), 1);
    Expect.equal(calls.outcomes[0], ApiClient.WAITING);
    Expect.equal(client.pendingCount(), 1);
    Test.assert(scheduler.pendingDelayMs == null);
    Test.assert(!client.isBusy());
    client.kick();
    Expect.equal(transport.sentCount(), 5);
    Test.assert(transport.requests[4] == transport.requests[0]);
    transport.respond(200, null);
    Expect.equal(calls.outcomes[1], ApiClient.DONE_OK);
    Expect.equal(client.pendingCount(), 0);
    return true;
}

(:test)
function apiNoPhoneDoesNotCountAsTry(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var scheduler = new FakeScheduler();
    var client = new ApiClient("http://mock", transport, scheduler);
    var calls = new CallRecorder();
    var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, calls.method(:onDone));
    client.enqueue(request);
    for (var i = 0; i < 5; i++) {
        transport.respond(-104, null);
        Expect.equal(scheduler.pendingDelayMs, 30000);
        Expect.equal(request.failures, 0);
        scheduler.fire();
    }
    transport.respond(-2, null);
    Expect.equal(request.failures, 1);
    Expect.equal(scheduler.pendingDelayMs, 5000);
    Expect.equal(calls.count(), 0);
    return true;
}

(:test)
function apiTimeoutCountsAndIgnoresLateAnswer(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var scheduler = new FakeScheduler();
    var client = new ApiClient("http://mock", transport, scheduler);
    var calls = new CallRecorder();
    var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, calls.method(:onDone));
    client.enqueue(request);
    Expect.equal(scheduler.pendingDelayMs, RetryPolicy.REQUEST_TIMEOUT_MS);
    var oldTicket = transport.lastTicket;
    scheduler.fire();
    Expect.equal(transport.cancels, 1);
    Expect.equal(request.failures, 1);
    Expect.equal(scheduler.pendingDelayMs, 5000);
    client.onResponse(oldTicket, 200, null);
    Expect.equal(calls.count(), 0);
    scheduler.fire();
    Expect.equal(transport.sentCount(), 2);
    transport.respond(200, null);
    Expect.equal(calls.count(), 1);
    return true;
}

(:test)
function apiPermanentErrorEndsRequest(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var scheduler = new FakeScheduler();
    var client = new ApiClient("http://mock", transport, scheduler);
    var calls = new CallRecorder();
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, calls.method(:onDone)));
    client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/device", null, calls.method(:onDone)));
    transport.respond(401, { "error" => { "code" => "AUTH_REQUIRED", "retryable" => false } });
    Expect.equal(calls.outcomes[0], ApiClient.DONE_FAILED);
    Expect.equal(calls.codes[0], 401);
    Expect.equal(transport.sentCount(), 2);
    transport.respond(409, { "error" => { "code" => "WORKOUT_PENDING", "retryable" => true } });
    Expect.equal(calls.count(), 1);
    Expect.equal(scheduler.pendingDelayMs, 5000);
    return true;
}

(:test)
function apiDropRemovesAQueuedRequest(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock", transport, new FakeScheduler());
    var calls = new CallRecorder();
    var first = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/a", null, calls.method(:onDone));
    var second = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/b", null, calls.method(:onDone));
    client.enqueue(first);
    client.enqueue(second);
    client.drop(second);
    Expect.equal(client.pendingCount(), 1);
    transport.respond(200, null);
    Expect.equal(calls.count(), 1);
    Expect.equal(transport.sentCount(), 1);   // /b was never sent
    return true;
}

(:test)
function apiDropLetsARequestOnItsWayFinishQuietly(logger as Logger) as Boolean {
    var transport = new FakeTransport();
    var scheduler = new FakeScheduler();
    var client = new ApiClient("http://mock", transport, scheduler);
    var calls = new CallRecorder();
    var request = new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/a", null, calls.method(:onDone));
    client.enqueue(request);
    client.drop(request);
    transport.respond(503, null);             // would normally be tried again
    Expect.equal(calls.count(), 0);
    Expect.equal(client.pendingCount(), 0);
    Expect.equal(transport.sentCount(), 1);
    Test.assert(scheduler.pendingCallback == null);
    return true;
}
