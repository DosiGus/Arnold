import Toybox.Application;
import Toybox.Lang;
import Toybox.Test;

// In-memory storage for tests.
(:test)
class MemoryStore extends KeyValueStore {
    var values as Dictionary<String, Application.Storage.ValueType>;

    function initialize() {
        KeyValueStore.initialize();
        values = {} as Dictionary<String, Application.Storage.ValueType>;
    }

    function getValue(key as String) as Application.Storage.ValueType {
        return values[key];
    }

    function setValue(key as String, value as Application.Storage.ValueType) as Void {
        values[key] = value;
    }

    function deleteValue(key as String) as Void {
        values.remove(key);
    }
}

// Fails a migration step on purpose.
(:test)
class StepFailed extends Lang.Exception {
    function initialize() {
        Exception.initialize();
    }
}

// Records which migration steps ran; can fail at a given step.
(:test)
class RecordingSteps extends SchemaSteps {
    var ran as Array<Number>;
    var failAt as Number;

    function initialize(failAtStep as Number) {
        SchemaSteps.initialize();
        ran = [] as Array<Number>;
        failAt = failAtStep;
    }

    function step(store as KeyValueStore, from as Number) as Void {
        if (from == failAt) {
            throw new StepFailed();
        }
        ran.add(from);
    }
}

// Manual clock with the same single timer slot as Scheduler.
(:test)
class FakeScheduler extends Scheduler {
    var pendingDelayMs as Number or Null;
    var pendingCallback as (Method() as Void) or Null;

    function initialize() {
        Scheduler.initialize();
        pendingDelayMs = null;
        pendingCallback = null;
    }

    function schedule(delayMs as Number, callback as Method() as Void) as Void {
        pendingDelayMs = delayMs;
        pendingCallback = callback;
    }

    function cancel() as Void {
        pendingDelayMs = null;
        pendingCallback = null;
    }

    // Lets the pending timer expire.
    function fire() as Void {
        var callback = pendingCallback;
        pendingDelayMs = null;
        pendingCallback = null;
        if (callback != null) {
            (callback as Method() as Void).invoke();
        }
    }
}

// Records requests and answers them on demand.
(:test)
class FakeTransport extends Transport {
    var urls as Array<String>;
    var requests as Array<ApiRequest>;
    var headers as Array<Dictionary<String, String>>;
    var cancels as Number;
    var lastTicket as Number;
    var client as ApiClient or Null;

    function initialize() {
        Transport.initialize();
        urls = [] as Array<String>;
        requests = [] as Array<ApiRequest>;
        headers = [] as Array<Dictionary<String, String>>;
        cancels = 0;
        lastTicket = -1;
        client = null;
    }

    function send(
        url as String,
        request as ApiRequest,
        requestHeaders as Dictionary<String, String>,
        apiClient as ApiClient,
        ticket as Number
    ) as Void {
        urls.add(url);
        requests.add(request);
        headers.add(requestHeaders);
        lastTicket = ticket;
        client = apiClient;
    }

    function cancel() as Void {
        cancels++;
    }

    function sentCount() as Number {
        return requests.size();
    }

    function respond(code as Number, data as Dictionary or String or Null) as Void {
        (client as ApiClient).onResponse(lastTicket, code, data);
    }
}

// Collects the final callbacks of requests.
(:test)
class CallRecorder {
    var codes as Array<Number>;
    var outcomes as Array<Number>;

    function initialize() {
        codes = [] as Array<Number>;
        outcomes = [] as Array<Number>;
    }

    function onDone(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        codes.add(code);
        outcomes.add(outcome);
    }

    function count() as Number {
        return codes.size();
    }
}

// assertEqual that also accepts null and names both values on failure.
(:test)
module Expect {
    function equal(actual as Object or Null, expected as Object or Null) as Void {
        var same = actual == null ? expected == null : (expected != null && actual.equals(expected));
        Test.assertMessage(same, "expected " + expected + ", got " + actual);
    }

    // The value of a dictionary field, typed so it can be compared.
    function valueOf(dict as Dictionary, key as String) as Object or Null {
        return dict[key] as Object or Null;
    }

    function field(dict as Dictionary, key as String, expected as Object or Null) as Void {
        equal(valueOf(dict, key), expected);
    }
}
