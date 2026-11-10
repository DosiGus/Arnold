import Toybox.Application;
import Toybox.Lang;

// Reads and writes the watch token. The token lives only under the storage key
// "auth" (07 D-07): never in another key, never in a log line.
class AuthStore {
    private var _store as KeyValueStore;

    function initialize(store as KeyValueStore) {
        _store = store;
    }

    // Null when nothing is stored or the entry is unreadable (fail closed: the
    // watch then asks to connect again instead of sending a broken token).
    function load() as Credentials or Null {
        var raw = _store.getValue(StoreKeys.AUTH);
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var entry = raw as Dictionary;
        var token = entry["token"];
        var deviceId = entry["device_id"];
        var label = entry["account_label"];
        if (!(token instanceof String) || !AuthStore.isWatchToken(token as String)) {
            return null;
        }
        if (!(deviceId instanceof String)) {
            return null;
        }
        return new Credentials(token as String, deviceId as String, label instanceof String ? label as String : "");
    }

    function save(credentials as Credentials) as Void {
        var entry = {
            "token" => credentials.token,
            "device_id" => credentials.deviceId,
            "account_label" => credentials.accountLabel
        };
        _store.setValue(StoreKeys.AUTH, entry as Application.Storage.ValueType);
    }

    function clear() as Void {
        _store.deleteValue(StoreKeys.AUTH);
    }

    // Watch tokens start with arn_w_ (07 D-07); anything else is not accepted.
    static function isWatchToken(text as String) as Boolean {
        return text.length() > 6 && text.find("arn_w_") == 0;
    }
}
