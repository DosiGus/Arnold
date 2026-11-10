import Toybox.Lang;
import Toybox.WatchUi;

// Buttons of the pairing screen: START connects (or opens the menu when
// connected), BACK cancels a running pairing, MENU opens the account menu.
class PairingDelegate extends WatchUi.BehaviorDelegate {
    private var _controller as PairingController;

    function initialize(controller as PairingController) {
        BehaviorDelegate.initialize();
        _controller = controller;
    }

    function onSelect() as Boolean {
        if (_controller.state == PairingController.STATE_UNPAIRED) {
            _controller.start();
        } else if (_controller.state == PairingController.STATE_READY) {
            openMenu();
        }
        return true;
    }

    function onMenu() as Boolean {
        if (_controller.state == PairingController.STATE_READY) {
            openMenu();
        }
        return true;
    }

    // BACK ends a running pairing and stays in the app; otherwise the app closes.
    function onBack() as Boolean {
        if (_controller.state == PairingController.STATE_PAIRING) {
            _controller.cancel();
            return true;
        }
        return false;
    }

    hidden function openMenu() as Void {
        if (_controller.isSigningOut()) {
            return;
        }
        var sender = outboxSender();
        var pending = sender == null ? 0 : (sender as OutboxSender).pendingCount();
        WatchUi.pushView(PairingAccountMenu.build(pending), new PairingAccountDelegate(_controller, sender), WatchUi.SLIDE_LEFT);
    }

    // The outbox, when the screen has one (the start screen does).
    function outboxSender() as OutboxSender or Null {
        return null;
    }
}

// Account menu: sign out of Arnold.
module PairingAccountMenu {
    function build(pending as Number) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.AppName) as String });
        if (pending > 0) {
            menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.MenuSendNow) as String, null, :sendNow, null));
        }
        menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.MenuSettings) as String, null, :settings, null));
        menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.MenuSignOut) as String, null, :signOut, null));
        return menu;
    }
}

class PairingAccountDelegate extends WatchUi.Menu2InputDelegate {
    private var _controller as PairingController;
    private var _sender as OutboxSender or Null;

    function initialize(controller as PairingController, sender as OutboxSender or Null) {
        Menu2InputDelegate.initialize();
        _controller = controller;
        _sender = sender;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        if (item.getId() == :sendNow) {
            if (_sender != null) {
                (_sender as OutboxSender).sendNow();
            }
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (item.getId() == :settings) {
            SettingsMenu.open(new Settings(new KeyValueStore()));
        } else if (item.getId() == :signOut) {
            WatchUi.pushView(
                new WatchUi.Confirmation(WatchUi.loadResource(Rez.Strings.SignOutConfirm) as String),
                new SignOutConfirmDelegate(_controller),
                WatchUi.SLIDE_UP
            );
        }
    }
}

class SignOutConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _controller as PairingController;

    function initialize(controller as PairingController) {
        ConfirmationDelegate.initialize();
        _controller = controller;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _controller.signOut();
            // The confirmation closes itself; this also closes the menu below it.
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        }
        return true;
    }
}
