import Toybox.Lang;
import Toybox.WatchUi;

// The sets of the exercise on screen (UP on a set): confirmed sets show their values and
// can be corrected, open sets can be given other values (PRD T-04).
module SetList {

    function build(session as TrainingSession) as WatchUi.Menu2 {
        var ex = session.exercise();
        var menu = new WatchUi.Menu2({ :title => ex.name });
        for (var i = 0; i < ex.sets.size(); i++) {
            var done = session.doneSet(i);
            var label = (i + 1).toString() + "  ";
            var status = Rez.Strings.ListOpen;
            if (done != null) {
                var d = done as Dictionary;
                label += TrainingText.repsAndLoad(new PlannedSet(d["r"] as Number, d["g"] instanceof Number ? d["g"] as Number : null, ex.sets[i].side));
                status = Rez.Strings.ListDone;
            } else {
                label += TrainingText.repsAndLoad(ex.sets[i]);
                if (session.state == TrainingSession.STATE_SET && i == session.setIdx) {
                    status = Rez.Strings.ListNow;
                }
            }
            var side = TrainingText.sideText(ex.sets[i].side);
            var sub = TrainingText.text(status) + (side == null ? "" : " · " + (side as String));
            menu.addItem(new WatchUi.MenuItem(label, sub, i, null));
        }
        return menu;
    }

    function open(session as TrainingSession) as Void {
        WatchUi.pushView(build(session), new SetListDelegate(session), WatchUi.SLIDE_LEFT);
    }
}

class SetListDelegate extends WatchUi.Menu2InputDelegate {
    private var _session as TrainingSession;

    function initialize(session as TrainingSession) {
        Menu2InputDelegate.initialize();
        _session = session;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var index = item.getId() as Number;
        // A set of the rest that is running cannot be changed before it is over, except confirmed ones.
        if (_session.state == TrainingSession.STATE_REST && index <= _session.setIdx && _session.doneSet(index) == null) {
            return;
        }
        EditLauncher.switchTo(_session, index);
    }
}
