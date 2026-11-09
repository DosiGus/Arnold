import Toybox.Communications;
import Toybox.Lang;

// Sends one request and reports the answer to the client with its ticket number.
// Tests replace it with a fake that answers on demand.
class Transport {

    function initialize() {
    }

    function send(
        url as String,
        request as ApiRequest,
        headers as Dictionary<String, String>,
        client as ApiClient,
        ticket as Number
    ) as Void {
        var options = {
            :method => request.method,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        var responder = new TransportResponder(client, ticket);
        Communications.makeWebRequest(url, request.body as Dictionary<Object, Object> or Null, options, responder.method(:onResponse));
    }

    // Stops the request in flight after a timeout.
    function cancel() as Void {
        Communications.cancelAllRequests();
    }
}

// Ties a makeWebRequest answer to the request it belongs to.
class TransportResponder {
    private var _client as ApiClient;
    private var _ticket as Number;

    function initialize(client as ApiClient, ticket as Number) {
        _client = client;
        _ticket = ticket;
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        _client.onResponse(_ticket, code, data);
    }
}
