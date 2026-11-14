import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// The beat of a run: once a second the session counts, then the screen is drawn once. It lives as long as the
// run, not as long as one view: a menu on top of the run display must not stop the counting.
class RunTicker {
    private var _session as RunSession;
    private var _view as RunView or Null;
    private var _timer as Timer.Timer or Null;

    function initialize(session as RunSession, view as RunView or Null) {
        _session = session;
        _view = view;
        _timer = null;
    }

    function start() as Void {
        if (_timer == null) {
            _timer = new Timer.Timer();
            (_timer as Timer.Timer).start(method(:onSecond), 1000, true);
        }
    }

    function stop() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
        _view = null;
    }

    function isRunning() as Boolean {
        return _timer != null;
    }

    // One second. In the energy saving mode of an AMOLED watch nothing is redrawn (the watch draws once a minute).
    function onSecond() as Void {
        _session.tick();
        var view = _view;
        if (view == null || !(view as RunView).isReduced()) {
            WatchUi.requestUpdate();
        }
    }
}

// Shows the run: page by page (UP and DOWN), once a second. On an AMOLED watch the energy saving mode shows a
// reduced picture (Garmin's rules against burn-in: few lit pixels, dark, moved a little every minute).
class RunView extends WatchUi.View {
    private var _session as RunSession;
    private var _ticker as RunTicker;
    private var _page as Number;
    private var _sleeping as Boolean;

    function initialize(session as RunSession) {
        View.initialize();
        _session = session;
        _ticker = new RunTicker(session, self);
        _page = 0;
        _sleeping = false;
    }

    function ticker() as RunTicker {
        return _ticker;
    }

    function page() as Number {
        return _page;
    }

    // delta = +1 for DOWN, -1 for UP; wraps around.
    function movePage(delta as Number) as Void {
        var count = RunPages.pageCount(_session);
        _page = ((_page + delta) % count + count) % count;
    }

    function onShow() as Void {
        _ticker.start();
    }

    function onEnterSleep() as Void {
        _sleeping = true;
        WatchUi.requestUpdate();
    }

    function onExitSleep() as Void {
        _sleeping = false;
        WatchUi.requestUpdate();
    }

    // True while the watch is in the energy saving mode of a display that burns in (AMOLED).
    function isReduced() as Boolean {
        return _sleeping && RunView.needsBurnInProtection();
    }

    static function needsBurnInProtection() as Boolean {
        var settings = System.getDeviceSettings();
        return settings has :requiresBurnInProtection && settings.requiresBurnInProtection;
    }

    function onUpdate(dc as Dc) as Void {
        if (isReduced()) {
            var minute = System.getClockTime().min;
            RunLayout.draw(dc, RunPages.sleepLines(_session), -1, shift(minute, dc.getWidth()), shift(minute / 5, dc.getHeight()));
            return;
        }
        var page = RunPages.build(dc, _session, _page);
        RunLayout.draw(dc, page.lines, page.zone, 0, 0);
    }

    // Moves the reduced picture by a few pixels in steps, so no pixel keeps the same value for long.
    static function shift(step as Number, size as Number) as Number {
        var unit = size / 60 + 1;
        return ((step % 5) - 2) * unit;
    }
}
