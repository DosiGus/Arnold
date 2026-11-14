import Toybox.Lang;

// Source of "now" for the pairing countdown. Tests replace it with a manual clock.
class PairingClock {

    function initialize() {
    }

    function nowSeconds() as Number {
        return Clock.nowUtcSeconds();
    }

    // Offset of the watch's local time to UTC in minutes (counts the local calendar day).
    function utcOffsetMinutes() as Number {
        return Clock.utcOffsetMinutes();
    }
}
