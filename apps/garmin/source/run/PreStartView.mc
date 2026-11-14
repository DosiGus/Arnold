import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Placeholder for the pre-start screen (RUN-025 replaces it): says which run was chosen.
// BACK returns to the start screen.
class PreStartView extends WatchUi.View {
    private var _request as PreStartRequest;

    function initialize(request as PreStartRequest) {
        View.initialize();
        _request = request;
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, PreStartScreen.lines(_request));
    }
}

class PreStartDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }
}

module PreStartScreen {
    function lines(request as PreStartRequest) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(HomeScreen.text(Rez.Strings.PreStartTitle), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        var name = HomeScreen.text(request.mode == PreStartRequest.MODE_ZONE2 ? Rez.Strings.HomeFreeZone2 : Rez.Strings.HomeFreeOpen);
        if (request.mode == PreStartRequest.MODE_PLANNED) {
            var p = request.prescription;
            name = p == null ? "" : (p as Dictionary)["n"] as String;
        }
        out.add(new PairingLine(name, Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
        return out;
    }
}
