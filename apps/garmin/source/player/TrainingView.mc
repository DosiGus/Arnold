import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// The training screen: shows the preview, the set, the rest or the end of the
// workout. A timer every second moves the countdown, the rest signals and the heart rate.
class TrainingView extends WatchUi.View {
    private var _session as TrainingSession;
    private var _sender as OutboxSender;
    private var _timer as Timer.Timer or Null;

    function initialize(session as TrainingSession, sender as OutboxSender) {
        View.initialize();
        _session = session;
        _sender = sender;
        _timer = null;
    }

    function onShow() as Void {
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
        _session.tick();
        _sender.setObserver(method(:onSendChanged));
    }

    // The sending moved on: redraw, and ask what needs an answer.
    function onSendChanged() as Void {
        WatchUi.requestUpdate();
        SyncPrompts.check(_sender);
    }

    function onHide() as Void {
        _sender.setObserver(null);
        LiveHeart.disable();
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        _session.tick();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        var lines = TrainingScreen.lines(dc, _session, LiveHeart.current(), _sender);
        if (_session.isFinished()) {
            // The summary can be longer than the display: UP and DOWN scroll it (TrainingDelegate).
            SummaryScroll.first = PairingLayout.drawFrom(dc, lines, SummaryScroll.first);
        } else {
            SummaryScroll.first = 0;
            PairingLayout.draw(dc, lines);
        }
    }
}

// Where the summary after a workout is scrolled to (first line shown). Reset while the workout runs.
module SummaryScroll {
    var first as Number = 0;

    function by(delta as Number) as Void {
        first = first + delta < 0 ? 0 : first + delta;   // the view holds it below the end when it draws
    }
}

// Which screen belongs to which state.
module TrainingScreen {

    function lines(dc as Dc, session as TrainingSession, heartRate as Number or Null, sender as OutboxSender or Null) as Array<PairingLine> {
        if (session.state == TrainingSession.STATE_PREVIEW) {
            return PreviewScreen.lines(dc, session);
        }
        if (session.state == TrainingSession.STATE_SET) {
            return SetScreen.lines(dc, session, heartRate);
        }
        if (session.state == TrainingSession.STATE_REST) {
            return RestScreen.lines(dc, session, heartRate);
        }
        return SummaryScreen.lines(dc, session, sender);
    }
}
