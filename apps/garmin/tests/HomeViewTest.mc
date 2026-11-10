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
    var launcher = new TestLauncher(new Journal(rig.pairing.store), rig.pairing.clock, new RecordingSignals());
    var view = new HomeView(rig.pairing.controller, rig.sync, new SessionPicker(), launcher);
    view.onUpdate(bitmap.getDc());
    logger.debug("display " + settings.screenWidth + "x" + settings.screenHeight);
    return true;
}
