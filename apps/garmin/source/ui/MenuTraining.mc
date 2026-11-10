import Toybox.Lang;
import Toybox.WatchUi;

// The workout menu (UP held, UMSETZUNG 7.4): what can be done to the workout in progress.
module TrainingMenu {

    function build(session as TrainingSession) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.MenuTitle) as String });
        if (session.canSkipExercise()) {
            menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuSkip), null, :skip, null));
        }
        menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuEnd), null, :end, null));
        menu.addItem(new WatchUi.MenuItem(TrainingText.text(Rez.Strings.MenuDiscard), null, :discard, null));
        return menu;
    }

    function open(session as TrainingSession) as Void {
        WatchUi.pushView(build(session), new TrainingMenuDelegate(session), WatchUi.SLIDE_LEFT);
    }
}

class TrainingMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        Menu2InputDelegate.initialize();
        _session = session;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :skip) {
            _session.skipExercise();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :end) {
            // Nothing trained yet: there is nothing to save, so ending means discarding.
            if (_session.setsDone() == 0) {
                discard();
            } else {
                WatchUi.pushView(
                    new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptEnd)),
                    new EndConfirmDelegate(_session),
                    WatchUi.SLIDE_UP
                );
            }
        } else if (id == :discard) {
            discard();
        }
    }

    hidden function discard() as Void {
        WatchUi.pushView(
            new WatchUi.Confirmation(TrainingText.text(Rez.Strings.PromptDiscard)),
            new DiscardConfirmDelegate(_session, 1, 1),
            WatchUi.SLIDE_UP
        );
    }
}

// "End workout?" yes: the summary of what was done.
class EndConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        ConfirmationDelegate.initialize();
        _session = session;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _session.finishEarly();
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);   // closes the menu below
        }
        return true;
    }
}
