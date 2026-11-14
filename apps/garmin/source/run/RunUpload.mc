import Toybox.Lang;

// Builds the request of a finished run for POST /runs (RUN-018), as the run contract has it: compact keys, whole
// seconds, metres and beats per minute, nothing rounded on the wire, an unknown value is left out (never 0), no
// coordinates. Heart rate values (the summary and those of the segments) only go with the consent of the account.
// The request is built once and frozen by the run outbox; its request_id is made from the run, so a request that is
// built again after a crash is the same request for the server.
module RunUpload {
    const RUN_TYPES as Array<String> = ["recovery", "base", "long", "progression", "tempo", "threshold_intervals", "intervals",
        "repetitions", "strides", "hills", "fartlek", "run_walk", "test", "free"] as Array<String>;
    const ENVIRONMENTS as Array<String> = ["outdoor", "treadmill", "track"] as Array<String>;
    const BASE_RUN_KIND as Number = 1;
    const MIN_BPM as Number = 30;
    const MAX_BPM as Number = 250;

    function requestId(uuid as String) as String {
        return "gr_" + uuid;
    }

    // The code of the run type the server knows (free run, zone 2 run, planned run).
    function runKind(session as RunSession) as Number {
        if (session.mode == PreStartRequest.MODE_ZONE2) {
            return BASE_RUN_KIND;
        }
        return session.mode == PreStartRequest.MODE_PLANNED ? session.plan.runKind() : RunSegments.FREE_RUN;
    }

    // "gps", "sensor" (the treadmill's own distance) or "corrected" (changed by the user).
    function distanceSource(session as RunSession) as String {
        if (session.correctedCm >= 0) {
            return "corrected";
        }
        return session.environment == PreStartModel.ENV_TREADMILL ? "sensor" : "gps";
    }

    function distanceM(session as RunSession) as Number {
        var m = (session.resultDistanceCm() + 50) / 100;
        return m > 100000 ? 100000 : m;
    }

    function build(session as RunSession, consent as Boolean, zones as Array<Number> or Null, offsetMinutes as Number) as Dictionary {
        var timer = session.calc.timerS > 36000 ? 36000 : session.calc.timerS;
        var elapsed = session.endedAt - session.startedAt;
        if (elapsed < timer) {
            elapsed = timer;
        }
        var ended = session.startedAt + elapsed;
        var meters = distanceM(session);
        var body = {
            "request_id" => requestId(session.uuid),
            "session_uuid" => session.uuid,
            "workout_date_local" => Clock.localDate(session.startedAt, offsetMinutes),
            "utc_offset_min" => offsetMinutes,
            "started_at_utc" => Clock.isoUtc(session.startedAt),
            "ended_at_utc" => Clock.isoUtc(ended),
            "environment" => ENVIRONMENTS[session.environment],
            "run_type" => RUN_TYPES[runKind(session)],
            "timer_s" => timer,
            "elapsed_s" => elapsed > 36000 ? 36000 : elapsed,
            "distance_m" => meters,
            "distance_source" => distanceSource(session),
            "splits" => splits(session, meters, timer),
            "pauses" => session.pauses > 1000 ? 1000 : session.pauses,
            "segments" => segments(session, consent)
        };
        if (session.mode == PreStartRequest.MODE_PLANNED && session.runId.length() > 0) {
            body["planned_workout_id"] = session.runId;
        }
        if (!session.distanceIsEstimated()) {
            body["ascent_m"] = session.calc.ascentM;
        }
        if (session.calc.cadenceN > 0) {
            var cadence = session.calc.cadenceSum / session.calc.cadenceN;
            if (cadence >= 1 && cadence <= 300) {
                body["cadence_spm"] = cadence;
            }
        }
        if (session.calories >= 0) {
            body["calories_kcal"] = session.calories > 20000 ? 20000 : session.calories;
        }
        if (session.effect10 >= 0 && session.effect10 <= 50) {
            body["te_aerobic"] = session.effect10.toFloat() / 10.0;
        }
        var heart = consent ? heartSummary(session, zones) : null;
        if (heart != null) {
            body["hr"] = heart;
        }
        if (session.effort > 0) {
            body["rpe"] = session.effort;
        }
        return body;
    }

    // Cumulative seconds of the timer at each full 100 m. Never more splits than the distance allows (a distance that
    // was corrected down drops the splits beyond it), never later than the end, never decreasing.
    function splits(session as RunSession, meters as Number, timer as Number) as Array<Number> {
        var count = session.calc.splitCount;
        var most = meters / 100 + 1;
        if (count > most) {
            count = most;
        }
        var out = [] as Array<Number>;
        var last = 0;
        for (var i = 0; i < count; i++) {
            var s = (session.calc.splitAt(i) + 5) / 10;
            if (s > timer) {
                s = timer;
            }
            if (s < last) {
                s = last;
            }
            out.add(s);
            last = s;
        }
        return out;
    }

    function segments(session as RunSession, consent as Boolean) as Array<Dictionary> {
        var out = [] as Array<Dictionary>;
        for (var i = 0; i < session.results.size(); i++) {
            var r = session.results[i];
            var entry = {
                "i" => i,
                "rep" => r[7] > 0 ? r[7] : null,
                "kind" => r[0],
                "st" => r[1],
                "t" => r[2],
                "dm" => r[3],
                "tz" => r[4] >= 0 ? r[4] : null
            };
            if (consent && r[5] >= MIN_BPM && r[6] >= r[5] && r[6] <= MAX_BPM) {
                entry["hr"] = [r[5], r[6]] as Array<Number>;
            }
            out.add(entry);
        }
        return out;
    }

    // Average, maximum, seconds per zone and the zone bounds of the watch; null without a heart rate measurement.
    function heartSummary(session as RunSession, zones as Array<Number> or Null) as Dictionary or Null {
        var calc = session.calc;
        if (calc.heartN <= 0) {
            return null;
        }
        var avg = calc.heartSum / calc.heartN;
        if (avg < MIN_BPM || avg > MAX_BPM || calc.heartMax < avg || calc.heartMax > MAX_BPM) {
            return null;
        }
        var bounds = validBounds(zones);
        var zoneSeconds = [] as Array<Number>;
        for (var z = 0; z < 5; z++) {
            zoneSeconds.add(calc.zoneSeconds[z] > 36000 ? 36000 : calc.zoneSeconds[z]);
        }
        return {
            "avg" => avg,
            "max" => calc.heartMax,
            "zone_s" => bounds == null ? null : zoneSeconds,
            "zones" => bounds,
            "zones_sport" => bounds == null ? null : "running"
        };
    }

    // The six bounds when they are all in range and strictly ascending; otherwise none are sent.
    function validBounds(zones as Array<Number> or Null) as Array<Number> or Null {
        if (zones == null || (zones as Array).size() < 6) {
            return null;
        }
        var out = [] as Array<Number>;
        for (var i = 0; i < 6; i++) {
            var value = (zones as Array)[i];
            if (!(value instanceof Number) || (value as Number) < MIN_BPM || (value as Number) > MAX_BPM || (i > 0 && (value as Number) <= out[i - 1])) {
                return null;
            }
            out.add(value as Number);
        }
        return out;
    }
}
