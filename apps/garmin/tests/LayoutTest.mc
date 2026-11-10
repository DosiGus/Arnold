import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// Layouts on every display size and the dark AMOLED look (GAR-B3-07). The tests draw into a
// bitmap of the real display size of the device the test runs on, so each target device is checked.

(:test)
class LayoutRig {
    static function dc() as Dc {
        var settings = System.getDeviceSettings();
        var bitmap = Graphics.createBufferedBitmap({
            :width => settings.screenWidth,
            :height => settings.screenHeight
        }).get() as BufferedBitmap;
        return bitmap.getDc();
    }

    // Upper bound of the lit area in percent: the boxes of all drawn text lines. The SDK has no
    // pixel readout; the background is cleared to black and nothing but text is drawn (PairingLayout.draw).
    static function litShare(dc as Dc, lines as Array<PairingLine>) as Number {
        var drawn = PairingLayout.arrange(dc, lines);
        var area = 0;
        for (var i = 0; i < drawn.size(); i++) {
            area += dc.getTextWidthInPixels(drawn[i].text, drawn[i].font) * dc.getFontHeight(drawn[i].font);
        }
        return area * 100 / (dc.getWidth() * dc.getHeight());
    }

    // Every wide (main number) line of the screen is at least a third of the display height.
    static function mainNumbersAreBig(dc as Dc, lines as Array<PairingLine>) as Boolean {
        var found = false;
        for (var i = 0; i < lines.size(); i++) {
            if (lines[i].wide) {
                found = true;
                if (!PairingLayout.isBig(dc, lines[i].font)) {
                    return false;
                }
            }
        }
        return found;
    }

    static function fits(dc as Dc, lines as Array<PairingLine>) as Boolean {
        return PairingLayout.blockHeight(dc, PairingLayout.arrange(dc, lines)) <= PairingLayout.maxBlockHeight(dc);
    }
}

(:test)
function mainNumbersTakeAThirdOfTheDisplay(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var values = ["8", "12", "62.5", "62,5", "100", "125,5", "2:05", "15:00", "0:09"];
    for (var i = 0; i < values.size(); i++) {
        var font = PairingLayout.bigFont(dc, values[i]);
        var message = values[i] + " on " + dc.getHeight() + " px: font height " + dc.getFontHeight(font);
        logger.debug(message);
        Test.assertMessage(PairingLayout.isBig(dc, font), message);
        Test.assertMessage(dc.getTextWidthInPixels(values[i], font) <= PairingLayout.bigWidth(dc), message);
    }
    return true;
}

(:test)
function setRestAndEditScreensAreBigAndFit(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new PlayerRig(true);
    // preview
    var preview = PreviewScreen.lines(dc, rig.session);
    Test.assert(LayoutRig.fits(dc, preview));
    // set (weight is the main number)
    rig.session.confirmPreview();
    var set = SetScreen.lines(dc, rig.session, 132);
    Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, set), "set");
    Test.assertMessage(LayoutRig.fits(dc, set), "set fits");
    // rest
    rig.session.confirmSet();
    var rest = RestScreen.lines(dc, rig.session, null);
    Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, rest), "rest");
    Test.assertMessage(LayoutRig.fits(dc, rest), "rest fits");
    // adjust (reps and weight)
    rig.session.endRest();
    var adjust = new SetAdjust(rig.session.currentSet() as PlannedSet, rig.session.exercise(), SetAdjust.FIELD_REPS);
    var editReps = EditScreen.lines(dc, rig.session, adjust);
    Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, editReps) && LayoutRig.fits(dc, editReps), "edit reps");
    adjust.next();
    var editLoad = EditScreen.lines(dc, rig.session, adjust);
    Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, editLoad) && LayoutRig.fits(dc, editLoad), "edit load");
    return true;
}

(:test)
function summaryAndOtherScreensFitTheDisplay(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new PlayerRig(false);
    rig.finishDay();
    var summary = SummaryScreen.lines(dc, rig.session, null);
    Test.assertMessage(LayoutRig.fits(dc, summary), "summary");
    var sent = SummaryScreen.sentLines({
        "records" => ["Bankdrücken 62,5 kg Rekord", "Kreuzheben 140 kg", "Klimmzüge +10 kg"],
        "next" => [{ "message" => "Nächstes Mal 65 kg bei Bankdrücken" }]
    });
    Test.assertMessage(LayoutRig.fits(dc, sent), "sent");
    return true;
}

// AMOLED (fr265, fr265s, fr965) and every other device: black background, no large lit
// area (burn-in protection). Only text is lit: the text boxes (ink is about a third of a box) cover at most 35 % of the display.
(:test)
function screensAreDarkWithoutLitAreas(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new PlayerRig(true);
    var names = ["preview", "set", "rest", "edit", "summary"];
    var screens = [] as Array<Array<PairingLine>>;
    screens.add(PreviewScreen.lines(dc, rig.session));
    rig.session.confirmPreview();
    screens.add(SetScreen.lines(dc, rig.session, 132));
    rig.session.confirmSet();
    screens.add(RestScreen.lines(dc, rig.session, 132));
    rig.session.endRest();
    screens.add(EditScreen.lines(dc, rig.session, new SetAdjust(rig.session.currentSet() as PlannedSet, rig.session.exercise(), SetAdjust.FIELD_LOAD)));
    var done = new PlayerRig(false);
    done.finishDay();
    screens.add(SummaryScreen.lines(dc, done.session, null));
    for (var i = 0; i < screens.size(); i++) {
        var share = LayoutRig.litShare(dc, screens[i]);
        logger.debug(names[i] + " on " + dc.getWidth() + " px: lit " + share + " %");
        Test.assertMessage(share <= 35, names[i] + " lit " + share + " %");
    }
    return true;
}
