import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// What START on a mobility row opens for now (MOB-008): a plain preview with the name, the minutes and
// the exercises with sides and seconds. The player follows in MOB-009. UP and DOWN scroll, BACK goes back.
// An entry without a loaded routine says so instead of showing an empty list.
module MobilityPreviewScreen {

    function text(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }

    // "85 s" for one side, "2×50 s" for two (seconds are per side).
    function exerciseTime(exercise as Dictionary) as String {
        var seconds = exercise["t"] as Number;
        if ((exercise["s"] as Number) == 2) {
            return Lang.format(text(Rez.Strings.MobSecondsSides), [seconds]);
        }
        return Lang.format(text(Rez.Strings.MobSeconds), [seconds]);
    }

    function lines(cache as MobilityCache, id as String) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var entry = cache.item(id);
        if (entry == null) {
            out.add(new PairingLine(text(Rez.Strings.HomeDayNotLoaded), Graphics.FONT_SMALL, Instrument.WARN));
            return out;
        }
        out.add(new PairingLine((entry as Dictionary)["n"] as String, Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(text(Rez.Strings.HomeMinutes), [(entry as Dictionary)["m"] as Number]), Graphics.FONT_XTINY, Instrument.LABEL));
        var routine = cache.routine(id);
        if (routine == null) {
            out.add(new PairingLine(text(Rez.Strings.HomeDayNotLoaded), Graphics.FONT_XTINY, Instrument.WARN));
            return out;
        }
        var all = (routine as Dictionary)["ex"] as Array;
        for (var i = 0; i < all.size(); i++) {
            var exercise = all[i] as Dictionary;
            out.add(new PairingLine((exercise["n"] as String) + " · " + exerciseTime(exercise), Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
        }
        return out;
    }
}

class MobilityPreviewView extends WatchUi.View {
    private var _cache as MobilityCache;
    private var _id as String;
    private var _first as Number;

    function initialize(cache as MobilityCache, id as String) {
        View.initialize();
        _cache = cache;
        _id = id;
        _first = 0;
    }

    function scroll(delta as Number) as Void {
        _first += delta;
        if (_first < 0) {
            _first = 0;
        }
    }

    function onUpdate(dc as Dc) as Void {
        _first = PairingLayout.drawFrom(dc, MobilityPreviewScreen.lines(_cache, _id), _first);
    }
}

class MobilityPreviewDelegate extends WatchUi.BehaviorDelegate {
    private var _view as MobilityPreviewView;

    function initialize(view as MobilityPreviewView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage() as Boolean {
        _view.scroll(1);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.scroll(-1);
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

// The short choice of all entries of the plan (row "Mobility"): a Menu2, START on an entry opens its preview.
module MobilityPick {

    function build(cache as MobilityCache) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => MobilityPreviewScreen.text(Rez.Strings.HomeMobPick) });
        var all = cache.items();
        for (var i = 0; i < all.size(); i++) {
            var entry = all[i] as Dictionary;
            var minutes = Lang.format(MobilityPreviewScreen.text(Rez.Strings.HomeMinutes), [entry["m"] as Number]);
            menu.addItem(new WatchUi.MenuItem(entry["n"] as String, minutes, entry["id"] as String, null));
        }
        return menu;
    }
}

class MobilityPickDelegate extends WatchUi.Menu2InputDelegate {
    private var _opener as MobilityOpener;
    private var _cache as MobilityCache;

    function initialize(opener as MobilityOpener, cache as MobilityCache) {
        Menu2InputDelegate.initialize();
        _opener = opener;
        _cache = cache;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        _opener.preview(_cache, item.getId() as String);
    }
}

// Opens the mobility screens; tests record the calls instead (like PreStartLauncher).
class MobilityOpener {

    function initialize() {
    }

    function preview(cache as MobilityCache, id as String) as Void {
        var view = new MobilityPreviewView(cache, id);
        WatchUi.pushView(view, new MobilityPreviewDelegate(view), WatchUi.SLIDE_LEFT);
    }

    function pick(cache as MobilityCache) as Void {
        WatchUi.pushView(MobilityPick.build(cache), new MobilityPickDelegate(self, cache), WatchUi.SLIDE_LEFT);
    }
}
