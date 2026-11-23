import Toybox.Lang;
import Toybox.WatchUi;

// Keys of the mobility player (MOB-009). START: pause and go on (on the summary: save). DOWN: leave the
// exercise out. BACK: end the routine, with a question (on the summary: discard, with a question).
// A question pauses the player; "no" goes on again unless the user had paused it already.
class MobilityDelegate extends WatchUi.BehaviorDelegate {
    private var _player as MobilityPlayer;
    private var _store as KeyValueStore;

    function initialize(player as MobilityPlayer, store as KeyValueStore) {
        BehaviorDelegate.initialize();
        _player = player;
        _store = store;
    }

    function onSelect() as Boolean {
        if (_player.phase != MobilityPlayer.PH_END) {
            _player.toggle();
        } else if (_player.isSaved()) {
            close();
        } else if (_player.save(_store)) {
            // saved: the summary says so, the next key leaves
        } else {
            _player.discard();
            close();
        }
        WatchUi.requestUpdate();
        return true;
    }

    function onNextPage() as Boolean {
        _player.skip();
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        return true;
    }

    function onBack() as Boolean {
        if (_player.phase != MobilityPlayer.PH_END) {
            var wasPaused = _player.isPaused();
            _player.pause();
            ask(Rez.Strings.MobPromptEnd, new MobilityEndAnswer(_player, wasPaused));
        } else if (_player.isSaved()) {
            close();
        } else {
            ask(Rez.Strings.MobPromptDiscard, new MobilityDiscardAnswer(_player, self));
        }
        return true;
    }

    function close() as Void {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }

    hidden function ask(message as ResourceId, answer as WatchUi.ConfirmationDelegate) as Void {
        WatchUi.pushView(new WatchUi.Confirmation(MobilityPreviewScreen.text(message)), answer, WatchUi.SLIDE_UP);
    }
}

// "End routine?"
class MobilityEndAnswer extends WatchUi.ConfirmationDelegate {
    private var _player as MobilityPlayer;
    private var _wasPaused as Boolean;

    function initialize(player as MobilityPlayer, wasPaused as Boolean) {
        ConfirmationDelegate.initialize();
        _player = player;
        _wasPaused = wasPaused;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _player.endEarly();
        } else if (!_wasPaused) {
            _player.resume();
        }
        WatchUi.requestUpdate();
        return true;
    }
}

// "Discard routine?" on the summary: the recording is thrown away. The screen closes a moment later, after the
// question has closed itself (see RunLater).
class MobilityDiscardAnswer extends WatchUi.ConfirmationDelegate {
    private var _player as MobilityPlayer;
    private var _delegate as MobilityDelegate;

    function initialize(player as MobilityPlayer, delegate as MobilityDelegate) {
        ConfirmationDelegate.initialize();
        _player = player;
        _delegate = delegate;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _player.discard();
            RunLater.call(_delegate.method(:close));
        }
        return true;
    }
}
