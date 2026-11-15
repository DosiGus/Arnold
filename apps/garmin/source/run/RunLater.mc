import Toybox.Lang;
import Toybox.Timer;

// Runs one step a moment later, after the current input has been handled.
//
// Why: a WatchUi.Confirmation closes itself (popView) only after its onResponse returned. A view pushed inside
// onResponse is therefore the one that gets closed, and the question stays on screen (seen on a Forerunner 255,
// 15.11.2026: "Noch kein GPS. Trotzdem starten?" did nothing). Steps that open a view after a question go
// through here instead. The timer lives in this module, so it is not collected before it fires; a newer step
// replaces an older one that has not fired yet, so one answer never starts twice.
module RunLater {
    const DELAY_MS as Number = 60;

    var timer as Timer.Timer or Null = null;

    function call(step as Method() as Void) as Void {
        if (timer != null) {
            (timer as Timer.Timer).stop();
        }
        timer = new Timer.Timer();
        (timer as Timer.Timer).start(step, DELAY_MS, false);
    }
}
