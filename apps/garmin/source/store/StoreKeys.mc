import Toybox.Lang;

// Storage keys (UMSETZUNG 7.3; plan split per 07 D-22). Every value stays below 32 KB.
(:background)
module StoreKeys {
    const SCHEMA as String = "schema";       // schema version number
    const AUTH as String = "auth";           // token, device_id, account_label
    const PLAN as String = "plan";           // plan directory with ETag and fetch time
    const PLAN_RECENT as String = "plan:recent";
    const SETTINGS as String = "settings";   // vibration, sound, warning
    const ACTIVE_SESSION as String = "sess:active";   // uuid of the workout in progress, if any
    const OUTBOX_INDEX as String = "out:index";       // ids of the frozen upload requests, oldest first

    // One training day of the plan, stored on its own (07 D-22).
    function planDay(sessionId as String) as String {
        return "plan:day:" + sessionId;
    }

    // State of a running or saved workout.
    function sessionHead(sessionUuid as String) as String {
        return "sess:" + sessionUuid + ":head";
    }

    // The copy of the training day a workout runs on (a plan change later does not touch it).
    function sessionPlan(sessionUuid as String) as String {
        return "sess:" + sessionUuid + ":plan";
    }

    // One set event of the journal: confirmed, corrected or removed.
    function sessionEvent(sessionUuid as String, index as Number) as String {
        return "sess:" + sessionUuid + ":" + index.toString();
    }

    // A frozen upload request.
    function outbox(id as String) as String {
        return "out:" + id;
    }

    // One block of heart rate values.
    function heartRateBlock(sessionUuid as String, index as Number) as String {
        return "hr:" + sessionUuid + ":" + index.toString();
    }
}
