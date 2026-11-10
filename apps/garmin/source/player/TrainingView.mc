import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// The training screen: shows the preview, the set, the rest or the end of the
// workout. A timer every second moves the countdown, the rest signals and the heart rate.
class TrainingView extends WatchUi.View {
    private var _session as TrainingSession;
    private var _timer as Timer.Timer or Null;

    function initialize(session as TrainingSession) {
        View.initialize();
        _session = session;
        _timer = null;
    }

    function onShow() as Void {
        LiveHeart.enable();
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
        _session.tick();
    }

    function onHide() as Void {
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
        PairingLayout.draw(dc, TrainingScreen.lines(dc, _session, LiveHeart.current()));
    }
}

// Which screen belongs to which state.
module TrainingScreen {

    function lines(dc as Dc, session as TrainingSession, heartRate as Number or Null) as Array<PairingLine> {
        if (session.state == TrainingSession.STATE_PREVIEW) {
            return PreviewScreen.lines(dc, session);
        }
        if (session.state == TrainingSession.STATE_SET) {
            return SetScreen.lines(dc, session, heartRate);
        }
        if (session.state == TrainingSession.STATE_REST) {
            return RestScreen.lines(dc, session, heartRate);
        }
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(TrainingText.text(Rez.Strings.TrFinished), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.TrSetsDone), [session.setsDone()]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
        out.add(new PairingLine(TrainingText.text(Rez.Strings.TrSummaryFollows), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY));
        return out;
    }
}
