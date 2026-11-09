import Toybox.Background;
import Toybox.Lang;
import Toybox.System;

// Background entry point. Outbox upload and plan refresh come in GAR-B4-03.
(:background)
class BackgroundService extends System.ServiceDelegate {

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        Background.exit(null);
    }
}
