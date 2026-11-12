import Toybox.Lang;
import Toybox.WatchUi;

// Settings on the watch (GAR-B3-08): vibration, tone and the warning before the end of a
// rest, each on or off. A switch is saved the moment it is pressed.
module SettingsMenu {
    function build(settings as Settings) as WatchUi.Menu2 {
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.MenuSettings) as String });
        var labels = { :on => WatchUi.loadResource(Rez.Strings.SetOn) as String, :off => WatchUi.loadResource(Rez.Strings.SetOff) as String };
        menu.addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.SetVibration) as String, { :enabled => labels[:on], :disabled => labels[:off] }, Settings.VIBRATION, settings.isOn(Settings.VIBRATION), null));
        menu.addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.SetTone) as String, { :enabled => labels[:on], :disabled => labels[:off] }, Settings.TONE, settings.isOn(Settings.TONE), null));
        menu.addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.SetWarning) as String, { :enabled => labels[:on], :disabled => labels[:off] }, Settings.WARNING, settings.isOn(Settings.WARNING), null));
        return menu;
    }

    function open(settings as Settings) as Void {
        WatchUi.pushView(build(settings), new SettingsDelegate(settings), WatchUi.SLIDE_LEFT);
    }
}

class SettingsDelegate extends WatchUi.Menu2InputDelegate {
    private var _settings as Settings;

    function initialize(settings as Settings) {
        Menu2InputDelegate.initialize();
        _settings = settings;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        if (item instanceof WatchUi.ToggleMenuItem) {
            _settings.set(item.getId() as String, (item as WatchUi.ToggleMenuItem).isEnabled());
        }
    }

    function onBack() as Void {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
