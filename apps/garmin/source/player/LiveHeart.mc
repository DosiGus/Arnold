import Toybox.Lang;
import Toybox.Sensor;

// Live heart rate for the set and rest screens (PRD T-08). Only for display here;
// the recording (GAR-B4-01) and the health values (GAR-B4-02) do their own reading.
module LiveHeart {

    function available() as Boolean {
        return Toybox has :Sensor && Sensor has :getInfo && Sensor has :setEnabledSensors;
    }

    function enable() as Void {
        if (available()) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE] as Array<Sensor.SensorType>);
        }
    }

    function disable() as Void {
        if (available()) {
            Sensor.setEnabledSensors([] as Array<Sensor.SensorType>);
        }
    }

    // Beats per minute, or null when the watch has no reading (shown as "--", never as 0).
    function current() as Number or Null {
        if (!available()) {
            return null;
        }
        var info = Sensor.getInfo();
        if (info has :heartRate && info.heartRate != null && (info.heartRate as Number) > 0) {
            return info.heartRate as Number;
        }
        return null;
    }
}
