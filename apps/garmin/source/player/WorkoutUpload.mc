import Toybox.Lang;

// Builds the upload request of a finished workout (UMSETZUNG 3.3, 07 D-08, D-11):
// one call with every exercise and its sets, weights in whole grams, the calendar
// date and the UTC offset of the watch. Exercises that were not touched are left
// out; the server counts them as skipped. The result is frozen by the outbox and
// never changed afterwards.
module WorkoutUpload {

    function build(session as TrainingSession, endedAt as Number) as Dictionary {
        var started = session.sessionStart();
        var offset = session.utcOffsetMinutes();
        var exercises = [] as Array;
        var done = session.doneSets();
        var seen = [] as Array<Number>;
        for (var i = 0; i < done.size(); i++) {
            if (seen.indexOf(done[i]["e"] as Number) < 0) {
                seen.add(done[i]["e"] as Number);
            }
        }
        var skipped = WorkoutEvents.skipped(session.events);
        for (var i = 0; i < skipped.size(); i++) {
            if (seen.indexOf(skipped[i]) < 0) {
                seen.add(skipped[i]);
            }
        }
        seen.sort(null);
        var last = endedAt;
        for (var x = 0; x < seen.size(); x++) {
            var ex = session.plan.exercises[seen[x]];
            var sets = [] as Array;
            for (var i = 0; i < done.size(); i++) {
                var event = done[i];
                if ((event["e"] as Number) != seen[x]) {
                    continue;
                }
                sets.add({
                    "reps" => event["r"],
                    "load_g" => event["g"],
                    "side" => PlannedSet.sideName(event["d"] as Number),
                    "t0" => event["a"],
                    "t1" => event["b"]
                });
                if ((event["b"] as Number) > last) {
                    last = event["b"] as Number;
                }
            }
            if (sets.size() > 0) {
                exercises.add({ "plan_item_id" => ex.planItemId, "exercise_id" => ex.exerciseId, "sets" => sets });
            } else {
                exercises.add({ "plan_item_id" => ex.planItemId, "skip" => true });
            }
        }
        return {
            "request_id" => "gw_" + Uuid.v4(),
            "session_uuid" => session.uuid,
            "plan_version_id" => session.plan.planVersion,
            "session_id" => session.plan.dayId,
            "workout_date_local" => Clock.localDate(started, offset),
            "utc_offset_min" => offset,
            "started_at_utc" => Clock.isoUtc(started),
            "ended_at_utc" => Clock.isoUtc(last),
            "exercises" => exercises
        };
    }
}
