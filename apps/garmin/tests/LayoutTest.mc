import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Position;
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

    // The text of the first line marked to stay on one line (PairingLine.shrinks) that was wrapped or dropped
    // anyway; "" if none. Other lines (main values, error sentences) may wrap on purpose.
    static function wrapped(dc as Dc, lines as Array<PairingLine>) as String {
        var drawn = PairingLayout.arrange(dc, lines);
        for (var j = 0; j < lines.size(); j++) {
            if (lines[j].smaller == null) {
                continue;
            }
            var found = false;
            for (var i = 0; i < drawn.size(); i++) {
                found = found || drawn[i].text.equals(lines[j].text);
            }
            if (!found) {
                return lines[j].text;
            }
        }
        return "";
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
function bigLinesWithAUnitUseATextFont(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var numberFonts = [Graphics.FONT_NUMBER_MILD, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_THAI_HOT] as Array<Graphics.FontType>;
    var values = [RunText.distance(1234, false), RunText.distance(0, false), RunText.distance(12345678, true), "5 km", "(geschätzt)"];
    for (var i = 0; i < values.size(); i++) {
        var font = PairingLayout.bigFont(dc, values[i]);
        var message = values[i] + " on " + dc.getHeight() + " px";
        logger.debug(message);
        for (var f = 0; f < numberFonts.size(); f++) {
            Test.assertMessage(font != numberFonts[f], message + " uses a number font");
        }
        Test.assertMessage(dc.getTextWidthInPixels(values[i], font) <= PairingLayout.bigWidth(dc) || font == Graphics.FONT_TINY, message);
    }
    // plain numbers keep the number fonts
    Test.assert(PairingLayout.numeralOnly("12,5"));
    Test.assert(PairingLayout.numeralOnly("2:05"));
    Test.assert(!PairingLayout.numeralOnly("12,5 km"));
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
    // (set and rest are Instrument faces now: they draw with the numeral fonts; see InstrumentFaceTest)
    Instrument.draw(dc, SetScreen.face(rig.session, 132, 0));
    Instrument.draw(dc, SetScreen.face(rig.session, 132, 1));
    rig.session.confirmSet();
    Instrument.draw(dc, RestScreen.face(rig.session, null, 0));
    Instrument.draw(dc, RestScreen.face(rig.session, null, 1));
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
    var names = ["preview", "edit", "summary"];   // set and rest draw with Instrument: text and ring lines on black only
    var screens = [] as Array<Array<PairingLine>>;
    screens.add(PreviewScreen.lines(dc, rig.session));
    rig.session.confirmPreview();
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

    // The first line of an Instrument face is the exercise name (cut with "…" when too long), as wide as the top allows.
    function faceNameOnTop(dc as Dc, face as InstrumentFace, expectCut as Boolean, shortPart as String) as Boolean {
        if (face.top.size() == 0 || face.top[0].find(shortPart) != 0) {
            return false;
        }
        for (var i = 0; i < face.top.size(); i++) {
            if (dc.getTextWidthInPixels(face.top[i], Graphics.FONT_TINY) > Instrument.scale(dc, 190)) {
                return false;
            }
        }
        var cut = face.top[face.top.size() - 1].find("…") != null;
        return cut == expectCut;
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
        var set = SetScreen.face(rig.session, 132, 0);
        Test.assertMessage(NameRig.faceNameOnTop(dc, set, cut, prefix), "set " + tag);
        // heart rate unknown: the name is still there
        var noHeart = SetScreen.face(rig.session, null, 0);
        Test.assertMessage(NameRig.faceNameOnTop(dc, noHeart, cut, prefix), "set no heart " + tag);
        Instrument.draw(dc, set);
        // edit
        var adjust = new SetAdjust(rig.session.currentSet() as PlannedSet, rig.session.exercise(), SetAdjust.FIELD_REPS);
        var edit = EditScreen.lines(dc, rig.session, adjust);
        Test.assertMessage(NameRig.nameOnTop(dc, edit, cut, prefix), "edit " + tag);
        Test.assertMessage(LayoutRig.mainNumbersAreBig(dc, edit) && LayoutRig.fits(dc, edit), "edit big+fits " + tag);
        // rest after a set of the same exercise: the name of the exercise the rest belongs to
        rig.session.confirmSet();
        var rest = RestScreen.face(rig.session, null, 0);
        Test.assertMessage(rest.top[0].equals(TrainingText.text(Rez.Strings.TrRest)), "rest title " + tag);
        Test.assertMessage(rest.bottom != null && (rest.bottom as String).length() <= 16, "rest bottom " + tag);
        Instrument.draw(dc, rest);
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
    var face = RestScreen.face(rig.session, 120, 0);
    var bottom = face.bottom as String;
    logger.debug(dc.getWidth() + " px bottom: " + bottom);
    Test.assertMessage(bottom.find("Überz") != null, "next exercise name on the rest screen");
    Test.assertMessage(dc.getTextWidthInPixels(bottom, Graphics.FONT_TINY) <= Instrument.scale(dc, 190), "next name width");
    Instrument.draw(dc, face);
    return true;
}

(:test)
function swappedExerciseShowsTheNewName(logger as Logger) as Boolean {
    var rig = NameRig.rig("Bankdrücken", "Rudern");
    rig.toFirstSet();
    var before = SetScreen.face(rig.session, null, 0);
    Test.assert(before.top[0].find("Bankdrücken") == 0);
    var swapped = rig.session.exercise();
    swapped.name = "Fliegende";
    var after = SetScreen.face(rig.session, null, 0);
    Test.assert(after.top[0].find("Fliegende") == 0);
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
    Test.assert(set.find("\nBankdrücken") != null);
    Test.assert(set.find("\n") != 0 && set.find("Bankdrücken") != 0);   // the question first
    rig.session.confirmSet();
    Test.assert(TrainingText.asking(rig.session, Rez.Strings.TrPausePrompt).find(TrainingText.text(Rez.Strings.TrPausePrompt) + "\n") == 0);
    var longNamed = NameRig.rig(NameRig.LONG, "Rudern");
    longNamed.toFirstSet();
    var asked = TrainingText.asking(longNamed.session, Rez.Strings.PromptDiscard);
    Test.assert(asked.find(TrainingText.text(Rez.Strings.PromptDiscard) + "\n") == 0);   // the question is not pushed out by the name
    Test.assert((asked.substring((asked.find("\n") as Number) + 1, asked.length()) as String).length() <= 20);
    return true;
}

// The start screen (RUN-012): "Today" with the training and the runs of today, "Free run" below.
// Every row is one line at most as wide as the text area (long names are cut with "..."), the block
// fits the display, the selected row carries the marker and the free runs are always there.
(:test)
module HomeRig {
    const LONG_RUN as String = "Langer Dauerlauf mit Steigerungen am Ende, Äußere Runde";

    function entries(rig as RunRig, count as Number, name as String) as Array {
        var runs = [] as Array;
        for (var i = 0; i < count; i++) {
            runs.add(rig.entry("r" + i.toString(), 0, name, 45 + i, 1));
        }
        return runs;
    }

    function lines(dc as Dc, rig as RunRig) as Array<PairingLine> {
        return HomeScreen.stopLines(dc, rig.plan.sync, rig.home, new SessionPicker(), rig.plan.pairing.clock.nowSeconds());
    }

    // fits the display, no row wider than the text area, "Free run" present, exactly one marker
    function ok(dc as Dc, rig as RunRig, tag as String) as Boolean {
        var lines = lines(dc, rig);
        var drawn = PairingLayout.arrange(dc, lines);
        Test.assertMessage(LayoutRig.fits(dc, lines), tag + " fits on " + dc.getWidth() + " px");
        var marked = 0;
        var free = false;
        for (var i = 0; i < drawn.size(); i++) {
            Test.assertMessage(dc.getTextWidthInPixels(drawn[i].text, drawn[i].font) <= PairingLayout.textWidth(dc), tag + " width of " + drawn[i].text);
            if (drawn[i].text.find("> ") == 0) {
                marked++;
            }
            if (drawn[i].text.find("Frei") != null || drawn[i].text.find("Open") != null) {
                free = true;
            }
        }
        Test.assertMessage(marked == 1, tag + " one marker, found " + marked);
        Test.assertMessage(free, tag + " free run row on " + dc.getWidth() + " px");
        return true;
    }
}

(:test)
function startScreenFitsTheDisplayWithRunsPlanAndWithout(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    // training and one run today
    var both = new RunRig();
    both.plan.loadAll();
    Test.assert(both.cache.putUpcoming(both.upcoming(HomeRig.entries(both, 1, "Zone 2"), true), both.plan.pairing.clock.now, 0));
    Test.assert(HomeRig.ok(dc, both, "training+run"));
    // training and three runs today, long names, unknown minutes
    var many = new RunRig();
    many.plan.loadAll();
    var runs = HomeRig.entries(many, 2, HomeRig.LONG_RUN);
    runs.add(many.entry("r9", 0, "Langer Lauf", null, 1));
    Test.assert(many.cache.putUpcoming(many.upcoming(runs, true), many.plan.pairing.clock.now, 0));
    Test.assert(HomeRig.ok(dc, many, "three runs"));
    // a run that was cut off as the first row, with three runs, long names and the pending line
    many.home.journal = new RunSim(null, 0, false).parts.journal;
    var cut = many.home.stops(many.plan.sync, new SessionPicker());
    Test.assertEqual(cut[0].kind, HomeStop.STOP_RUN_RESUME);
    Test.assert(HomeRig.ok(dc, many, "resume row"));
    // moving down through every row keeps the screen valid
    var rows = many.home.stops(many.plan.sync, new SessionPicker());
    for (var i = 0; i < rows.size(); i++) {
        many.home.move(rows, many.plan.sync, 1);
        Test.assert(HomeRig.ok(dc, many, "selection " + i));
    }
    // the plan only (no run), no plan and offline, no plan and setup open
    var planOnly = new RunRig();
    planOnly.plan.loadAll();
    Test.assert(HomeRig.ok(dc, planOnly, "training only"));
    var offline = new RunRig();
    offline.plan.begin();
    offline.plan.exhaustRetries();
    Test.assert(HomeRig.ok(dc, offline, "no plan offline"));
    var loading = new RunRig();
    loading.plan.begin();
    Test.assert(HomeRig.ok(dc, loading, "no plan loading"));
    var setup = new RunRig();
    setup.plan.begin();
    setup.plan.pairing.transport.respond(409, setup.plan.errorBody("SETUP_REQUIRED", false));
    Test.assert(HomeRig.ok(dc, setup, "setup open"));
    return true;
}

(:test)
function startScreenCutsLongRunNamesAndKeepsUmlauts(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new RunRig();
    rig.plan.loadAll();
    Test.assert(rig.cache.putUpcoming(rig.upcoming(HomeRig.entries(rig, 1, HomeRig.LONG_RUN), true), rig.plan.pairing.clock.now, 0));
    var drawn = PairingLayout.arrange(dc, HomeRig.lines(dc, rig));
    var found = false;
    for (var i = 0; i < drawn.size(); i++) {
        if (drawn[i].text.find("Run: ") != null || drawn[i].text.find("Lauf: ") != null) {
            found = true;
            logger.debug(dc.getWidth() + " px: " + drawn[i].text);
            Test.assert((drawn[i].text.substring(drawn[i].text.length() - 3, drawn[i].text.length()) as String).equals("..."));
            Test.assert(dc.getTextWidthInPixels(drawn[i].text, drawn[i].font) <= PairingLayout.textWidth(dc));
        }
    }
    Test.assertMessage(found, "the run row is on the screen");
    return true;
}

// Burn-in protection also holds for the start screen.
(:test)
function startScreenHasNoLargeLitArea(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var rig = new RunRig();
    rig.plan.loadAll();
    Test.assert(rig.cache.putUpcoming(rig.upcoming(HomeRig.entries(rig, 1, "Zone 2"), true), rig.plan.pairing.clock.now, 0));
    var share = LayoutRig.litShare(dc, HomeRig.lines(dc, rig));
    logger.debug("start screen on " + dc.getWidth() + " px: lit " + share + " %");
    Test.assertMessage(share <= 35, "lit " + share + " %");
    return true;
}

// The pre-start screen (RUN-025) on every display: all lines at their longest (24-character name, the
// longest run type, battery warning) still fit, in each environment and for each GPS quality.
(:test)
function thePreStartScreenFitsOnEveryDisplay(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var body = { "k" => 5, "n" => "Schwellenintervalle 6x6m", "e" => 0, "s" => PreStartRig.threeSegments() };
    var qualities = [Position.QUALITY_NOT_AVAILABLE, Position.QUALITY_LAST_KNOWN, Position.QUALITY_POOR, Position.QUALITY_USABLE, Position.QUALITY_GOOD] as Array<Number>;
    for (var e = 0; e < 3; e++) {
        for (var q = 0; q < qualities.size(); q++) {
            var request = new PreStartRequest(PreStartRequest.MODE_PLANNED, "r1", body).with(300, true);
            var model = new PreStartModel(request);
            model.environment = e;
            var lines = PreStartScreen.lines(dc, model, qualities[q], 187, 5);   // 5 % battery: the warning is there
            var message = "env " + e + " quality " + qualities[q] + " on " + dc.getHeight() + " px";
            Test.assertMessage(LayoutRig.fits(dc, lines), message);
            Test.assertMessage(LayoutRig.litShare(dc, lines) <= 60, message + " lit " + LayoutRig.litShare(dc, lines));
            // the essentials are never dropped: name, environment, GPS, heart rate, battery
            var drawn = PairingLayout.arrange(dc, lines);
            var text = "";
            for (var i = 0; i < drawn.size(); i++) {
                text += drawn[i].text + "|";
            }
            Test.assertMessage(text.find(PreStartScreen.environmentText(e)) != null, message + " env text");
            Test.assertMessage(text.find(PreStartScreen.gpsText(model, qualities[q])) != null, message + " gps text");
            Test.assertMessage(text.find("187") != null, message + " heart rate");
            Test.assertMessage(text.find(HomeScreen.text(Rez.Strings.PreBattery).substring(0, 4) as String) != null, message + " battery");
            // the screen and the ring draw without an error
            PairingLayout.draw(dc, lines);
            if (model.usesGps()) {
                PreStartScreen.drawRing(dc, qualities[q]);
            }
        }
    }
    // a free run in the shortest form
    var free = new PreStartModel(PreStartRig.free());
    Test.assert(LayoutRig.fits(dc, PreStartScreen.lines(dc, free, Position.QUALITY_NOT_AVAILABLE, null, 100)));
    return true;
}

// The settings menu shows all six switches on every display (the menu scrolls: the count is what counts).
(:test)
function theSettingsMenuHasAllSixSwitches(logger as Logger) as Boolean {
    var menu = SettingsMenu.build(new Settings(new MemoryStore()));
    var count = 0;
    while (menu.getItem(count) != null) {
        count++;
    }
    Test.assertEqual(count, 6);
    return true;
}
