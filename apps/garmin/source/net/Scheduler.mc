import Toybox.Lang;
import Toybox.Timer;

// One timer slot: the client either waits for an answer (timeout) or for the
// next try (pause), never both. Tests replace it with a fake clock.
class Scheduler {
    private var _timer as Timer.Timer or Null;

    function initialize() {
        _timer = null;
    }

    function schedule(delayMs as Number, callback as Method() as Void) as Void {
        cancel();
        var timer = new Timer.Timer();
        timer.start(callback, delayMs, false);
        _timer = timer;
    }

    function cancel() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
    }
}
