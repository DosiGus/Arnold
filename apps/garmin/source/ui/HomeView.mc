import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Start screen (UMSETZUNG 7.3, PRD P-01 to P-06): the next training day with
// its exercise count, estimated duration and the age of the plan. Before the
// watch is connected it shows the pairing screens. The plan is shown from the
// stored copy at once and refreshed in the background.
class HomeView extends WatchUi.View {
    private var _controller as PairingController;
    private var _sync as PlanSync;
    private var _picker as SessionPicker;
    private var _clock as PairingClock;
    private var _launcher as TrainingLauncher;
    private var _run as RunHome;

    function initialize(controller as PairingController, sync as PlanSync, picker as SessionPicker, launcher as TrainingLauncher, run as RunHome) {
        View.initialize();
        _controller = controller;
        _sync = sync;
        _picker = picker;
        _launcher = launcher;
        _run = run;
        _clock = new PairingClock();
    }

    function onShow() as Void {
        _controller.setObserver(method(:onChanged));
        _sync.setObserver(method(:onChanged));
        _run.sync.setObserver(method(:onChanged));
        _launcher.sender().setObserver(method(:onSendChanged));
        syncIfNeeded();
        if (_controller.isPaired()) {
            _launcher.sender().sendAll();   // workouts that are still waiting go out when the app opens
            SyncPrompts.check(_launcher.sender());
            SyncPrompts.checkStale(_launcher.sender(), _clock.nowSeconds());
        }
    }

    function onSendChanged() as Void {
        WatchUi.requestUpdate();
        SyncPrompts.check(_launcher.sender());
    }

    function onHide() as Void {
        _controller.setObserver(null);
        _sync.setObserver(null);
        _run.sync.setObserver(null);
        _launcher.sender().setObserver(null);
    }

    function onChanged() as Void {
        syncIfNeeded();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        var running = _launcher.activeName();
        var pending = _launcher.sender().pendingCount();
        if (_controller.isPaired() && running != null) {
            PairingLayout.draw(dc, HomeScreen.withPending(HomeScreen.resumeLines(running as String), pending));
        } else if (_controller.isPaired()) {
            PairingLayout.draw(dc, HomeScreen.withPending(HomeScreen.stopLines(dc, _sync, _run, _picker, _clock.nowSeconds()), pending));
        } else {
            PairingLayout.draw(dc, PairingScreen.lines(dc, _controller));
        }
    }

    // Loads the plan when the app opens and after connecting (again).
    hidden function syncIfNeeded() as Void {
        if (!_controller.isPaired()) {
            return;
        }
        if (_sync.state == PlanSync.SYNC_IDLE || (_sync.state == PlanSync.SYNC_FAILED && _sync.problem == PlanSync.PROBLEM_AUTH)) {
            _sync.start();
        }
        if (_run.sync.state == RunSync.RUN_IDLE || (_run.sync.state == RunSync.RUN_FAILED && _run.sync.problem == RunSync.RUN_PROBLEM_AUTH)) {
            _run.sync.start();
        }
    }
}

// What the start screen says. Texts come from the string resources.
module HomeScreen {

    function text(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }

    // How current the plan is, or what the watch is doing about it.
    function statusLine(sync as PlanSync, now as Number) as PairingLine {
        var gray = Graphics.COLOR_LT_GRAY;
        var alert = Graphics.COLOR_YELLOW;
        if (sync.isPhoneMissing()) {
            return new PairingLine(text(Rez.Strings.HomeNoPhone), Graphics.FONT_XTINY, alert);
        }
        if (sync.state == PlanSync.SYNC_LOADING) {
            return new PairingLine(text(Rez.Strings.HomeUpdating), Graphics.FONT_XTINY, gray);
        }
        var fetched = sync.cache.fetchedAt();
        var age = ageText(fetched == null ? 0 : now - (fetched as Number));
        var offline = sync.state == PlanSync.SYNC_FAILED && sync.problem == PlanSync.PROBLEM_UNREACHABLE;
        var template = text(offline ? Rez.Strings.HomePlanAgeOffline : Rez.Strings.HomePlanAge);
        return new PairingLine(Lang.format(template, [age]), Graphics.FONT_XTINY, offline ? alert : gray);
    }

    // The start screen: "Today" (training of the plan, runs planned today), then "Free run".
    // The selected row is white with a marker, the others gray.
    function stopLines(dc as Dc, sync as PlanSync, run as RunHome, picker as SessionPicker, now as Number) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        if (sync.cache.directory() != null) {
            out.add(statusLine(sync, now).skippable());
        }
        var rows = run.stops(sync, picker);
        var selected = run.selectedIndex(rows, sync);
        // One font for all rows: the smaller one when a row would be cut in the larger one
        // (wide fonts such as on the AMOLED watches), so the minutes stay readable.
        var rowFont = Graphics.FONT_TINY;
        for (var r = 0; r < rows.size(); r++) {
            if (dc.getTextWidthInPixels(text(Rez.Strings.HomeMarker) + " " + rows[r].text, Graphics.FONT_TINY) > PairingLayout.textWidth(dc)) {
                rowFont = Graphics.FONT_XTINY;
            }
        }
        var freeHeader = false;
        var todayHeader = false;
        for (var i = 0; i < rows.size(); i++) {
            var kind = rows[i].kind;
            if (!todayHeader && kind != HomeStop.STOP_RUN_RESUME) {
                todayHeader = true;
                out.add(new PairingLine(text(Rez.Strings.HomeToday), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable());
            }
            if (!freeHeader && (kind == HomeStop.STOP_FREE || kind == HomeStop.STOP_ZONE2)) {
                freeHeader = true;
                out.add(new PairingLine(text(Rez.Strings.HomeFreeRun), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable());
            }
            var chosen = i == selected;
            var row = chosen ? text(Rez.Strings.HomeMarker) + " " + rows[i].text : rows[i].text;
            out.add(new PairingLine(PairingLayout.ellipsize(dc, row, rowFont, PairingLayout.textWidth(dc)), rowFont, chosen ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY));
        }
        return out;
    }

    function lines(dc as Dc, sync as PlanSync, picker as SessionPicker, now as Number) as Array<PairingLine> {
        var white = Graphics.COLOR_WHITE;
        var gray = Graphics.COLOR_LT_GRAY;
        var alert = Graphics.COLOR_YELLOW;
        var out = [] as Array<PairingLine>;
        var dir = sync.cache.directory();
        if (dir == null) {
            return noPlanLines(sync);
        }
        var day = picker.selectedDay(dir) as Dictionary;
        out.add(statusLine(sync, now));
        var index = picker.selectedIndex(dir);
        var count = ((dir as Dictionary)["days"] as Array).size();
        out.add(new PairingLine(day["n"] as String, Graphics.FONT_MEDIUM, white));
        out.add(new PairingLine(exercisesText(day), Graphics.FONT_SMALL, gray));
        var minutes = minutesText(day);
        if (minutes != null) {
            out.add(new PairingLine(minutes as String, Graphics.FONT_SMALL, gray));
        }
        if (sync.cache.dayState(day) == PlanCache.DAY_MISSING) {
            out.add(new PairingLine(text(Rez.Strings.HomeDayNotLoaded), Graphics.FONT_XTINY, alert));
        } else if (picker.isNextDay(dir)) {
            out.add(new PairingLine(text(Rez.Strings.HomeNext), Graphics.FONT_XTINY, white));
            out.add(new PairingLine(text(Rez.Strings.HomeStartHint), Graphics.FONT_XTINY, gray));
        } else {
            out.add(new PairingLine(Lang.format(text(Rez.Strings.HomeDayOf), [index + 1, count]), Graphics.FONT_XTINY, gray));
            out.add(new PairingLine(text(Rez.Strings.HomeStartHint), Graphics.FONT_XTINY, gray));
        }
        return out;
    }

    // "1 workout waiting": workouts saved on the watch that the server has not confirmed yet (PRD S-05).
    function withPending(lines as Array<PairingLine>, pending as Number) as Array<PairingLine> {
        if (pending > 0) {
            lines.add(new PairingLine(Lang.format(text(pending == 1 ? Rez.Strings.HomePending : Rez.Strings.HomePendingMany), [pending]), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW));
        }
        return lines;
    }

    // A workout is running (or was interrupted): offer to continue it.
    function resumeLines(name as String) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(text(Rez.Strings.HomeResume), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW));
        out.add(new PairingLine(name, Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(text(Rez.Strings.HomeResumeHint), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        return out;
    }

    // Nothing stored: loading, or why there is no plan.
    function noPlanLines(sync as PlanSync) as Array<PairingLine> {
        var white = Graphics.COLOR_WHITE;
        var gray = Graphics.COLOR_LT_GRAY;
        var alert = Graphics.COLOR_YELLOW;
        var out = [] as Array<PairingLine>;
        if (sync.state == PlanSync.SYNC_FAILED || sync.state == PlanSync.SYNC_DONE) {
            if (sync.problem == PlanSync.PROBLEM_NO_PLAN) {
                out.add(new PairingLine(text(Rez.Strings.HomeNoPlan), Graphics.FONT_MEDIUM, alert));
                out.add(new PairingLine(text(Rez.Strings.HomeNoPlanHint), Graphics.FONT_XTINY, gray));
            } else if (sync.problem == PlanSync.PROBLEM_SETUP) {
                out.add(new PairingLine(text(Rez.Strings.HomeSetup), Graphics.FONT_MEDIUM, alert));
                out.add(new PairingLine(text(Rez.Strings.HomeSetupHint), Graphics.FONT_XTINY, gray));
            } else if (sync.problem == PlanSync.PROBLEM_UPGRADE) {
                out.add(new PairingLine(text(Rez.Strings.PairUpgrade), Graphics.FONT_MEDIUM, alert));
                out.add(new PairingLine(text(Rez.Strings.PairUpgradeHint), Graphics.FONT_XTINY, gray));
            } else {
                out.add(new PairingLine(text(Rez.Strings.HomeNoPlanLoaded), Graphics.FONT_MEDIUM, alert));
                out.add(new PairingLine(text(Rez.Strings.PairPhone), Graphics.FONT_XTINY, gray));
                out.add(new PairingLine(text(Rez.Strings.PairRetry), Graphics.FONT_SMALL, white));
            }
            return out;
        }
        out.add(new PairingLine(text(sync.isPhoneMissing() ? Rez.Strings.HomeNoPhone : Rez.Strings.HomeLoading), Graphics.FONT_SMALL, sync.isPhoneMissing() ? alert : white));
        return out;
    }

    // "6 exercises"
    function exercisesText(day as Dictionary) as String {
        var count = day["c"] as Number;
        return Lang.format(text(count == 1 ? Rez.Strings.HomeExerciseOne : Rez.Strings.HomeExercises), [count]);
    }

    // "55 min"; null when the server does not know the duration (unknown stays unknown).
    function minutesText(day as Dictionary) as String or Null {
        var minutes = day["m"];
        if (minutes instanceof Number) {
            return Lang.format(text(Rez.Strings.HomeMinutes), [minutes as Number]);
        }
        return null;
    }

    // "2 h ago", "3 d ago"
    function ageText(seconds as Number) as String {
        var age = seconds > 0 ? seconds : 0;
        if (age < 60) {
            return text(Rez.Strings.AgeNow);
        }
        if (age < 3600) {
            return Lang.format(text(Rez.Strings.AgeMinutes), [age / 60]);
        }
        if (age < 172800) {
            return Lang.format(text(Rez.Strings.AgeHours), [age / 3600]);
        }
        return Lang.format(text(Rez.Strings.AgeDays), [age / 86400]);
    }
}

// The views of the app: the start screen and its buttons, sharing one day picker.
module HomeFlow {
    function views() as [WatchUi.Views, WatchUi.InputDelegates] {
        var picker = new SessionPicker();
        var sync = Session.planSync();
        var launcher = Session.launcher();
        var run = new RunHome(Session.runSync(), new PairingClock(), new PreStartLauncher());
        run.journal = new RunJournal(new KeyValueStore());
        return [new HomeView(Session.pairing(), sync, picker, launcher, run), new HomeDelegate(Session.pairing(), sync, picker, launcher, run)];
    }
}
