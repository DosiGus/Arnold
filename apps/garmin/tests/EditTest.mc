import Toybox.Lang;
import Toybox.Test;

// Adjusting, skipping and ending a workout (GAR-B3-05): every change is a journal event.

// The unknown exercise E of the day: preview, first set. Exercises A to D are passed with their sets.
(:test)
class EditRig {
    static function toUnknownSet(rig as PlayerRig) as Void {
        rig.toFirstSet();
        for (var i = 0; i < 3; i++) {
            rig.setAndRest();
        }
        rig.session.confirmPreview();
        rig.setAndRest();
        rig.setAndRest();
        rig.session.confirmPreview();
        rig.session.confirmSet();
        rig.session.confirmPreview();
    }
}

(:test)
function setAdjustStepsByTheServersWeightStepAndOneRep(logger as Logger) as Boolean {
    var set = new PlannedSet(8, 60000, PlannedSet.SIDE_BOTH);
    var ex = new TrainingPlan(PlayerRig.dayBody(false)).exercises[0];   // step 2500
    var adjust = new SetAdjust(set, ex, SetAdjust.FIELD_REPS);
    Expect.equal(adjust.field, SetAdjust.FIELD_REPS);
    adjust.up();
    Expect.equal(adjust.reps, 9);
    Test.assert(!adjust.next());
    Expect.equal(adjust.field, SetAdjust.FIELD_LOAD);
    adjust.up();
    adjust.up();
    adjust.down();
    Expect.equal(adjust.loadG, 62500);
    Test.assert(adjust.changed());
    Test.assert(adjust.next());
    return true;
}

(:test)
function setAdjustNeverGoesBelowOneRepOrZeroKg(logger as Logger) as Boolean {
    var ex = new TrainingPlan(PlayerRig.dayBody(false)).exercises[0];
    var adjust = new SetAdjust(new PlannedSet(1, 2500, PlannedSet.SIDE_BOTH), ex, SetAdjust.FIELD_REPS);
    adjust.down();
    Expect.equal(adjust.reps, 1);
    adjust.next();
    adjust.down();
    adjust.down();
    Expect.equal(adjust.loadG, 0);
    var same = new SetAdjust(new PlannedSet(8, 60000, PlannedSet.SIDE_BOTH), ex, SetAdjust.FIELD_REPS);
    Test.assert(!same.changed());
    return true;
}

(:test)
function setAdjustOnUnknownValuesStartsOnTheUnknownFieldAndAsksForBoth(logger as Logger) as Boolean {
    var ex = new TrainingPlan(PlayerRig.dayBody(true)).exercises[4];
    var adjust = new SetAdjust(new PlannedSet(null, null, PlannedSet.SIDE_BOTH), ex, SetAdjust.FIELD_LOAD);
    Expect.equal(adjust.field, SetAdjust.FIELD_REPS);   // reps first
    Test.assert(adjust.repsUnknown);
    Test.assert(adjust.loadUnknown);
    Test.assert(adjust.changed());                       // an unknown value counts as a change
    adjust.next();
    Expect.equal(adjust.loadG, 0);                       // preselected, but still "choose"
    Test.assert(adjust.loadUnknown);
    adjust.next();
    Test.assert(!adjust.loadUnknown);
    var weightOnly = new SetAdjust(new PlannedSet(5, null, PlannedSet.SIDE_BOTH), ex, SetAdjust.FIELD_REPS);
    Expect.equal(weightOnly.field, SetAdjust.FIELD_LOAD);
    return true;
}

(:test)
function editUnknownRepsAndWeightAreChosenNotInvented(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    EditRig.toUnknownSet(rig);
    Test.assert(rig.session.setNeedsInput());
    var before = rig.journal.events(rig.session.uuid).size();
    Test.assert((rig.session.currentSet() as PlannedSet).reps == null);   // nothing was saved for them
    Test.assert(rig.session.adjustSet(10, 20000, false));
    Expect.equal(rig.journal.events(rig.session.uuid).size(), before + 1);
    Test.assert(!rig.session.setNeedsInput());
    Test.assert(rig.session.confirmSet());
    var last = rig.journal.events(rig.session.uuid);
    var set = last[last.size() - 1];
    Expect.field(set, "k", Journal.EVENT_SET);
    Expect.field(set, "r", 10);
    Expect.field(set, "g", 20000);
    return true;
}

(:test)
function editKnownValuesNeedNoInput(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    Test.assert(!rig.session.setNeedsInput());   // preview
    rig.toFirstSet();
    Test.assert(!rig.session.setNeedsInput());
    return true;
}

(:test)
function editForTheRemainingSetsChangesOnlyThoseAfter(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    Test.assert(rig.session.hasLaterSets());
    rig.session.adjustSet(7, 57500, true);
    var sets = rig.session.exercise().sets;
    for (var i = 0; i < 3; i++) {
        Expect.equal(sets[i].reps, 7);
        Expect.equal(sets[i].loadG, 57500);
    }
    rig.setAndRest();
    rig.session.adjustSet(6, 55000, false);              // this set only
    Expect.equal(sets[1].reps, 6);
    Expect.equal(sets[2].reps, 7);
    rig.setAndRest();
    rig.session.confirmSet();
    var events = rig.journal.events(rig.session.uuid);
    var done = [] as Array<Dictionary>;
    for (var i = 0; i < events.size(); i++) {
        if ((events[i]["k"] as Number) == Journal.EVENT_SET) {
            done.add(events[i]);
        }
    }
    Expect.field(done[0], "r", 7);
    Expect.field(done[1], "r", 6);
    Expect.field(done[1], "g", 55000);
    Expect.field(done[2], "r", 7);
    return true;
}

(:test)
function editSurvivesACrash(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.adjustSet(7, 57500, true);
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.state, TrainingSession.STATE_SET);
    Expect.equal(resumed.exercise().sets[0].reps, 7);
    Expect.equal(resumed.exercise().sets[2].loadG, 57500);
    Test.assert(resumed.confirmSet());
    var set = rig.journal.events(rig.session.uuid)[1];
    Expect.field(set, "k", Journal.EVENT_SET);
    Expect.field(set, "r", 7);
    Expect.field(set, "g", 57500);
    return true;
}

(:test)
function editIsIgnoredWhileItDoesNotApply(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    Test.assert(!rig.session.adjustSet(9, 1000, false));   // preview: no set to adjust
    rig.toFirstSet();
    rig.session.pause();
    Test.assert(!rig.session.adjustSet(9, 1000, false));
    Expect.equal(rig.journal.events(rig.session.uuid).size(), 0);
    return true;
}

(:test)
function skippingTheExerciseOnPreviewIsJournaledAndUploadedAsSkipped(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    Test.assert(rig.session.canSkipExercise());
    Test.assert(rig.session.skipExercise());
    Expect.equal(rig.session.exercise().name, "Bizeps einarmig");
    Expect.equal(rig.session.state, TrainingSession.STATE_PREVIEW);
    var events = rig.journal.events(rig.session.uuid);
    Expect.field(events[0], "k", Journal.EVENT_SKIP);
    Expect.field(events[0], "e", 0);
    rig.session.finishEarly();
    Expect.equal(rig.session.setsDone(), 0);
    Test.assert(!rig.session.save(rig.outbox));           // nothing trained: nothing to send
    return true;
}

(:test)
function skippingInTheMiddleOfAnExerciseKeepsTheSetsDone(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    Test.assert(rig.session.canSkipExercise());
    rig.session.skipExercise();
    Expect.equal(rig.session.exercise().name, "Bizeps einarmig");
    rig.session.finishEarly();
    Test.assert(rig.session.save(rig.outbox));
    var request = rig.outbox.get(rig.session.uuid) as Dictionary;
    var exercises = (request["b"] as Dictionary)["exercises"] as Array;
    Expect.equal(exercises.size(), 1);
    var first = exercises[0] as Dictionary;
    Expect.equal(first["plan_item_id"] as String, "it_a");
    Expect.equal((first["sets"] as Array).size(), 1);
    Test.assert(!first.hasKey("skip"));
    return true;
}

(:test)
function skippingTheLastExerciseEndsTheWorkout(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) {
        rig.setAndRest();
    }
    rig.session.confirmPreview();
    rig.setAndRest();
    rig.setAndRest();
    Expect.equal(rig.session.exercise().name, "Klimmzüge");
    rig.session.skipExercise();
    Test.assert(rig.session.isFinished());
    Test.assert(rig.session.save(rig.outbox));
    return true;
}

(:test)
function adjustEventsDoNotAddAnExerciseToTheUpload(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) {
        rig.setAndRest();
    }
    rig.session.confirmPreview();
    rig.session.adjustSet(12, 22000, true);               // exercise B adjusted, never confirmed
    rig.session.finishEarly();
    Test.assert(rig.session.save(rig.outbox));
    var request = (rig.outbox.get(rig.session.uuid) as Dictionary)["b"] as Dictionary;
    Expect.equal((request["exercises"] as Array).size(), 1);
    return true;
}

(:test)
function endingEarlyKeepsWhatWasDoneAndCannotRunTwice(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    Test.assert(rig.session.finishEarly());
    Test.assert(rig.session.isFinished());
    Test.assert(!rig.session.finishEarly());
    Expect.equal(rig.session.setsDone(), 1);
    var resumed = rig.restart() as TrainingSession;       // still the finished workout after a restart
    Test.assert(resumed.isFinished());
    Expect.equal(resumed.setsDone(), 1);
    return true;
}

(:test)
function discardingARunningWorkoutLeavesNothingBehind(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    rig.session.adjustSet(7, 57500, true);
    rig.session.discard();
    Expect.equal(rig.store.values.size(), 0);
    Test.assert(rig.journal.activeId() == null);
    Test.assert(rig.restart() == null);
    return true;
}

(:test)
function skipWrittenButHeadNotYetSavedIsTakenOverAfterACrash(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    // The skip event is written, the app dies before the head moves on.
    rig.journal.appendEvent(rig.session.uuid, 0, { "k" => Journal.EVENT_SKIP, "e" => 0, "s" => 0, "d" => 0, "a" => rig.clock.now, "b" => rig.clock.now });
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.exercise().name, "Bizeps einarmig");
    Expect.equal(resumed.state, TrainingSession.STATE_PREVIEW);
    Expect.equal(resumed.events.size(), 2 - 1);
    return true;
}

// ---- list of sets, correction, undo ----

(:test)
function correctingAConfirmedSetReplacesItsValuesAndKeepsItsTimes(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.clock.now += 40;
    rig.session.confirmSet();                              // set 1: 8 x 60 kg
    rig.session.endRest();
    Test.assert(rig.session.doneSet(0) != null);
    Test.assert(rig.session.editSet(0, 9, 62500, false));
    var done = rig.session.doneSets();
    Expect.equal(done.size(), 1);
    Expect.field(done[0], "r", 9);
    Expect.field(done[0], "g", 62500);
    Expect.equal((done[0]["b"] as Number) - (done[0]["a"] as Number), 40);
    var kinds = rig.journal.events(rig.session.uuid);
    Expect.field(kinds[0], "k", Journal.EVENT_SET);        // the first event is not rewritten
    Expect.field(kinds[0], "r", 8);
    Expect.field(kinds[1], "k", Journal.EVENT_CORRECT);
    return true;
}

(:test)
function aCorrectionSurvivesACrashAndGoesIntoTheUpload(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    rig.session.editSet(0, 9, 62500, false);
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.doneSets().size(), 1);
    Expect.field(resumed.doneSets()[0], "r", 9);
    resumed.finishEarly();
    var request = WorkoutUpload.build(resumed, rig.clock.now + 10);
    var sets = ((request["exercises"] as Array)[0] as Dictionary)["sets"] as Array;
    Expect.equal(sets.size(), 1);
    Expect.field(sets[0] as Dictionary, "reps", 9);
    Expect.field(sets[0] as Dictionary, "load_g", 62500);
    return true;
}

(:test)
function openSetsOfTheListCanGetOtherValuesButNotWhileTheirRestRuns(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.session.confirmSet();                              // rest of set 1
    Test.assert(rig.session.editSet(2, 6, 50000, false));  // set 3 is open
    Expect.equal(rig.session.exercise().sets[2].reps, 6);
    Expect.equal(rig.session.exercise().sets[1].reps, 8);
    Test.assert(!rig.session.editSet(5, 6, 50000, false)); // no such set
    return true;
}

(:test)
function undoTakesTheLastSetBackAndTheSetCanBeConfirmedAgain(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    rig.session.confirmSet();                              // set 2, now in the rest
    Expect.equal(rig.session.setsDone(), 2);
    Test.assert(rig.session.canUndo());
    Test.assert(rig.session.undoLastSet());
    Expect.equal(rig.session.setsDone(), 1);
    Expect.equal(rig.session.state, TrainingSession.STATE_SET);
    Expect.equal(rig.session.setIdx, 1);
    Test.assert(rig.session.editSet(1, 5, 40000, false));
    Test.assert(rig.session.confirmSet());                 // the same set again, with new values
    Expect.equal(rig.session.setsDone(), 2);
    var done = rig.session.doneSets();
    Expect.field(done[1], "r", 5);
    Expect.field(done[1], "g", 40000);
    var request = WorkoutUpload.build(rig.session, rig.clock.now + 5);
    var sets = ((request["exercises"] as Array)[0] as Dictionary)["sets"] as Array;
    Expect.equal(sets.size(), 2);                          // the undone set is not in the upload twice
    return true;
}

(:test)
function undoCanGoBackIntoTheExerciseBefore(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) {
        rig.setAndRest();
    }
    Expect.equal(rig.session.state, TrainingSession.STATE_PREVIEW);   // exercise B
    Test.assert(rig.session.undoLastSet());
    Expect.equal(rig.session.exercise().name, "Bankdrücken");
    Expect.equal(rig.session.setIdx, 2);
    Expect.equal(rig.session.setsDone(), 2);
    return true;
}

(:test)
function undoNeedsAConfirmedSet(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    Test.assert(!rig.session.canUndo());
    Test.assert(!rig.session.undoLastSet());
    rig.toFirstSet();
    Test.assert(!rig.session.canUndo());
    return true;
}

(:test)
function undoSurvivesACrashAndSoDoesAnUndoWrittenBeforeTheHead(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    rig.toFirstSet();
    rig.setAndRest();
    rig.session.confirmSet();
    rig.session.undoLastSet();
    var resumed = rig.restart() as TrainingSession;
    Expect.equal(resumed.setsDone(), 1);
    Expect.equal(resumed.setIdx, 1);
    Expect.equal(resumed.state, TrainingSession.STATE_SET);
    // the undo event is written, but the head still shows the rest after set 2
    var late = new PlayerRig(false);
    late.toFirstSet();
    late.setAndRest();
    late.session.confirmSet();
    late.journal.appendEvent(late.session.uuid, 2, { "k" => Journal.EVENT_UNDO, "e" => 0, "s" => 1, "d" => 0, "a" => late.clock.now, "b" => late.clock.now });
    var recovered = late.restart() as TrainingSession;
    Expect.equal(recovered.setsDone(), 1);
    Expect.equal(recovered.state, TrainingSession.STATE_SET);
    Expect.equal(recovered.setIdx, 1);
    return true;
}
