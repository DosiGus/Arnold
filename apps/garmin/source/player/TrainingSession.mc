import Toybox.Lang;

// A workout in progress: the state machine of UMSETZUNG 7.2 and what it keeps.
//
//   PREVIEW(ex) -START-> SET(ex,s) -START-> REST(ex,s) -end/START-> SET(ex,s+1)
//   last set of an exercise: REST, then PREVIEW(ex+1);  last set of the day: FINISHED
//
// Every confirmed set is written to the journal (event first, then the head)
// before the state changes, so a crash or a forced exit loses nothing (PRD S-01,
// T-09). The rest timer runs on timestamps, so it is right after any hang.
// Changes during the workout (GAR-B3-05) are journal events too: the plan copy is
// never rewritten, the events are replayed on it when the workout is resumed.
// Not in this class: the summary and upload (GAR-B3-06), the recording (GAR-B4-01).
class TrainingSession {
    enum State {
        STATE_PREVIEW,
        STATE_SET,
        STATE_REST,
        STATE_FINISHED
    }

    const REST_STEP_S as Number = 15;
    const REST_MAX_S as Number = 900;
    const WARN_BEFORE_END_S as Number = 10;
    const LATE_SIGNAL_LIMIT_S as Number = 20;   // a rest that ended longer ago ends silently

    var uuid as String;
    var plan as TrainingPlan;
    var state as Number;
    var exIdx as Number;
    var setIdx as Number;
    var events as Array<Dictionary>;     // confirmed sets and skipped exercises, in order
    var paused as Boolean;

    private var _journal as Journal;
    private var _clock as PairingClock;
    private var _signals as Signals;
    private var _head as Dictionary;
    private var _warned as Boolean;

    // `head` and `events` come from the journal when a workout is resumed.
    function initialize(
        journal as Journal,
        clock as PairingClock,
        signals as Signals,
        workoutUuid as String,
        trainingPlan as TrainingPlan,
        head as Dictionary,
        savedEvents as Array<Dictionary>
    ) {
        _journal = journal;
        _clock = clock;
        _signals = signals;
        uuid = workoutUuid;
        plan = trainingPlan;
        _head = head;
        events = savedEvents;
        state = head["st"] as Number;
        exIdx = head["ex"] as Number;
        setIdx = head["s"] as Number;
        paused = false;
        _warned = false;
        for (var i = 0; i < events.size(); i++) {
            if ((events[i]["k"] as Number) == Journal.EVENT_ADJUST) {
                applyAdjust(events[i]);
            }
        }
    }

    // Starts a new workout on a copy of the given day and writes it to the journal.
    static function start(day as Dictionary, journal as Journal, clock as PairingClock, signals as Signals) as TrainingSession {
        var now = clock.nowSeconds();
        var id = Uuid.v4();
        var training = new TrainingPlan(day);
        var head = {
            "v" => 1, "d" => training.dayId, "p" => training.planVersion, "nm" => training.dayName,
            "a" => now, "o" => Clock.utcOffsetMinutes(), "n" => 0,
            "st" => STATE_PREVIEW, "ex" => 0, "s" => 0, "t" => now, "rl" => 0, "pz" => 0, "rm" => 0
        };
        journal.begin(id, head, day);
        var session = new TrainingSession(journal, clock, signals, id, training, head, [] as Array<Dictionary>);
        session.beginExercise(0);
        return session;
    }

    // The workout in progress after a restart or a forced exit, or null when there is none
    // (or it cannot be read; it is then removed so it cannot block the next workout).
    // The workout continues where it stopped; a set that was running starts over.
    static function resume(journal as Journal, clock as PairingClock, signals as Signals) as TrainingSession or Null {
        var id = journal.activeId();
        if (id == null) {
            return null;
        }
        if (journal.isSaved(id as String)) {
            journal.forgetActive();   // saved for sending, nothing left to continue
            return null;
        }
        var head = journal.readHead(id as String);
        var day = journal.readPlan(id as String);
        if (head == null || day == null) {
            journal.discard(id as String);
            return null;
        }
        var training = new TrainingPlan(day as Dictionary);
        var saved = journal.events(id as String);
        var session = new TrainingSession(journal, clock, signals, id as String, training, head as Dictionary, saved);
        if (!session.isValidPosition()) {
            journal.discard(id as String);
            return null;
        }
        session.continueWorkout();
        return session;
    }

    function dayName() as String {
        return plan.dayName;
    }

    function isFinished() as Boolean {
        return state == STATE_FINISHED;
    }

    function exercise() as PlannedExercise {
        return plan.exercises[exIdx];
    }

    // The set on screen (SET) or the set just finished (REST); null in PREVIEW and FINISHED.
    function currentSet() as PlannedSet or Null {
        if ((state != STATE_SET && state != STATE_REST) || exIdx >= plan.exercises.size()) {
            return null;
        }
        return plan.exercises[exIdx].sets[setIdx];
    }

    // Number of sets confirmed so far.
    function setsDone() as Number {
        var count = 0;
        for (var i = 0; i < events.size(); i++) {
            if ((events[i]["k"] as Number) == Journal.EVENT_SET) {
                count++;
            }
        }
        return count;
    }

    function sessionStart() as Number {
        return _head["a"] as Number;
    }

    // Offset of the watch to UTC in minutes when the workout started (kept with the workout).
    function utcOffsetMinutes() as Number {
        return _head["o"] as Number;
    }

    // Seconds from the start of the workout to now.
    function elapsedSeconds() as Number {
        var seconds = _clock.nowSeconds() - sessionStart();
        return seconds > 0 ? seconds : 0;
    }

    // Number of exercises with at least one confirmed set.
    function exercisesTrained() as Number {
        var seen = [] as Array<Number>;
        for (var i = 0; i < events.size(); i++) {
            var index = events[i]["e"] as Number;
            if ((events[i]["k"] as Number) == Journal.EVENT_SET && seen.indexOf(index) < 0) {
                seen.add(index);
            }
        }
        return seen.size();
    }

    // The finished workout goes to the outbox as one frozen request and stops being "in progress".
    // False when there is nothing to send (no set confirmed) or the workout is not finished.
    // Safe to call twice: a workout that is in the outbox already is not built again.
    function save(outbox as Outbox) as Boolean {
        if (state != STATE_FINISHED || setsDone() == 0) {
            return false;
        }
        if (!outbox.contains(uuid)) {
            outbox.add(uuid, WorkoutUpload.build(self, _clock.nowSeconds()), _clock.nowSeconds());
        }
        _journal.forgetActive();
        return true;
    }

    // The workout is thrown away (discard in the summary).
    function discard() as Void {
        _journal.discard(uuid);
    }

    // What comes after the rest on screen: the set (true) or the next exercise (false).
    function nextIsSameExercise() as Boolean {
        return state == STATE_REST && setIdx + 1 < plan.exercises[exIdx].sets.size();
    }

    // The exercise after the current one that has sets, or -1.
    function nextExerciseIndex() as Number {
        for (var i = exIdx + 1; i < plan.exercises.size(); i++) {
            if (plan.exercises[i].sets.size() > 0) {
                return i;
            }
        }
        return -1;
    }

    // START on the exercise preview.
    function confirmPreview() as Void {
        if (state != STATE_PREVIEW || paused) {
            return;
        }
        place(STATE_SET, exIdx, 0, _clock.nowSeconds(), 0);
    }

    // True when the set on screen cannot be confirmed as it is: unknown repetitions or an
    // unknown weight have to be chosen first (PRD P-03); nothing is saved silently.
    function setNeedsInput() as Boolean {
        var planned = currentSet();
        return state == STATE_SET && planned != null && ((planned as PlannedSet).reps == null || (planned as PlannedSet).loadG == null);
    }

    // True when sets of the exercise on screen follow the current one.
    function hasLaterSets() as Boolean {
        return (state == STATE_SET || state == STATE_REST) && setIdx + 1 < plan.exercises[exIdx].sets.size();
    }

    // The values chosen on the adjust screen for the set on screen; `forLater` also
    // changes the sets after it in this exercise. The change is journaled first.
    function adjustSet(reps as Number, loadG as Number, forLater as Boolean) as Boolean {
        if (state != STATE_SET || paused) {
            return false;
        }
        var event = {
            "k" => Journal.EVENT_ADJUST, "e" => exIdx, "s" => setIdx, "r" => reps, "g" => loadG,
            "d" => forLater ? 1 : 0, "a" => _clock.nowSeconds(), "b" => _clock.nowSeconds()
        };
        record(event);
        applyAdjust(event);
        _journal.saveHead(uuid, _head);
        return true;
    }

    // Skips the exercise on screen (preview or set): the sets already confirmed stay,
    // the rest is not trained. Moves on to the next exercise or the end.
    function canSkipExercise() as Boolean {
        return (state == STATE_PREVIEW || state == STATE_SET) && !paused;
    }

    function skipExercise() as Boolean {
        if (!canSkipExercise()) {
            return false;
        }
        var now = _clock.nowSeconds();
        record({ "k" => Journal.EVENT_SKIP, "e" => exIdx, "s" => setIdx, "d" => 0, "a" => now, "b" => now });
        beginExercise(exIdx + 1);
        return true;
    }

    // "End workout": what was done so far is the workout; the rest is not trained.
    function finishEarly() as Boolean {
        if (state == STATE_FINISHED || paused) {
            return false;
        }
        place(STATE_FINISHED, plan.exercises.size(), 0, _clock.nowSeconds(), 0);
        return true;
    }

    // START on a set: the set counts as shown. False if it cannot be confirmed yet
    // (unknown repetitions cannot be saved as a number; the user has to enter them).
    function confirmSet() as Boolean {
        if (state != STATE_SET || paused) {
            return false;
        }
        var planned = plan.exercises[exIdx].sets[setIdx];
        if (planned.reps == null) {
            return false;
        }
        var now = _clock.nowSeconds();
        var event = {
            "k" => Journal.EVENT_SET, "e" => exIdx, "s" => setIdx, "r" => planned.reps,
            "d" => planned.side, "a" => _head["t"], "b" => now
        };
        if (planned.loadG != null) {
            event["g"] = planned.loadG;
        }
        record(event);
        afterSet(now);
        return true;
    }

    // Seconds left of the rest, from timestamps; can be negative once it is over.
    function restRemaining() as Number {
        if (state != STATE_REST) {
            return 0;
        }
        if (paused) {
            return _head["rm"] as Number;
        }
        return (_head["rl"] as Number) - (_clock.nowSeconds() - (_head["t"] as Number));
    }

    // UP and DOWN during the rest: 15 s more or less. Stops at zero (the rest ends).
    function adjustRest(delta as Number) as Void {
        if (state != STATE_REST || paused) {
            return;
        }
        var length = (_head["rl"] as Number) + delta;
        if (length > REST_MAX_S) {
            length = REST_MAX_S;
        }
        _head["rl"] = length;
        _warned = restRemaining() <= WARN_BEFORE_END_S;   // a longer rest warns again
        if (restRemaining() <= 0) {
            advanceFromRest();
            return;
        }
        _journal.saveHead(uuid, _head);
    }

    // START during the rest: on with the next set.
    function endRest() as Void {
        if (state == STATE_REST && !paused) {
            advanceFromRest();
        }
    }

    // Called every second while the workout is on screen. True when the state changed.
    function tick() as Boolean {
        if (state != STATE_REST || paused) {
            return false;
        }
        var left = restRemaining();
        if (left <= 0) {
            if (left > -LATE_SIGNAL_LIMIT_S) {
                _signals.restOver();
            }
            advanceFromRest();
            return true;
        }
        if (left <= WARN_BEFORE_END_S && !_warned) {
            _warned = true;
            _signals.warn();
        }
        return false;
    }

    // BACK, "pause training?" yes: the workout stays in the journal and a running rest stands still.
    function pause() as Void {
        if (paused || state == STATE_FINISHED) {
            return;
        }
        if (state == STATE_REST) {
            _head["rm"] = restRemaining();
        }
        paused = true;
        _head["pz"] = 1;
        _journal.saveHead(uuid, _head);
    }

    // Back into the workout after a pause, a restart or a forced exit.
    function continueWorkout() as Void {
        var now = _clock.nowSeconds();
        if (state == STATE_SET) {
            _head["t"] = now;      // the running set starts over
        } else if (state == STATE_REST && (_head["pz"] as Number) == 1) {
            _head["t"] = now - ((_head["rl"] as Number) - (_head["rm"] as Number));
        }
        paused = false;
        _head["pz"] = 0;
        // A set that was confirmed just before a crash has an event the head does not
        // count yet: take it over and go on from there.
        var counted = _head["n"] as Number;
        if (events.size() > counted) {
            _head["n"] = events.size();
            var last = events[events.size() - 1];
            if ((last["k"] as Number) == Journal.EVENT_SKIP && (state == STATE_PREVIEW || state == STATE_SET) && (last["e"] as Number) == exIdx) {
                beginExercise(exIdx + 1);   // the skip was written, the head not yet
                return;
            }
            if ((last["k"] as Number) == Journal.EVENT_SET && state == STATE_SET && (last["e"] as Number) == exIdx && (last["s"] as Number) == setIdx) {
                afterSet(last["b"] as Number);
                return;
            }
        } else if (events.size() < counted) {
            _head["n"] = events.size();   // an event is damaged: continue with what is readable
        }
        _journal.saveHead(uuid, _head);
        if (state == STATE_REST && restRemaining() <= 0) {
            advanceFromRest();   // the rest ended while the app was closed
        }
    }

    function isValidPosition() as Boolean {
        if (state < STATE_PREVIEW || state > STATE_FINISHED || exIdx < 0) {
            return false;
        }
        if (state == STATE_FINISHED) {
            return true;
        }
        if (exIdx >= plan.exercises.size()) {
            return false;
        }
        var count = plan.exercises[exIdx].sets.size();
        return state == STATE_PREVIEW || (setIdx >= 0 && setIdx < count);
    }

    // Moves to the first exercise with sets from `index` on, writing a skip event
    // for every exercise without sets on the way; the workout ends after the last.
    function beginExercise(index as Number) as Void {
        var ex = index;
        while (ex < plan.exercises.size() && plan.exercises[ex].sets.size() == 0) {
            record({ "k" => Journal.EVENT_SKIP, "e" => ex, "s" => 0, "d" => 0, "a" => _clock.nowSeconds(), "b" => _clock.nowSeconds() });
            ex++;
        }
        if (ex >= plan.exercises.size()) {
            place(STATE_FINISHED, plan.exercises.size(), 0, _clock.nowSeconds(), 0);
            return;
        }
        place(STATE_PREVIEW, ex, 0, _clock.nowSeconds(), 0);
    }

    hidden function afterSet(endedAt as Number) as Void {
        var ex = plan.exercises[exIdx];
        var more = setIdx + 1 < ex.sets.size() || nextExerciseIndex() >= 0;
        if (!more) {
            place(STATE_FINISHED, plan.exercises.size(), 0, endedAt, 0);
            return;
        }
        if (ex.restSeconds <= 0) {
            advance();
            return;
        }
        place(STATE_REST, exIdx, setIdx, endedAt, ex.restSeconds);
    }

    hidden function advanceFromRest() as Void {
        advance();
    }

    // After the set or the rest on screen: the next set, or the next exercise.
    hidden function advance() as Void {
        if (setIdx + 1 < plan.exercises[exIdx].sets.size()) {
            place(STATE_SET, exIdx, setIdx + 1, _clock.nowSeconds(), 0);
        } else {
            beginExercise(exIdx + 1);
        }
    }

    // Changes the planned values of the set the event names (and the later ones of the exercise).
    hidden function applyAdjust(event as Dictionary) as Void {
        var index = event["e"] as Number;
        var first = event["s"] as Number;
        if (index < 0 || index >= plan.exercises.size()) {
            return;
        }
        var sets = plan.exercises[index].sets;
        var last = (event["d"] as Number) == 1 ? sets.size() - 1 : first;
        for (var i = first; i <= last && i < sets.size(); i++) {
            sets[i].reps = event["r"] as Number;
            sets[i].loadG = event["g"] as Number;
        }
    }

    // Appends an event to the journal, then counts it in the head (the caller's next place() saves it).
    hidden function record(event as Dictionary) as Void {
        var n = _head["n"] as Number;
        _journal.appendEvent(uuid, n, event);
        events.add(event);
        _head["n"] = n + 1;
    }

    // Writes the new position to the head before anything is shown.
    hidden function place(newState as Number, ex as Number, set as Number, since as Number, restLength as Number) as Void {
        state = newState;
        exIdx = ex;
        setIdx = set;
        _warned = false;
        _head["st"] = newState;
        _head["ex"] = ex;
        _head["s"] = set;
        _head["t"] = since;
        _head["rl"] = restLength;
        _head["pz"] = 0;
        _head["rm"] = 0;
        paused = false;
        _journal.saveHead(uuid, _head);
    }
}
