import Toybox.Lang;

// The one connection of the app to Arnold: storage, API client and pairing,
// created the first time the screen needs them. The storage schema is checked
// first; data of a newer app version is left alone and pairing stays blocked.
module Session {
    var _client as ApiClient or Null = null;
    var _controller as PairingController or Null = null;
    var _plan as PlanSync or Null = null;

    function client() as ApiClient {
        if (_client == null) {
            var client = new ApiClient(AuthConfig.baseUrl(), new Transport(), new Scheduler());
            client.setClientInfo(Capabilities.partNumber(), Capabilities.languageCode());
            _client = client;
        }
        return _client as ApiClient;
    }

    function pairing() as PairingController {
        if (_controller == null) {
            var store = new KeyValueStore();
            var schema = StoreSchema.migrate(store);
            var blocked = schema == StoreSchema.RESULT_NEWER || schema == StoreSchema.RESULT_INVALID;
            var part = Capabilities.partNumber();
            _controller = new PairingController(
                client(), new AuthStore(store), new Scheduler(), new PairingClock(),
                DeviceNames.label(part), part, blocked
            );
        }
        return _controller as PairingController;
    }

    // The plan on the watch and its loader. Signing out (or connecting again)
    // wipes the stored plan, so no plan outlives the account it belongs to.
    function planSync() as PlanSync {
        if (_plan == null) {
            var cache = new PlanCache(new KeyValueStore());
            _plan = new PlanSync(client(), cache, new PairingClock(), pairing().method(:onAuthRejected));
            pairing().setWipeHook(cache.method(:clear));
        }
        return _plan as PlanSync;
    }
}
