import Toybox.Lang;
import Toybox.Test;
import Toybox.WatchUi;

// Writes down what the signals would have done.
(:test)
class ProbeSignals extends Signals {
    var vibrations as Number = 0;
    var tones as Number = 0;
    var outputs as Number = 0;

    function initialize(store as KeyValueStore or Null) {
        Signals.initialize(store);
    }

    function output(durationMs as Number, loud as Boolean, vibrate as Boolean, tone as Boolean) as Void {
        outputs++;
        if (vibrate) {
            vibrations++;
        }
        if (tone) {
            tones++;
        }
    }
}

(:test)
function settingsAreAllOnByDefault(logger as Logger) as Boolean {
    var settings = new Settings(new MemoryStore());
    Test.assert(settings.isOn(Settings.VIBRATION));
    Test.assert(settings.isOn(Settings.TONE));
    Test.assert(settings.isOn(Settings.WARNING));
    Test.assert(new Settings(null).isOn(Settings.TONE));
    return true;
}

(:test)
function settingsKeepEachSwitchOnItsOwn(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var settings = new Settings(store);
    settings.set(Settings.TONE, false);
    Test.assert(settings.isOn(Settings.VIBRATION));
    Test.assert(!settings.isOn(Settings.TONE));
    Test.assert(settings.isOn(Settings.WARNING));
    settings.set(Settings.WARNING, false);
    settings.set(Settings.TONE, true);
    Test.assert(settings.isOn(Settings.TONE));
    Test.assert(!settings.isOn(Settings.WARNING));
    Test.assert(new Settings(store).isOn(Settings.VIBRATION));   // read again from the storage
    Test.assert(!new Settings(store).isOn(Settings.WARNING));    // still off after a "restart"
    return true;
}

(:test)
function settingsIgnoreDamagedValues(logger as Logger) as Boolean {
    var store = new MemoryStore();
    store.setValue(StoreKeys.SETTINGS, "kaputt");
    var settings = new Settings(store);
    Test.assert(settings.isOn(Settings.VIBRATION));
    settings.set(Settings.TONE, false);                          // the damaged entry is replaced
    Test.assert(!settings.isOn(Settings.TONE));
    store.setValue(StoreKeys.SETTINGS, { "vib" => 0, "tone" => "no", "warn" => false });
    Test.assert(settings.isOn(Settings.VIBRATION));              // not a Boolean: stays on
    Test.assert(settings.isOn(Settings.TONE));
    Test.assert(!settings.isOn(Settings.WARNING));
    return true;
}

(:test)
function signalsFollowTheSwitchesOneByOne(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var signals = new ProbeSignals(store);
    signals.restOver();
    Test.assertEqual(1, signals.vibrations);
    Test.assertEqual(1, signals.tones);
    new Settings(store).set(Settings.VIBRATION, false);          // takes effect at once
    signals.restOver();
    Test.assertEqual(1, signals.vibrations);
    Test.assertEqual(2, signals.tones);
    new Settings(store).set(Settings.TONE, false);
    signals.restOver();
    Test.assertEqual(1, signals.vibrations);
    Test.assertEqual(2, signals.tones);
    Test.assertEqual(3, signals.outputs);                        // the call still happens, with both off
    return true;
}

(:test)
function signalsWarningHasItsOwnSwitch(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var signals = new ProbeSignals(store);
    signals.warn();
    Test.assertEqual(1, signals.outputs);
    new Settings(store).set(Settings.WARNING, false);
    signals.warn();
    Test.assertEqual(1, signals.outputs);                        // warning gone
    signals.restOver();
    Test.assertEqual(2, signals.outputs);                        // end of rest still signals
    new Settings(store).set(Settings.WARNING, true);
    new Settings(store).set(Settings.VIBRATION, false);
    signals.warn();
    Test.assertEqual(3, signals.outputs);
    Test.assertEqual(2, signals.vibrations);                     // warn + first end: not the third
    return true;
}

(:test)
function settingsMenuShowsTheStoredSwitches(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var settings = new Settings(store);
    settings.set(Settings.TONE, false);
    var menu = SettingsMenu.build(settings);
    Test.assertEqual(0, menu.findItemById(Settings.VIBRATION));
    Test.assertEqual(1, menu.findItemById(Settings.TONE));
    Test.assertEqual(2, menu.findItemById(Settings.WARNING));
    Test.assert(menu.getItem(3) == null);
    var vib = menu.getItem(0) as WatchUi.ToggleMenuItem;
    var tone = menu.getItem(1) as WatchUi.ToggleMenuItem;
    var warn = menu.getItem(2) as WatchUi.ToggleMenuItem;
    Test.assert(vib.isEnabled());
    Test.assert(!tone.isEnabled());
    Test.assert(warn.isEnabled());
    return true;
}

(:test)
function settingsDelegateSavesAPressedSwitch(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var settings = new Settings(store);
    var menu = SettingsMenu.build(settings);
    var tone = menu.getItem(1) as WatchUi.ToggleMenuItem;
    tone.setEnabled(false);                                      // what the watch does on press
    new SettingsDelegate(settings).onSelect(tone);
    Test.assert(!new Settings(store).isOn(Settings.TONE));
    Test.assert(new Settings(store).isOn(Settings.VIBRATION));
    tone.setEnabled(true);
    new SettingsDelegate(settings).onSelect(tone);
    Test.assert(new Settings(store).isOn(Settings.TONE));
    return true;
}
