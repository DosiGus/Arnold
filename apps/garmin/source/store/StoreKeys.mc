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

    const RUN_UPCOMING as String = "run:up";   // planned runs of today and the next six days (RUN-012)

    const RUN_ACTIVE as String = "run:active";   // uuid of the run in progress (or finished, not yet sent), RUN-015

    // State of a run being recorded (RUN-015): small head entry, the prescription it runs on (a copy), and the
    // 100 m splits in chunks of 60.
    function runHead(runUuid as String) as String {
        return "run:" + runUuid + ":h";
    }

    function runCopy(runUuid as String) as String {
        return "run:" + runUuid + ":p";
    }

    function runSplits(runUuid as String, chunk as Number) as String {
        return "run:" + runUuid + ":s" + chunk.toString();
    }

    // What the summary needs besides the head: the finished segments, pauses, end of the run, the corrected distance (RUN-018).
    function runExtra(runUuid as String) as String {
        return "run:" + runUuid + ":g";
    }

    // The prescription of one planned run, stored on its own like a plan day.
    function runPrescription(runId as String) as String {
        return "run:p:" + runId;
    }

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

    const RUN_OUTBOX_INDEX as String = "rout:index";   // ids of the run results waiting to be sent, oldest first (RUN-018)

    // A finished run waiting to be sent: the frozen request and what follows it (RUN-018).
    function runOutbox(id as String) as String {
        return "rout:" + id;
    }

    const HEALTH_CONSENT as String = "health:consent";   // { "v": consent of the account, "t": asked at }
    const HEALTH_INDEX as String = "hout:index";         // ids of the health requests waiting to be sent

    // A frozen health request (GAR-B4-02).
    function healthOutbox(id as String) as String {
        return "hout:" + id;
    }

    // One block of heart rate values.
    function heartRateBlock(sessionUuid as String, index as Number) as String {
        return "hr:" + sessionUuid + ":" + index.toString();
    }
}
