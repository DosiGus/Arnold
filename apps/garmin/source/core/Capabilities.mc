import Toybox.Communications;
import Toybox.Lang;
import Toybox.SensorHistory;
import Toybox.System;

// What this device can do. Asked at run time, never assumed from the model name.
(:background)
module Capabilities {

    function canUseNetwork() as Boolean {
        return Toybox has :Communications && Communications has :makeWebRequest;
    }

    function hasBodyBatteryHistory() as Boolean {
        return Toybox has :SensorHistory && SensorHistory has :getBodyBatteryHistory;
    }

    function hasStressHistory() as Boolean {
        return Toybox has :SensorHistory && SensorHistory has :getStressHistory;
    }

    function hasHeartRateHistory() as Boolean {
        return Toybox has :SensorHistory && SensorHistory has :getHeartRateHistory;
    }

    // AMOLED screens need burn-in protection and get the dark theme.
    function isAmoled() as Boolean {
        var settings = System.getDeviceSettings();
        return settings has :requiresBurnInProtection && settings.requiresBurnInProtection;
    }

    // Shorter display side in pixels (all target devices are round).
    function screenSize() as Number {
        var settings = System.getDeviceSettings();
        var w = settings.screenWidth;
        var h = settings.screenHeight;
        return w < h ? w : h;
    }

    // Hardware part number, e.g. "006-B3992-00" for a Forerunner 255.
    function partNumber() as String {
        return System.getDeviceSettings().partNumber;
    }

    // Firmware version as shown in the watch menu, e.g. "29.05".
    function firmware() as String {
        var version = System.getDeviceSettings().firmwareVersion;
        if (version.size() < 2) {
            return "";
        }
        return (version[0] as Number).toString() + "." + (version[1] as Number).format("%02d");
    }

    // Language for server texts: German watches get "de", all others "en" (07 D-04).
    function languageCode() as String {
        return System.getDeviceSettings().systemLanguage == System.LANGUAGE_DEU ? "de" : "en";
    }
}
