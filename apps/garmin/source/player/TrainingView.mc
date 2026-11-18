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
        if (_session.state == TrainingSession.STATE_SET || _session.state == TrainingSession.STATE_REST) {
            SummaryScroll.first = 0;
            Instrument.draw(dc, TrainingScreen.face(_session, LiveHeart.current(), TrainingPages.current(_session)));
            return;
        }
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

// Which page of the set or rest is shown: 0 the values, 1 the heart rate (and last time).
// Back to page 0 whenever the set, the exercise or the state changes.
module TrainingPages {
    var page as Number = 0;
    var _key as Number = -1;

    function current(session as TrainingSession) as Number {
        var key = session.state * 10000 + session.exIdx * 100 + session.setIdx;
        if (key != _key) {
            _key = key;
            page = 0;
        }
        return page;
    }

    function toggle(session as TrainingSession) as Void {
        page = current(session) == 0 ? 1 : 0;
    }
}

// Which screen belongs to which state.
module TrainingScreen {

    // The Instrument face of a set or a rest.
    function face(session as TrainingSession, heartRate as Number or Null, page as Number) as InstrumentFace {
        if (session.state == TrainingSession.STATE_SET) {
            return SetScreen.face(session, heartRate, page);
        }
        return RestScreen.face(session, heartRate, page);
    }

    function lines(dc as Dc, session as TrainingSession, heartRate as Number or Null, sender as OutboxSender or Null) as Array<PairingLine> {
        if (session.state == TrainingSession.STATE_PREVIEW) {
            return PreviewScreen.lines(dc, session);
        }
        return SummaryScreen.lines(dc, session, sender);
    }
}
