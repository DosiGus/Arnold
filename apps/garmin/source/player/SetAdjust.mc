import Toybox.Lang;

// The values being chosen on the adjust screen (PRD T-03, P-03): repetitions in steps of 1,
// weight in steps of the exercise's step_g (from the server, 07 D-12). Nothing is
// computed here besides the step; unknown values start on a preselection that only
// counts once the user has gone through the field with START.
class SetAdjust {
    enum Field {
        FIELD_REPS,
        FIELD_LOAD
    }

    const MAX_REPS as Number = 999;
    const MAX_LOAD_G as Number = 999000;
    const DEFAULT_REPS as Number = 8;

    var reps as Number;
    var loadG as Number;
    var field as Number;
    var repsUnknown as Boolean;
    var loadUnknown as Boolean;
    var setIndex as Number = 0;   // the set of the exercise that is being changed

    private var _stepG as Number;
    private var _startReps as Number or Null;
    private var _startLoadG as Number or Null;

    // Starts on the first field that is unknown (repetitions first), otherwise on `wanted`.
    function initialize(set as PlannedSet, ex as PlannedExercise, wanted as Number) {
        _startReps = set.reps;
        _startLoadG = set.loadG;
        repsUnknown = set.reps == null;
        loadUnknown = set.loadG == null;
        reps = set.reps != null ? set.reps as Number : (ex.repMin != null ? ex.repMin as Number : DEFAULT_REPS);
        loadG = set.loadG != null ? set.loadG as Number : 0;
        _stepG = ex.stepG > 0 ? ex.stepG : 1000;
        field = repsUnknown ? FIELD_REPS : (loadUnknown ? FIELD_LOAD : wanted);
    }

    function up() as Void {
        step(1);
    }

    function down() as Void {
        step(-1);
    }

    // START: on to the next field; true after the last one (the choice is complete).
    function next() as Boolean {
        if (field == FIELD_REPS) {
            repsUnknown = false;
            field = FIELD_LOAD;
            return false;
        }
        loadUnknown = false;
        return true;
    }

    // True when something differs from what the set had (an unknown value counts as different).
    function changed() as Boolean {
        return _startReps == null || _startLoadG == null || reps != _startReps || loadG != _startLoadG;
    }

    hidden function step(direction as Number) as Void {
        if (field == FIELD_REPS) {
            var value = reps + direction;
            reps = value < 1 ? 1 : (value > MAX_REPS ? MAX_REPS : value);
        } else {
            var value = loadG + direction * _stepG;
            loadG = value < 0 ? 0 : (value > MAX_LOAD_G ? MAX_LOAD_G : value);
        }
    }
}
