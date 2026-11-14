import Toybox.Lang;

// The segments of a run, read from the compact prescription (RUN-015): s = list of
// [kind, duration type, duration value, target type, low, high], rp = repeats [first, last, count].
// A free run has no prescription and no segments.
//
// Nothing is expanded in memory: segments are numbered 0.. in the order they are run (repeats
// included, at most 80) and `baseIndex` maps that number to the entry of `s`.
class RunSegments {
    enum DurationType {
        DURATION_OPEN,      // until the lap key
        DURATION_SECONDS,
        DURATION_METERS
    }

    const MAX as Number = 80;

    private var _list as Array or Null;
    private var _repeats as Array or Null;
    private var _total as Number;

    function initialize(prescription as Dictionary or Null) {
        _list = null;
        _repeats = null;
        _total = 0;
        if (prescription == null) {
            return;
        }
        var s = (prescription as Dictionary)["s"] as Object or Null;
        if (!(s instanceof Array)) {
            return;
        }
        _list = s as Array;
        var rp = (prescription as Dictionary)["rp"] as Object or Null;
        _repeats = rp instanceof Array ? rp as Array : null;
        _total = _list.size();
        if (_repeats != null) {
            for (var i = 0; i < (_repeats as Array).size(); i++) {
                var block = blockOf(i);
                if (block != null) {
                    _total += (block as Array<Number>)[0] * ((block as Array<Number>)[1] - 1);
                }
            }
        }
        if (_total > MAX) {
            _total = MAX;
        }
    }

    // Number of segments that are run, 0 for a free run.
    function count() as Number {
        return _total;
    }

    // [length of the block, count] of repeat i, or null when it is malformed.
    hidden function blockOf(i as Number) as Array<Number> or Null {
        var rep = (_repeats as Array)[i] as Object or Null;
        if (!(rep instanceof Array) || (rep as Array).size() < 3) {
            return null;
        }
        var first = (rep as Array)[0] as Object or Null;
        var last = (rep as Array)[1] as Object or Null;
        var times = (rep as Array)[2] as Object or Null;
        if (!(first instanceof Number) || !(last instanceof Number) || !(times instanceof Number)
            || (first as Number) > (last as Number) || (last as Number) >= (_list as Array).size() || (times as Number) < 2) {
            return null;
        }
        return [(last as Number) - (first as Number) + 1, times as Number] as Array<Number>;
    }

    // Index into `s` of the segment run as number `ordinal`, or -1 beyond the end.
    function baseIndex(ordinal as Number) as Number {
        if (ordinal < 0 || ordinal >= _total) {
            return -1;
        }
        var pos = 0;       // next entry of s not yet passed
        var done = 0;      // segments run before pos
        if (_repeats != null) {
            for (var i = 0; i < (_repeats as Array).size(); i++) {
                var block = blockOf(i);
                if (block == null) {
                    continue;
                }
                var first = ((_repeats as Array)[i] as Array)[0] as Number;
                var plain = first - pos;
                if (ordinal < done + plain) {
                    return pos + (ordinal - done);
                }
                done += plain;
                var length = (block as Array<Number>)[0];
                var span = length * (block as Array<Number>)[1];
                if (ordinal < done + span) {
                    return first + (ordinal - done) % length;
                }
                done += span;
                pos = first + length;
            }
        }
        var index = pos + (ordinal - done);
        return index < (_list as Array).size() ? index : -1;
    }

    // The segment run as number `ordinal` ([kind, duration type, value, target type, low, high]), or null.
    function at(ordinal as Number) as Array or Null {
        var index = baseIndex(ordinal);
        if (index < 0) {
            return null;
        }
        var segment = (_list as Array)[index] as Object or Null;
        return segment instanceof Array && (segment as Array).size() >= 6 ? segment as Array : null;
    }

    // Duration type (see DurationType) of a segment; unknown, malformed or without a value counts as open.
    function durationType(ordinal as Number) as Number {
        var segment = at(ordinal);
        if (segment == null) {
            return DURATION_OPEN;
        }
        var type = (segment as Array)[1] as Object or Null;
        var value = (segment as Array)[2] as Object or Null;
        if (type instanceof Number && value instanceof Number && (value as Number) > 0
            && ((type as Number) == DURATION_SECONDS || (type as Number) == DURATION_METERS)) {
            return type as Number;
        }
        return DURATION_OPEN;
    }

    // Seconds or metres of a segment, 0 for an open one.
    function durationValue(ordinal as Number) as Number {
        if (durationType(ordinal) == DURATION_OPEN) {
            return 0;
        }
        return (at(ordinal) as Array)[2] as Number;
    }
}
