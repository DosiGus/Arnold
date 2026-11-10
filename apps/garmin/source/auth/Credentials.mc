import Toybox.Lang;

// What the watch keeps after pairing (UMSETZUNG 7.3, key "auth").
class Credentials {
    var token as String;
    var deviceId as String;
    var accountLabel as String;

    function initialize(watchToken as String, id as String, label as String) {
        token = watchToken;
        deviceId = id;
        accountLabel = label;
    }
}
