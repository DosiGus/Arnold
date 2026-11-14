import Toybox.Lang;
import Toybox.Position;
import Toybox.System;
import Toybox.WatchUi;

// What the pre-start screen reads from the watch: the quality of the position, the heart rate,
// the battery. The real thing talks to Position and Sensor; tests replace the three readings.
class RunSensors {
    var quality as Number;      // Position.QUALITY_*, QUALITY_NOT_AVAILABLE until there is a fix
    var keep as Boolean;        // true while a question or the recording covers the screen: the sensors stay on
    private var _on as Boolean;
    private var _capability as GpsCapability;

    function initialize(capability as GpsCapability) {
        _capability = capability;
        quality = Position.QUALITY_NOT_AVAILABLE;
        keep = false;
        _on = false;
    }

    // Switches the position on (with the best satellite mode of the device) and the heart rate sensor.
    // Calling it again changes nothing.
    function start(useGps as Boolean) as Void {
        if (useGps) {
            if (!_on) {
                Position.enableLocationEvents(GpsMode.options(GpsMode.choose(_capability)), method(:onPosition));
                _on = true;
            }
        } else {
            stopGps();
        }
        LiveHeart.enable();
    }

    function stop() as Void {
        stopGps();
        LiveHeart.disable();
    }

    hidden function stopGps() as Void {
        if (_on) {
            Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
            _on = false;
        }
        quality = Position.QUALITY_NOT_AVAILABLE;
    }

    function onPosition(info as Position.Info) as Void {
        var value = info.accuracy;
        quality = value instanceof Number ? value as Number : Position.QUALITY_NOT_AVAILABLE;
        WatchUi.requestUpdate();
    }

    // Beats per minute, or null while the sensor has no reading.
    function heartRate() as Number or Null {
        return LiveHeart.fromSensor();
    }

    // Battery level in percent, 0 to 100.
    function batteryPercent() as Number {
        return System.getSystemStats().battery.toNumber();
    }
}
