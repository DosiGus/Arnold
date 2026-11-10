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

// The exercise name on every training screen (GAR-B3-09). Long names are cut with "...", umlauts survive,
// the main number stays at least a third of the display and the screen still fits.
(:test)
module NameRig {
    const LONG as String = "Überzüge am Kabelzug mit breitem Griff, schräg sitzend, Äußere Variante";

    // A day whose first exercise has the given name and the second one the other name.
    function rig(first as String, second as String) as PlayerRig {
        var day = PlayerRig.dayBody(true);
        PlayerRig.change(day, "cat", 0, "n", first);
        PlayerRig.change(day, "cat", 1, "n", second);
        var rig = new PlayerRig(true);
        rig.session = TrainingSession.start(day, rig.journal, rig.clock, rig.signals);
        return rig;
    }

    function firstText(lines as Array<PairingLine>) as String {
        return lines[0].text;
    }

    // The exercise name is the first line drawn (never dropped), at most as wide as the name area.
    function nameOnTop(dc as Dc, lines as Array<PairingLine>, expectCut as Boolean, shortPart as String) as Boolean {
        var drawn = PairingLayout.arrange(dc, lines);
        var top = drawn[0].text;
        if (dc.getTextWidthInPixels(top, drawn[0].font) > PairingLayout.nameWidth(dc)) {
            return false;
        }
        if (expectCut) {
            return top.length() >= 4 && (top.substring(top.length() - 3, top.length()) as String).equals("...") && top.find(shortPart) == 0;
        }
        return top.find(shortPart) == 0 && top.find("...") == null;
    }
}

(:test)
function exerciseNameIsOnTopOfSetRestAndEditScreens(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var names = ["Dips", "Bankdrücken", NameRig.LONG];
    var next = ["Rudern", "Klimmzüge", NameRig.LONG];
    for (var i = 0; i < names.size(); i++) {
        var rig = NameRig.rig(names[i], next[i]);
        var cut = names[i].length() > 20 && dc.getTextWidthInPixels(names[i], Graphics.FONT_TINY) > PairingLayout.nameWidth(dc);
        var prefix = names[i].substring(0, 3) as String;
        var tag = names[i] + " on " + dc.getWidth() + " px";
        rig.session.confirmPreview();
        var set = SetScreen.lines(dc, rig.session, 132);
        Test.assertMessage(NameRig.nameOnTop(dc, set, cut, prefix), "set " + tag);
        Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, set) && LayoutRig.fits(dc, set), "set big+fits " + tag);
        // heart rate unknown: the name is still there
        var noHeart = SetScreen.lines(dc, rig.session, null);
        Test.assertMessage(NameRig.nameOnTop(dc, noHeart, cut, prefix), "set no heart " + tag);
        // edit
        var adjust = new SetAdjust(rig.session.currentSet() as PlannedSet, rig.session.exercise(), SetAdjust.FIELD_REPS);
        var edit = EditScreen.lines(dc, rig.session, adjust);
        Test.assertMessage(NameRig.nameOnTop(dc, edit, cut, prefix), "edit " + tag);
        Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, edit) && LayoutRig.fits(dc, edit), "edit big+fits " + tag);
        // rest after a set of the same exercise: the name of the exercise the rest belongs to
        rig.session.confirmSet();
        var rest = RestScreen.lines(dc, rig.session, null);
        Test.assertMessage(NameRig.nameOnTop(dc, rest, cut, prefix), "rest " + tag);
        Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, rest) && LayoutRig.fits(dc, rest), "rest big+fits " + tag);
        logger.debug(tag + ": ok");
    }
    return true;
}

(:test)
function restBeforeTheNextExerciseShowsBothNames(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = NameRig.rig("Bankdrücken", NameRig.LONG);
    rig.toFirstSet();
    rig.setAndRest();
    rig.setAndRest();
    rig.session.confirmSet();   // last set of the first exercise: the rest belongs to it, the next exercise comes after
    Test.assert(rig.session.state == TrainingSession.STATE_REST);
    Test.assert(!rig.session.nextIsSameExercise());
    var lines = RestScreen.lines(dc, rig.session, 120);
    Test.assertMessage(NameRig.nameOnTop(dc, lines, false, "Bankdrücken"), "own name");
    var drawn = PairingLayout.arrange(dc, lines);
    var found = false;
    for (var i = 0; i < drawn.size(); i++) {
        logger.debug(dc.getWidth() + " px line " + i + ": " + drawn[i].text);
        if (drawn[i].text.find("Überz") != null) {
            found = true;
            Test.assertMessage(dc.getTextWidthInPixels(drawn[i].text, drawn[i].font) <= PairingLayout.textWidth(dc), "next name width");
        }
    }
    Test.assertMessage(found, "next exercise name on the rest screen");
    Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, lines) && LayoutRig.fits(dc, lines), "rest next big+fits");
    return true;
}

(:test)
function swappedExerciseShowsTheNewName(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = NameRig.rig("Bankdrücken", "Rudern");
    rig.toFirstSet();
    var before = SetScreen.lines(dc, rig.session, null);
    Test.assert(NameRig.firstText(before).find("Bankdrücken") == 0);
    var swapped = rig.session.exercise();
    swapped.name = "Fliegende";
    var after = SetScreen.lines(dc, rig.session, null);
    Test.assert(NameRig.firstText(after).find("Fliegende") == 0);
    return true;
}

(:test)
function ellipsizeKeepsUmlautsWholeAndFits(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var font = Graphics.FONT_TINY;
    var width = PairingLayout.nameWidth(dc);
    Test.assert(PairingLayout.ellipsize(dc, "Dips", font, width).equals("Dips"));
    var cut = PairingLayout.ellipsize(dc, NameRig.LONG, font, width);
    Test.assert(dc.getTextWidthInPixels(cut, font) <= width);
    Test.assert((cut.substring(cut.length() - 3, cut.length()) as String).equals("..."));
    Test.assert(cut.find("Überzüge") == 0);
    Test.assert(PairingLayout.ellipsize(dc, "Überzüge", font, 5).equals("..."));
    // the short form for system views (dialogs, list title)
    Test.assert(TrainingText.shortName("Dips", 20).equals("Dips"));
    var system = TrainingText.shortName(NameRig.LONG, 20);
    Test.assert(system.length() == 20 && (system.substring(17, 20) as String).equals("..."));
    return true;
}

(:test)
function dialogsDuringTheWorkoutNameTheExercise(logger as Logger) as Boolean {
    var rig = NameRig.rig("Bankdrücken", "Rudern");
    // preview and summary: the question alone
    var preview = TrainingText.asking(rig.session, Rez.Strings.PromptEnd);
    Test.assert(preview.find("Bankdrücken") == null);
    rig.toFirstSet();
    var set = TrainingText.asking(rig.session, Rez.Strings.PromptEnd);
    Test.assert(set.find("Bankdrücken\n") == 0);
    Test.assert(set.length() > "Bankdrücken\n".length());
    rig.session.confirmSet();
    Test.assert(TrainingText.asking(rig.session, Rez.Strings.TrPausePrompt).find("Bankdrücken\n") == 0);
    var longNamed = NameRig.rig(NameRig.LONG, "Rudern");
    longNamed.toFirstSet();
    var asked = TrainingText.asking(longNamed.session, Rez.Strings.PromptDiscard);
    Test.assert((asked.substring(0, asked.find("\n") as Number) as String).length() <= 26);
    return true;
}
