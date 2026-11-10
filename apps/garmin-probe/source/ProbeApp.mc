import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Measurement app for the device matrix (08). Not shipped. Every result is printed
// with System.println: on the watch that lands in GARMIN/APPS/LOGS/<app>.TXT when
// the file exists, so results can be read over USB.
(:background)
class ProbeApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getServiceDelegate() as [System.ServiceDelegate] {
        return [new ProbeService()];
    }

    (:typecheck(disableBackgroundCheck))
    function onStart(state as Dictionary?) as Void {
        StorageProbe.checkOnStart();
    }

    (:typecheck(disableBackgroundCheck))
    function onBackgroundData(data as Application.PersistableType) as Void {
        BackgroundProbe.onResult(data);
    }

    (:typecheck(disableBackgroundCheck))
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [ProbeMenu.build(), new ProbeMenuDelegate()];
    }
}
