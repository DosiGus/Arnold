import Toybox.Lang;
import Toybox.WatchUi;

// Buttons of the start screen. Not connected: as the pairing screen. Connected:
// UP and DOWN choose a row (the training, a run planned today, free run, zone 2);
// START opens it: the training from the stored copy (or loads the plan again when it
// is missing or failed), a run on the pre-start screen. A workout in progress is
// continued by START. MENU opens the account menu.
class HomeDelegate extends PairingDelegate {
    private var _controller as PairingController;
    private var _sync as PlanSync;
    private var _picker as SessionPicker;
    private var _launcher as TrainingLauncher;
    private var _run as RunHome;

    function initialize(controller as PairingController, sync as PlanSync, picker as SessionPicker, launcher as TrainingLauncher, run as RunHome) {
        PairingDelegate.initialize(controller);
        _controller = controller;
        _sync = sync;
        _picker = picker;
        _launcher = launcher;
        _run = run;
    }

    function onSelect() as Boolean {
        if (!_controller.isPaired()) {
            return PairingDelegate.onSelect();
        }
        if (_launcher.activeName() == null) {
            var rows = _run.stops(_sync, _picker);
            var stop = _run.selectedStop(rows, _sync);
            if (stop.kind != HomeStop.STOP_STRENGTH) {
                startRun(stop);
                return true;
            }
        }
        var dir = _sync.cache.directory();
        var day = _picker.selectedDay(dir);
        var body = day == null ? null : _sync.cache.day((day as Dictionary)["id"] as String);
        // A workout in progress is continued; otherwise the selected day starts, from the stored copy.
        if (_launcher.begin(body)) {
            return true;
        }
        if (_sync.state == PlanSync.SYNC_FAILED || dir == null || body == null) {
            _sync.start();
        }
        return true;
    }

    // A free run opens the pre-start screen at once; a planned run from its stored
    // prescription (without it the runs are loaded again).
    hidden function startRun(stop as HomeStop) as Void {
        if (stop.kind == HomeStop.STOP_MOBILITY || stop.kind == HomeStop.STOP_MOBILITY_PICK) {
            startMobility(stop);
        } else if (stop.kind == HomeStop.STOP_RUN_RESUME) {
            _run.opener().resume();
        } else if (stop.kind == HomeStop.STOP_FREE) {
            _run.opener().open(new PreStartRequest(PreStartRequest.MODE_FREE, "", null).with(null, _run.sync.cache.healthConsent()));
        } else if (stop.kind == HomeStop.STOP_ZONE2) {
            _run.opener().open(new PreStartRequest(PreStartRequest.MODE_ZONE2, "", null).with(null, _run.sync.cache.healthConsent()));
        } else {
            var body = _run.sync.cache.prescription(stop.id);
            if (body != null) {
                var entry = _run.sync.cache.entry(stop.id);
                var minutes = entry == null ? null : (entry as Dictionary)["m"] as Object or Null;
                _run.opener().open(new PreStartRequest(PreStartRequest.MODE_PLANNED, stop.id, body).with(minutes instanceof Number ? minutes as Number : null, _run.sync.cache.healthConsent()));
            } else {
                _run.sync.start();
            }
        }
    }

    // MOB-008: a mobility row opens the preview of its routine (the player follows in MOB-009), the row
    // "Mobility" the short choice of all entries.
    hidden function startMobility(stop as HomeStop) as Void {
        var loader = _run.mobility;
        if (loader == null) {
            return;
        }
        var cache = (loader as MobilitySync).cache;
        if (stop.kind == HomeStop.STOP_MOBILITY_PICK) {
            _run.mobilityOpener.pick(cache);
        } else {
            _run.mobilityOpener.preview(cache, stop.id);
        }
    }

    function outboxSender() as OutboxSender or Null {
        return _launcher.sender();
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
        if (_launcher.activeName() != null) {
            return true;
        }
        _run.move(_run.stops(_sync, _picker), _sync, delta);
        WatchUi.requestUpdate();
        return true;
    }
}
