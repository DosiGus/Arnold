import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// What START on a mobility row opens (MOB-008): the overview before the start, with the name, the minutes and
// the exercises with sides and seconds. START begins the routine in the player (MOB-009). UP and DOWN scroll,
// BACK goes back. An entry without a loaded routine says so instead of showing an empty list.
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
        out.add(new PairingLine(text(Rez.Strings.MobStart), Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
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
    private var _opener as MobilityOpener;
    private var _cache as MobilityCache;
    private var _id as String;

    function initialize(view as MobilityPreviewView, opener as MobilityOpener, cache as MobilityCache, id as String) {
        BehaviorDelegate.initialize();
        _view = view;
        _opener = opener;
        _cache = cache;
        _id = id;
    }

    // START: the routine begins in the player (nothing happens while the routine is not loaded).
    function onSelect() as Boolean {
        _opener.play(_cache, _id);
        return true;
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
        WatchUi.pushView(view, new MobilityPreviewDelegate(view, self, cache, id), WatchUi.SLIDE_LEFT);
    }

    // The player (MOB-009): the preview stays below it, BACK on the summary returns to it.
    function play(cache as MobilityCache, id as String) as Void {
        var entry = cache.item(id);
        var routine = cache.routine(id);
        if (entry == null || routine == null) {
            return;
        }
        var store = new KeyValueStore();
        var kind = "m".equals((entry as Dictionary)["k"] as String) ? "morning" : "session";
        var recorder = new Recorder(Uuid.v4(), new MobilityBackend());
        var signals = new MobilitySignals(new Signals(store), new Settings(store));
        var player = new MobilityPlayer(id, kind, routine as Dictionary, new PairingClock(), signals, recorder);
        player.begin();
        WatchUi.pushView(new MobilityView(player), new MobilityDelegate(player, store), WatchUi.SLIDE_LEFT);
    }

    function pick(cache as MobilityCache) as Void {
        WatchUi.pushView(MobilityPick.build(cache), new MobilityPickDelegate(self, cache), WatchUi.SLIDE_LEFT);
    }
}
