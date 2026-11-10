import Toybox.Lang;

// Source of "now" for the pairing countdown. Tests replace it with a manual clock.
class PairingClock {

    function initialize() {
    }

    function nowSeconds() as Number {
        return Clock.nowUtcSeconds();
    }
}
