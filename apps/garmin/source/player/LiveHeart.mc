import Toybox.Activity;
import Toybox.Lang;
import Toybox.Sensor;

// Live heart rate for the set and rest screens (PRD T-08) and for the health capture
// (GAR-B4-02), both through current(). While the workout is recorded (GAR-B4-01) the
// activity data carry the heart rate; Sensor.getInfo() delivers nothing without an
// enabled heart rate sensor (seen on the real Forerunner 255: "-- bpm" during a recording).
// So: activity data first, the sensor only as a fallback (and switched off again).
module LiveHeart {
    // True while this module has switched the heart rate sensor on.
    var sensorOn as Boolean = false;

    function sensorAvailable() as Boolean {
        return Toybox has :Sensor && Sensor has :getInfo && Sensor has :setEnabledSensors;
    }

    function activityAvailable() as Boolean {
        return Toybox has :Activity && Activity has :getActivityInfo;
    }

    // Switches the sensor on for the fallback; only called when the activity data have no value.
    function enable() as Void {
        if (!sensorOn && sensorAvailable()) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE] as Array<Sensor.SensorType>);
            sensorOn = true;
        }
    }

    // Switches the sensor off again, if (and only if) this module switched it on.
    function disable() as Void {
        if (sensorOn && sensorAvailable()) {
            Sensor.setEnabledSensors([] as Array<Sensor.SensorType>);
        }
        sensorOn = false;
    }

    // A usable reading: a positive number. Anything else (null, 0, text) is no reading, never shown as 0.
    function valid(value as Object or Null) as Boolean {
        return value instanceof Number && (value as Number) > 0;
    }

    // The first usable one of the two readings (activity first), or null.
    function pick(fromActivity as Object or Null, fromSensor as Object or Null) as Number or Null {
        if (valid(fromActivity)) {
            return fromActivity as Number;
        }
        if (valid(fromSensor)) {
            return fromSensor as Number;
        }
        return null;
    }

    // Heart rate of the running activity (the FIT recording), or null.
    function fromActivity() as Number or Null {
        if (!activityAvailable()) {
            return null;
        }
        var info = Activity.getActivityInfo();
        if (info != null && info has :currentHeartRate && valid(info.currentHeartRate)) {
            return info.currentHeartRate as Number;
        }
        return null;
    }

    // Heart rate of the sensor, or null (the sensor is switched on by the first call).
    function fromSensor() as Number or Null {
        if (!sensorAvailable()) {
            return null;
        }
        enable();
        var info = Sensor.getInfo();
        if (info != null && info has :heartRate && valid(info.heartRate)) {
            return info.heartRate as Number;
        }
        return null;
    }

    // Beats per minute, or null when the watch has no reading (shown as "--", never as 0).
    function current() as Number or Null {
        var fromRecording = fromActivity();
        if (fromRecording != null) {
            return fromRecording;
        }
        return fromSensor();
    }
}
