import Toybox.Lang;
import Toybox.Position;

// What the pre-start screen has decided so far (RUN-025): which run, and where it happens.
// No drawing and no sensors here, so it is tested on its own.
class PreStartModel {
    // Position = wire code `e` of the prescription (outdoor, treadmill, track).
    enum Environment {
        ENV_OUTDOOR,
        ENV_TREADMILL,
        ENV_TRACK
    }

    const ENVIRONMENTS as Number = 3;

    var request as PreStartRequest;
    var environment as Number;

    // Default environment: the one of the prescription; a free run (or an unknown code) starts outdoors.
    function initialize(startRequest as PreStartRequest) {
        request = startRequest;
        environment = ENV_OUTDOOR;
        var body = startRequest.prescription;
        if (body != null) {
            var code = (body as Dictionary)["e"] as Object or Null;
            if (code instanceof Number && (code as Number) >= 0 && (code as Number) < ENVIRONMENTS) {
                environment = code as Number;
            }
        }
    }

    // The treadmill has no position; outdoors and on the track the watch needs GPS.
    function usesGps() as Boolean {
        return environment != ENV_TREADMILL;
    }

    // delta = +1 for DOWN, -1 for UP; wraps around.
    function cycle(delta as Number) as Void {
        environment = ((environment + delta) % ENVIRONMENTS + ENVIRONMENTS) % ENVIRONMENTS;
    }

    // Starting before there is a usable position needs an answer from the user (never on the treadmill).
    function needsGpsQuestion(quality as Number) as Boolean {
        return usesGps() && quality < Position.QUALITY_USABLE;
    }

    // Planned minutes: the list's figure if it has one, else the sum of the timed segments, else null.
    function minutes() as Number or Null {
        if (request.minutes != null) {
            return request.minutes;
        }
        var body = request.prescription;
        return body == null ? null : PreStartModel.minutesOf(body as Dictionary);
    }

    // Segments in a prescription (without repeats), 0 for a free run.
    function segmentCount() as Number {
        var body = request.prescription;
        if (body == null || !((body as Dictionary)["s"] instanceof Array)) {
            return 0;
        }
        return ((body as Dictionary)["s"] as Array).size();
    }

    // Minutes of all segments with a duration in seconds, repeats included, rounded up. Segments
    // set by distance or left open have no known time and are not counted; null if nothing is left.
    static function minutesOf(prescription as Dictionary) as Number or Null {
        var segments = prescription["s"];
        if (!(segments instanceof Array)) {
            return null;
        }
        var list = segments as Array;
        var total = 0;
        for (var i = 0; i < list.size(); i++) {
            total += secondsOf(list[i] as Object or Null);
        }
        var repeats = prescription["rp"];
        if (repeats instanceof Array) {
            var reps = repeats as Array;
            for (var r = 0; r < reps.size(); r++) {
                var rep = reps[r] as Object or Null;
                if (!(rep instanceof Array) || (rep as Array).size() < 3) {
                    continue;
                }
                var first = (rep as Array)[0] as Object or Null;
                var last = (rep as Array)[1] as Object or Null;
                var count = (rep as Array)[2] as Object or Null;
                if (!(first instanceof Number) || !(last instanceof Number) || !(count instanceof Number)) {
                    continue;
                }
                var block = 0;
                for (var j = first as Number; j <= (last as Number) && j < list.size(); j++) {
                    block += secondsOf(list[j] as Object or Null);
                }
                total += block * ((count as Number) - 1);
            }
        }
        return total > 0 ? (total + 59) / 60 : null;
    }

    // Seconds of one segment [kind, duration type, value, ...]; 0 unless the duration is in seconds.
    hidden static function secondsOf(segment as Object or Null) as Number {
        if (!(segment instanceof Array) || (segment as Array).size() < 3) {
            return 0;
        }
        var type = (segment as Array)[1] as Object or Null;
        var value = (segment as Array)[2] as Object or Null;
        if (type instanceof Number && (type as Number) == 1 && value instanceof Number) {
            return value as Number;
        }
        return 0;
    }
}
