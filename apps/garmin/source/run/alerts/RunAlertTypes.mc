import Toybox.Lang;

// What the alarm rules of a run see once a second (RUN-017). One object, filled again every second, so the
// tick makes no new objects. A value the watch does not have is null, never 0.
class RunAlertInput {
    var timerS as Number;                  // moving seconds of the whole run
    var distanceCm as Number;
    var heartRate as Number or Null;       // null without a sensor or a reading
    var paceSKm as Number or Null;         // pace over 30 s in s/km, null while standing
    var ordinal as Number;                 // segment being run (0 based); the segment count when there is none
    var kind as Number;                    // -1 without a segment, else 0 warm-up, 1 work, 2 recovery, 3 cool-down, 4 rest
    var durationType as Number;            // 0 open, 1 seconds, 2 metres
    var durationValue as Number;
    var segmentSeconds as Number;          // seconds since the segment began
    var segmentCm as Number;               // distance since the segment began
    var targetType as Number;              // 0 none, 1 zone, 2 pace s/km, 3 bpm, 4 effort
    var targetLow as Number;
    var targetHigh as Number;
    var nextKind as Number;                // -1 when the plan ends with this segment
    var nextTargetType as Number;
    var nextTargetLow as Number;
    var nextTargetHigh as Number;
    var kmSignal as Boolean;               // settings, read fresh by the caller every second
    var hrAlarms as Boolean;
    var muted as Boolean;                  // muted for this run

    function initialize() {
        timerS = 0;
        distanceCm = 0;
        heartRate = null;
        paceSKm = null;
        ordinal = 0;
        kind = -1;
        durationType = 0;
        durationValue = 0;
        segmentSeconds = 0;
        segmentCm = 0;
        targetType = 0;
        targetLow = 0;
        targetHigh = 0;
        nextKind = -1;
        nextTargetType = 0;
        nextTargetLow = 0;
        nextTargetHigh = 0;
        kmSignal = true;
        hrAlarms = true;
        muted = false;
    }
}

// An alarm event. `shown` says the hint line may show it, `audible` that the watch may vibrate or beep
// (a switched-off heart rate alarm or a muted run still produces the event, so it can be logged).
class RunAlertEvent {
    enum Type {
        HR_HIGH,
        HR_LOW,
        PACE_FAST,       // the runner is too slow: "faster"
        PACE_SLOW,       // the runner is too fast: "slower"
        COUNTDOWN,
        CHANGE,
        KM,
        DRINK,
        NO_HEART_RATE
    }

    static const TYPES as Number = 9;

    var type as Number;
    var kind as Number;          // COUNTDOWN: the next segment (-1 = end of the plan), CHANGE: the segment that starts
    var targetType as Number;
    var targetLow as Number;
    var targetHigh as Number;
    var value as Number;         // KM: the km, DRINK: the minute, COUNTDOWN: seconds or metres left
    var timeS as Number;         // KM: seconds the km took, -1 when unknown
    var shown as Boolean;
    var audible as Boolean;

    function initialize(eventType as Number) {
        type = eventType;
        kind = -1;
        targetType = 0;
        targetLow = 0;
        targetHigh = 0;
        value = 0;
        timeS = -1;
        shown = true;
        audible = true;
    }
}

// The numbers of one alarm: [dwell s, tolerance, warm-up s, repeat lock s] (prescription key "a").
class RunAlarmSetting {
    var dwellS as Number;
    var tolerance as Number;
    var warmupS as Number;
    var lockS as Number;

    function initialize(dwell as Number, tol as Number, warmup as Number, lock as Number) {
        dwellS = dwell;
        tolerance = tol;
        warmupS = warmup;
        lockS = lock;
    }
}

// The alarm parameters of a run. What the prescription ("a" = alarms, "dr" = drink reminder, "k" = run type) says
// counts; the defaults apply only where it says nothing.
class RunAlertParams {
    static const FREE_RUN as Number = 13;
    static const LONG_RUN as Number = 2;
    static const DEFAULT_RUN_IN_S as Number = 300;       // heart rate alarm stays silent for the first 5 min of a continuous run
    static const DEFAULT_DRINK_FROM_MIN as Number = 60;
    static const DEFAULT_DRINK_EVERY_MIN as Number = 30;

    var runType as Number;
    var hi as RunAlarmSetting;       // heart rate too high
    var lo as RunAlarmSetting;       // heart rate too low
    var pace as RunAlarmSetting;     // pace outside the band; the warm-up is the start of each segment
    var drinkFromMin as Number;
    var drinkEveryMin as Number;     // 0: no drink reminder
    var zones as Array<Number> or Null;   // six heart rate bounds of the watch, for zone targets

    function initialize(prescription as Dictionary or Null, hrZones as Array<Number> or Null) {
        zones = hrZones;
        runType = FREE_RUN;
        var alarms = null as Object or Null;
        var drink = null as Object or Null;
        if (prescription != null) {
            var kind = (prescription as Dictionary)["k"] as Object or Null;
            if (kind instanceof Number) {
                runType = kind as Number;
            }
            alarms = (prescription as Dictionary)["a"] as Object or Null;
            drink = (prescription as Dictionary)["dr"] as Object or Null;
        }
        hi = read(alarms, "hi", 20, 0, isContinuous(runType) ? DEFAULT_RUN_IN_S : 0, 60);
        lo = read(alarms, "lo", 30, 0, 0, 60);
        pace = read(alarms, "pace", 15, 0, 20, 60);
        drinkFromMin = DEFAULT_DRINK_FROM_MIN;
        drinkEveryMin = runType == LONG_RUN ? DEFAULT_DRINK_EVERY_MIN : 0;
        if (drink instanceof Array && (drink as Array).size() >= 2 && (drink as Array)[0] instanceof Number
            && (drink as Array)[1] instanceof Number && ((drink as Array)[1] as Number) > 0) {
            drinkFromMin = (drink as Array)[0] as Number;
            drinkEveryMin = (drink as Array)[1] as Number;
        }
    }

    // Recovery, base, long, progression and tempo runs go on without a warm-up segment of their own.
    static function isContinuous(type as Number) as Boolean {
        return type >= 0 && type <= 4;
    }

    hidden function read(alarms as Object or Null, key as String, dwell as Number, tol as Number, warm as Number, lock as Number) as RunAlarmSetting {
        if (alarms instanceof Dictionary) {
            var entry = (alarms as Dictionary)[key] as Object or Null;
            if (entry instanceof Array && (entry as Array).size() >= 4 && (entry as Array)[0] instanceof Number
                && (entry as Array)[1] instanceof Number && (entry as Array)[2] instanceof Number && (entry as Array)[3] instanceof Number) {
                var list = entry as Array;
                return new RunAlarmSetting(list[0] as Number, list[1] as Number, list[2] as Number, list[3] as Number);
            }
        }
        return new RunAlarmSetting(dwell, tol, warm, lock);
    }
}
