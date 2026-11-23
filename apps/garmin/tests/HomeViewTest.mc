import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// Draws the start screen into an off-screen bitmap of the device's display size.
(:test)
function homeViewDrawsOnDeviceDisplay(logger as Logger) as Boolean {
    var settings = System.getDeviceSettings();
    var bitmap = Graphics.createBufferedBitmap({
        :width => settings.screenWidth,
        :height => settings.screenHeight
    }).get() as BufferedBitmap;
    var rig = new PlanRig();
    rig.pairing.restartPaired();
    rig.loadAll();
    var launcher = new TestLauncher(new Journal(rig.pairing.store), rig.pairing.clock, new RecordingSignals(), PlayerRig.senderFor(rig.pairing.store, rig.pairing.clock));
    var view = new HomeView(rig.pairing.controller, rig.sync, new SessionPicker(), launcher, RunRig.homeFor(rig.pairing));
    view.onUpdate(bitmap.getDc());
    logger.debug("display " + settings.screenWidth + "x" + settings.screenHeight);
    return true;
}

// Records what the start screen opens for mobility (MOB-008) instead of pushing views.
(:test)
class RecordingMobilityOpener extends MobilityOpener {
    var previews as Array<String>;
    var picks as Number;

    function initialize() {
        MobilityOpener.initialize();
        previews = [] as Array<String>;
        picks = 0;
    }

    function preview(cache as MobilityCache, id as String) as Void {
        previews.add(id);
    }

    function pick(cache as MobilityCache) as Void {
        picks++;
    }
}

// START on the open morning routine opens its preview, on the row "Mobility" the choice; a run that was cut off keeps
// its place before the morning routine; what the user chose with UP and DOWN stays when the rows refresh.
(:test)
function startOnMobilityRowsOpensThePreviewOrTheChoice(logger as Logger) as Boolean {
    var rig = MobHomeRig.rigWithRun();
    MobHomeRig.load(rig, [MobHomeRig.morning(false), MobHomeRig.entry(3, "s", "Montag", 1, null, false)] as Array);
    var opener = new RecordingMobilityOpener();
    rig.home.mobilityOpener = opener;
    var pairing = rig.plan.pairing;
    var launcher = new TestLauncher(new Journal(pairing.store), pairing.clock, new RecordingSignals(), PlayerRig.senderFor(pairing.store, pairing.clock));
    var delegate = new HomeDelegate(pairing.controller, rig.plan.sync, new SessionPicker(), launcher, rig.home);
    Test.assert(delegate.onSelect());                        // the open morning routine is selected
    Expect.equal(opener.previews.size(), 1);
    Expect.equal(opener.previews[0], new MobilityRig().id(1));
    Expect.equal(rig.opener.requests.size(), 0);             // no run was opened
    var rows = MobHomeRig.rows(rig);
    while (rig.home.selectedStop(rows, rig.plan.sync).kind != HomeStop.STOP_MOBILITY_PICK) {
        Test.assert(delegate.onNextPage());
    }
    Test.assert(delegate.onSelect());
    Expect.equal(opener.picks, 1);
    Expect.equal(opener.previews.size(), 1);
    Expect.equal(MobHomeRig.rows(rig).size(), rows.size());  // the choice stays on the row after the screen refreshes
    Expect.equal(rig.home.selectedStop(MobHomeRig.rows(rig), rig.plan.sync).kind, HomeStop.STOP_MOBILITY_PICK);
    rig.home.journal = new RunSim(null, 0, false).parts.journal;    // a cut-off run comes before the morning routine
    var cut = MobHomeRig.rows(rig);
    Expect.equal(cut[0].kind, HomeStop.STOP_RUN_RESUME);
    Expect.equal(cut[1].morning, true);
    var fresh = MobHomeRig.rigWithRun();
    MobHomeRig.load(fresh, [MobHomeRig.morning(false)] as Array);
    fresh.home.journal = rig.home.journal;
    Expect.equal(fresh.home.selectedStop(MobHomeRig.rows(fresh), fresh.plan.sync).kind, HomeStop.STOP_RUN_RESUME);
    return true;
}
