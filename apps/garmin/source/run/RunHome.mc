import Toybox.Lang;
import Toybox.WatchUi;

// One thing the start screen offers: the training of the plan, a planned run of today,
// or a free run (open, or in zone 2). UP and DOWN move between them, START opens one.
class HomeStop {
    enum Kind {
        STOP_RUN_RESUME,   // a run that was interrupted (crash, forced exit): "Resume run"
        STOP_STRENGTH,
        STOP_RUN,
        STOP_FREE,
        STOP_ZONE2
    }

    var kind as Number;
    var id as String;      // id of the planned run, else ""
    var text as String;    // the row as shown
    var labeled as Boolean; // the row names itself ("Free run · Zone 2"), so it sits under no section header

    function initialize(stopKind as Number, runId as String, rowText as String) {
        kind = stopKind;
        id = runId;
        text = rowText;
        labeled = false;
    }

    // Stable name of the stop, so the selection stays on it when the screen refreshes.
    function key() as String {
        return kind.toString() + ":" + id;
    }
}

// What the start screen shows below "Today" and "Free run", and which row is selected.
// Free runs are always there, also without a plan and without a connection.
// Default selection: the first run planned today, otherwise the training, otherwise "Open".
class RunHome {
    var sync as RunSync;
    var journal as RunJournal or Null;   // set when the app opens; without it no interrupted run is offered
    private var _clock as PairingClock;
    private var _opener as PreStartLauncher;
    private var _selected as String or Null;

    function initialize(runSync as RunSync, clock as PairingClock, opener as PreStartLauncher) {
        sync = runSync;
        journal = null;
        _clock = clock;
        _opener = opener;
        _selected = null;
    }

    function opener() as PreStartLauncher {
        return _opener;
    }

    // Whether a run waits to be continued: the journal knows an active run that is not saved and whose head is intact.
    function hasInterruptedRun() as Boolean {
        var runJournal = journal;
        return runJournal != null && (runJournal as RunJournal).hasInterrupted();
    }

    // The rows in order: an interrupted run, training, free run, runs of today, zone 2.
    // Without a run today: training, then the section "Free run" with free run and zone 2.
    // With a run today the free runs flank the first planned run, so that from the selected
    // row every free run is one key away (UP: free run, DOWN: zone 2) and starts in three keys;
    // the planned run stays one key and the training moves to two keys away. The free rows then
    // carry their own label instead of a section header.
    function stops(plan as PlanSync, picker as SessionPicker) as Array<HomeStop> {
        var out = [] as Array<HomeStop>;
        if (hasInterruptedRun()) {
            out.add(new HomeStop(HomeStop.STOP_RUN_RESUME, "", HomeScreen.text(Rez.Strings.HomeRunResume)));
        }
        out.add(new HomeStop(HomeStop.STOP_STRENGTH, "", strengthText(plan, picker)));
        var runs = sync.cache.todayRuns(_clock.nowSeconds(), _clock.utcOffsetMinutes());
        var free = new HomeStop(HomeStop.STOP_FREE, "", HomeScreen.text(Rez.Strings.HomeFreeOpen));
        var zone2 = new HomeStop(HomeStop.STOP_ZONE2, "", HomeScreen.text(Rez.Strings.HomeFreeZone2));
        if (runs.size() > 0) {
            free.text = HomeScreen.text(Rez.Strings.HomeFreeRun) + " · " + free.text;
            zone2.text = HomeScreen.text(Rez.Strings.HomeFreeRun) + " · " + zone2.text;
            free.labeled = true;
            zone2.labeled = true;
            out.add(free);
        }
        for (var i = 0; i < runs.size(); i++) {
            var run = runs[i];
            var row = Lang.format(HomeScreen.text(Rez.Strings.HomeRunRow), [withMinutes(run["n"] as String, run["m"] as Object or Null)]);
            out.add(new HomeStop(HomeStop.STOP_RUN, run["id"] as String, row));
        }
        if (runs.size() == 0) {
            out.add(free);
        }
        out.add(zone2);
        return out;
    }

    // Index of the selected row.
    function selectedIndex(rows as Array<HomeStop>, plan as PlanSync) as Number {
        if (_selected != null) {
            for (var i = 0; i < rows.size(); i++) {
                if (rows[i].key().equals(_selected as String)) {
                    return i;
                }
            }
        }
        if (rows[0].kind == HomeStop.STOP_RUN_RESUME) {
            return 0;    // a run that was cut off comes first: it is the one thing that must not be lost
        }
        for (var j = 0; j < rows.size(); j++) {
            if (rows[j].kind == HomeStop.STOP_RUN) {
                return j;
            }
        }
        if (plan.cache.directory() != null) {
            return 0;
        }
        for (var k = 0; k < rows.size(); k++) {
            if (rows[k].kind == HomeStop.STOP_FREE) {
                return k;
            }
        }
        return 0;
    }

    function selectedStop(rows as Array<HomeStop>, plan as PlanSync) as HomeStop {
        return rows[selectedIndex(rows, plan)];
    }

    // delta = +1 for DOWN, -1 for UP; wraps around.
    function move(rows as Array<HomeStop>, plan as PlanSync, delta as Number) as Void {
        var count = rows.size();
        var target = ((selectedIndex(rows, plan) + delta) % count + count) % count;
        _selected = rows[target].key();
    }

    // "Strength: Push A · 55 min", or why there is no plan (START loads it again).
    hidden function strengthText(plan as PlanSync, picker as SessionPicker) as String {
        var dir = plan.cache.directory();
        if (dir == null) {
            if (plan.state == PlanSync.SYNC_FAILED || plan.state == PlanSync.SYNC_DONE) {
                if (plan.problem == PlanSync.PROBLEM_NO_PLAN) {
                    return HomeScreen.text(Rez.Strings.HomeNoPlan);
                }
                if (plan.problem == PlanSync.PROBLEM_SETUP) {
                    return HomeScreen.text(Rez.Strings.HomeSetup);
                }
                return HomeScreen.text(Rez.Strings.HomeNoPlanLoaded);
            }
            return HomeScreen.text(Rez.Strings.HomeLoading);
        }
        var day = picker.selectedDay(dir) as Dictionary;
        return Lang.format(HomeScreen.text(Rez.Strings.HomeStrengthRow), [withMinutes(day["n"] as String, day["m"] as Object or Null)]);
    }

    // "Zone 2 · 45 min"; unknown minutes are left out, not shown as 0.
    hidden function withMinutes(name as String, minutes as Object or Null) as String {
        if (minutes instanceof Number) {
            return name + " · " + Lang.format(HomeScreen.text(Rez.Strings.HomeMinutes), [minutes as Number]);
        }
        return name;
    }
}

// What START on a run row asks for: a planned run (its stored prescription) or a free run.
class PreStartRequest {
    enum Mode {
        MODE_PLANNED,
        MODE_FREE,
        MODE_ZONE2
    }

    var mode as Number;
    var runId as String;               // planned run, else ""
    var prescription as Dictionary or Null;
    var minutes as Number or Null;     // planned duration from the list ("m"), null if the plan names none
    var consent as Boolean or Null;    // heart rate consent as the server last said it, null before the first list

    function initialize(requestMode as Number, id as String, body as Dictionary or Null) {
        mode = requestMode;
        runId = id;
        prescription = body;
        minutes = null;
        consent = null;
    }

    // The same request with the facts the pre-start screen shows besides the prescription.
    function with(plannedMinutes as Number or Null, heartConsent as Boolean or Null) as PreStartRequest {
        minutes = plannedMinutes;
        consent = heartConsent;
        return self;
    }
}

// Opens the pre-start screen (RUN-025); tests record the request instead.
class PreStartLauncher {

    function initialize() {
    }

    function open(request as PreStartRequest) as Void {
        var model = new PreStartModel(request);
        var sensors = new RunSensors(new GpsCapability());
        var view = new PreStartView(model, sensors);
        WatchUi.pushView(view, new PreStartDelegate(model, sensors, new RunStarter(sensors)), WatchUi.SLIDE_LEFT);
    }

    // "Resume run?": YES takes the run up again from the journal (paused, the user starts it with START).
    function resume() as Void {
        WatchUi.pushView(new WatchUi.Confirmation(HomeScreen.text(Rez.Strings.RunResumeAsk)), new RunResumeQuestion(self), WatchUi.SLIDE_UP);
    }

    // The answer was yes: the run from the journal on the run screen. Without a run (damaged, refused) nothing opens.
    function resumed() as Boolean {
        var starter = new RunStarter(new RunSensors(new GpsCapability()));
        var session = RunSession.restore(starter.parts());
        if (session == null) {
            return false;
        }
        starter.open(session as RunSession, false);
        return true;
    }
}

class RunResumeQuestion extends WatchUi.ConfirmationDelegate {
    private var _launcher as PreStartLauncher;

    function initialize(launcher as PreStartLauncher) {
        ConfirmationDelegate.initialize();
        _launcher = launcher;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _launcher.resumed();
        }
        return true;
    }
}
