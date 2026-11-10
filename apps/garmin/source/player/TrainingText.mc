import Toybox.Lang;
import Toybox.WatchUi;

// Text of the training screens. The weight comes from the server in grams
// (07 D-11) and is only written out here; nothing is computed (07 D-12).
module TrainingText {

    function text(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }

    // 62500 -> "62.5", 60000 -> "60", 1250 -> "1.25" (decimal sign by watch language).
    function kg(grams as Number, separator as String) as String {
        var whole = grams / 1000;
        var rest = grams % 1000;
        if (rest == 0) {
            return whole.toString();
        }
        var digits = rest.format("%03d");
        while (digits.length() > 1 && (digits.substring(digits.length() - 1, digits.length()) as String).equals("0")) {
            digits = digits.substring(0, digits.length() - 1) as String;
        }
        return whole.toString() + separator + digits;
    }

    function separator() as String {
        return Capabilities.languageCode().equals("de") ? "," : ".";
    }

    // "60 kg"; null when the weight is not known.
    function loadText(set as PlannedSet) as String or Null {
        if (set.loadG == null) {
            return null;
        }
        return kg(set.loadG as Number, separator()) + " kg";
    }

    // "8 x 60 kg", "8 x" when the weight is not known, "? x 60 kg" when the repetitions are not known.
    function repsAndLoad(set as PlannedSet) as String {
        var reps = set.reps == null ? "?" : (set.reps as Number).toString();
        var load = loadText(set);
        return load == null ? reps + " x" : reps + " x " + (load as String);
    }

    // "Left", "Right", "Alternating"; null for both sides.
    function sideText(side as Number) as String or Null {
        if (side == PlannedSet.SIDE_LEFT) {
            return text(Rez.Strings.TrLeft);
        }
        if (side == PlannedSet.SIDE_RIGHT) {
            return text(Rez.Strings.TrRight);
        }
        if (side == PlannedSet.SIDE_ALTERNATING) {
            return text(Rez.Strings.TrAlternating);
        }
        return null;
    }

    // "2:05"
    function clock(seconds as Number) as String {
        var s = seconds > 0 ? seconds : 0;
        return (s / 60).toString() + ":" + (s % 60).format("%02d");
    }
}
