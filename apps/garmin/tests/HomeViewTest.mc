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
    var view = new HomeView();
    view.onUpdate(bitmap.getDc());
    logger.debug("display " + settings.screenWidth + "x" + settings.screenHeight);
    return true;
}
