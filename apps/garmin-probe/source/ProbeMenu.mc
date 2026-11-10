import Toybox.Lang;
import Toybox.WatchUi;

module ProbeMenu {
    function build() as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => "Arnold Mess" });
        menu.addItem(new WatchUi.MenuItem("Alles messen", "Zeilen 1, 3-10", :all, null));
        menu.addItem(new WatchUi.MenuItem("Schreibtest", "14 starten", :storage, null));
        menu.addItem(new WatchUi.MenuItem("Aufzeichnung", "13/19/20 starten", :recStart, null));
        menu.addItem(new WatchUi.MenuItem("Runde", "Satz beenden", :recLap, null));
        menu.addItem(new WatchUi.MenuItem("Speichern", "Aufzeichnung", :recSave, null));
        menu.addItem(new WatchUi.MenuItem("Absturz", "13 ausloesen", :recCrash, null));
        menu.addItem(new WatchUi.MenuItem("Groessen", "2: 2-32 KB", :net, null));
        menu.addItem(new WatchUi.MenuItem("Eine Anfrage", "16", :netOnce, null));
        menu.addItem(new WatchUi.MenuItem("Hintergrund", "15 in 5 min", :bg, null));
        menu.addItem(new WatchUi.MenuItem("Absturz Storage", "14 absichtlich", :storageCrash, null));
        menu.addItem(new WatchUi.MenuItem("Verwerfen", "Test-Aufzeichnung", :discard, null));
        menu.addItem(new WatchUi.MenuItem("BG Ergebnis", "15 anzeigen", :bgResult, null));
        menu.addItem(new WatchUi.MenuItem("Letztes Ergebnis", "UP/DOWN scrollt", :last, null));
        menu.addItem(new WatchUi.MenuItem("Signal", "12 Studio", :signal, null));
        menu.addItem(new WatchUi.MenuItem("Akku", "17 vor / nach", :battery, null));
        var ids = [1,3,4,5,6,7,8,9,10,21];
        for (var i = 0; i < ids.size(); i++) {
            var n = ids[i];
            menu.addItem(new WatchUi.MenuItem("Messung " + n, "Einzeln", n, null));
        }
        return menu;
    }
}

class ProbeMenuDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id instanceof Number) { Measurements.runOne(id); }
        else if (id == :signal) { StudioProbe.signal(); }
        else if (id == :battery) { StudioProbe.battery(); }
        else if (id == :storageCrash) { StorageProbe.crash(); }
        else if (id == :discard) { RecordingProbe.discard(); }
        else if (id == :bgResult) { BackgroundProbe.showResult(); }
        else if (id == :all) {
            Measurements.runAll();
        } else if (id == :storage) {
            StorageProbe.start();
        } else if (id == :recStart) {
            RecordingProbe.start();
        } else if (id == :recLap) {
            RecordingProbe.lap();
        } else if (id == :recSave) {
            RecordingProbe.save();
        } else if (id == :recCrash) {
            RecordingProbe.crash();
        } else if (id == :net) {
            NetProbe.sizes();
        } else if (id == :netOnce) {
            NetProbe.once();
        } else if (id == :bg) {
            BackgroundProbe.schedule();
        }
        WatchUi.pushView(new ResultView(), new ResultDelegate(), WatchUi.SLIDE_LEFT);
    }
}
