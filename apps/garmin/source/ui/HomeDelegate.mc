import Toybox.Lang;
import Toybox.WatchUi;

// Buttons of the start screen. Not connected: as the pairing screen. Connected:
// UP and DOWN choose the training day; START loads the plan again when it is
// missing or failed (the training itself starts here in a later task); MENU
// opens the account menu.
class HomeDelegate extends PairingDelegate {
    private var _controller as PairingController;
    private var _sync as PlanSync;
    private var _picker as SessionPicker;

    function initialize(controller as PairingController, sync as PlanSync, picker as SessionPicker) {
        PairingDelegate.initialize(controller);
        _controller = controller;
        _sync = sync;
        _picker = picker;
    }

    function onSelect() as Boolean {
        if (!_controller.isPaired()) {
            return PairingDelegate.onSelect();
        }
        var dir = _sync.cache.directory();
        var day = _picker.selectedDay(dir);
        if (_sync.state == PlanSync.SYNC_FAILED || dir == null || (day != null && _sync.cache.dayState(day as Dictionary) == PlanCache.DAY_MISSING)) {
            _sync.start();
        }
        return true;
    }

    function onNextPage() as Boolean {
        return move(1);
    }

    function onPreviousPage() as Boolean {
        return move(-1);
    }

    hidden function move(delta as Number) as Boolean {
        if (!_controller.isPaired()) {
            return false;
        }
        _picker.move(_sync.cache.directory(), delta);
        WatchUi.requestUpdate();
        return true;
    }
}
