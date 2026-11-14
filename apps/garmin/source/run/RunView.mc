import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// Texts of a run on the display. No state: the numbers come in as parameters.
module RunText {
    // "mm:ss", from one hour "h:mm:ss".
    function clock(seconds as Number) as String {
        var s = seconds < 0 ? 0 : seconds;
        var h = s / 3600;
        var m = (s % 3600) / 60;
        if (h > 0) {
            return h.toString() + ":" + m.format("%02d") + ":" + (s % 60).format("%02d");
        }
        return m.format("%02d") + ":" + (s % 60).format("%02d");
    }

    // Distance in km with two decimals and the decimal sign of the language.
    function km(cm as Number) as String {
        var hundredths = cm / 1000;
        return (hundredths / 100).toString() + HomeScreen.text(Rez.Strings.RunSep) + (hundredths % 100).format("%02d");
    }

    // "5,42 km", or "5,42 km (geschätzt)" when the distance is the watch's estimate.
    function distance(cm as Number, estimated as Boolean) as String {
        return Lang.format(HomeScreen.text(estimated ? Rez.Strings.RunKmEst : Rez.Strings.RunKm), [km(cm)]);
    }
}

// The stand-in display of a run (RUN-015; RUN-016 builds the real one): time, distance, segment.
module RunScreen {
    function lines(dc as Dc, session as RunSession) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(segmentText(session), Graphics.FONT_TINY, Graphics.COLOR_LT_GRAY));
        out.add(PairingLayout.bigLine(dc, RunText.clock(session.calc.timerS), Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunText.distance(session.calc.distanceCm, session.distanceIsEstimated()), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        if (session.state == RunSession.STATE_AUTO_PAUSED) {
            out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunAutoPaused), Graphics.FONT_TINY, Graphics.COLOR_ORANGE));
        } else if (session.state == RunSession.STATE_PAUSED) {
            out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunPaused), Graphics.FONT_TINY, Graphics.COLOR_ORANGE));
        }
        return out;
    }

    // "Abschnitt 3/8", "Plan fertig" after the last segment, "Freier Lauf" without segments.
    function segmentText(session as RunSession) as String {
        if (session.plan.count() == 0) {
            return HomeScreen.text(Rez.Strings.RunType13);
        }
        if (session.isPlanDone()) {
            return HomeScreen.text(Rez.Strings.RunPlanDone);
        }
        return Lang.format(HomeScreen.text(Rez.Strings.RunSegmentOf), [session.segmentNumber(), session.plan.count()]);
    }
}

// Shows the run and drives it: the timer calls `tick` once a second, the screen is drawn once after it.
class RunView extends WatchUi.View {
    private var _session as RunSession;
    private var _timer as Timer.Timer or Null;

    function initialize(session as RunSession) {
        View.initialize();
        _session = session;
        _timer = null;
    }

    function onShow() as Void {
        if (_timer == null) {
            _timer = new Timer.Timer();
            (_timer as Timer.Timer).start(method(:onSecond), 1000, true);
        }
    }

    function onHide() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
    }

    function onSecond() as Void {
        _session.tick();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, RunScreen.lines(dc, _session));
    }
}

// Placeholder keys (RUN-016 replaces them): START pauses and continues, the lap key ends the segment,
// BACK in a pause saves the run and leaves; while running it does nothing, so a run is never left by accident.
class RunDelegate extends WatchUi.BehaviorDelegate {
    private var _session as RunSession;

    function initialize(session as RunSession) {
        BehaviorDelegate.initialize();
        _session = session;
    }

    function onSelect() as Boolean {
        if (_session.isPaused()) {
            _session.resume();
        } else {
            _session.pause();
        }
        WatchUi.requestUpdate();
        return true;
    }

    function onKey(event as WatchUi.KeyEvent) as Boolean {
        if (event.getKey() == WatchUi.KEY_LAP) {
            _session.nextSegment();
            WatchUi.requestUpdate();
            return true;
        }
        return BehaviorDelegate.onKey(event);
    }

    function onBack() as Boolean {
        if (_session.isPaused()) {
            _session.save();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
        return true;
    }
}
