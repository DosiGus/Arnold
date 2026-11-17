import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Test;

// The set and rest screens in the Instrument design (UHR-01, UHR-02): what the faces hold, read as data.
(:test)
module FaceText {
    // Every text of a face in drawing order, each followed by "|".
    function joined(f as InstrumentFace) as String {
        var out = "";
        for (var i = 0; i < f.top.size(); i++) {
            out += f.top[i] + "|";
        }
        var parts = [f.left, f.leftUnit, f.right, f.rightUnit, f.hero, f.sub, f.bottom] as Array<String or Null>;
        for (var i = 0; i < parts.size(); i++) {
            if (parts[i] != null && !(parts[i] as String).equals("")) {
                out += (parts[i] as String) + "|";
            }
        }
        return out;
    }

    // A rig whose first exercise has the given sets ([[count, reps, load_g, side?]]).
    function rigWith(sets as Array, perSide as Boolean) as PlayerRig {
        var day = PlayerRig.dayBody(true);
        PlayerRig.change(day, "cat", 0, "s", sets);
        if (perSide) {
            PlayerRig.change(day, "cat", 0, "rb", "per_side");
        }
        var rig = new PlayerRig(true);
        rig.session = TrainingSession.start(day, rig.journal, rig.clock, rig.signals);
        rig.toFirstSet();
        return rig;
    }
}

(:test)
function setFaceShowsWeightRepsAndSetNumber(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    var f = SetScreen.face(rig.session, 132, 0);
    Expect.equal(f.top[0], "Bankdrücken");
    Expect.equal(f.left, "60");
    Expect.equal(f.right, "8");
    Expect.equal(f.leftUnit, TrainingText.text(Rez.Strings.TrKg));
    Expect.equal(f.rightUnit, TrainingText.text(Rez.Strings.TrRepsUnit));
    Expect.equal(f.bottom, Lang.format(TrainingText.text(Rez.Strings.TrSetOf), [1, 3]));
    Test.assert(f.bottomColor != SetScreen.WARN);
    Expect.equal(f.ring, InstrumentFace.RING_SEGMENTS);
    Expect.equal(f.segments, 3);
    Expect.equal(f.done, 0);
    // the second set: done counts the sets before it
    rig.setAndRest();
    var second = SetScreen.face(rig.session, 132, 0);
    Expect.equal(second.done, 1);
    Test.assert((second.bottom as String).equals(Lang.format(TrainingText.text(Rez.Strings.TrSetOf), [2, 3])));
    return true;
}

(:test)
function setFaceWritesTheDecimalSignByLanguage(logger as Logger) as Boolean {
    var rig = FaceText.rigWith([[2, 8, 62500]] as Array, false);
    var f = SetScreen.face(rig.session, null, 0);
    Expect.equal(f.left, "62" + TrainingText.separator() + "5");
    Test.assert((f.left as String).find(" ") == null);
    var odd = FaceText.rigWith([[1, 10, 1250]] as Array, false);
    Expect.equal(SetScreen.face(odd.session, null, 0).left, "1" + TrainingText.separator() + "25");
    return true;
}

(:test)
function setFaceMarksOpenValuesInOrangeWithAWord(logger as Logger) as Boolean {
    // weight unknown (the watch cannot tell body weight from unknown: both are null, START asks for the value)
    var noWeight = FaceText.rigWith([[2, 8, null]] as Array, false);
    var f = SetScreen.face(noWeight.session, null, 0);
    Test.assert((f.left as String).equals("–"));
    Expect.equal(f.right, "8");
    Expect.equal(f.bottom, TrainingText.text(Rez.Strings.UhrWeightOpen));
    Expect.equal(f.bottomColor, SetScreen.WARN);
    // reps unknown
    var noReps = FaceText.rigWith([[2, null, 20000]] as Array, false);
    var g = SetScreen.face(noReps.session, null, 0);
    Expect.equal(g.left, "20");
    Test.assert((g.right as String).equals("–"));
    Expect.equal(g.bottom, TrainingText.text(Rez.Strings.UhrRepsOpen));
    Expect.equal(g.bottomColor, SetScreen.WARN);
    // both unknown: never a 0
    var none = FaceText.rigWith([[1, null, null]] as Array, false);
    var h = SetScreen.face(none.session, null, 0);
    Test.assert((h.left as String).equals("–") && (h.right as String).equals("–"));
    Expect.equal(h.bottom, TrainingText.text(Rez.Strings.UhrRepsOpen));
    return true;
}

(:test)
function setFaceShowsTheSideAndTheLoadNote(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    for (var i = 0; i < 3; i++) { rig.setAndRest(); }
    rig.session.confirmPreview();   // Bizeps einarmig: left, then right; "pro Hantel"
    var left = SetScreen.face(rig.session, null, 0);
    Expect.equal(left.bottom, Lang.format(TrainingText.text(Rez.Strings.UhrSideOf), [TrainingText.text(Rez.Strings.TrLeft), 1, 2]));
    Expect.equal(left.segments, 2);
    Expect.equal(left.top.size(), 2);
    Expect.equal(left.top[1], "pro Hantel");
    rig.setAndRest();
    var right = SetScreen.face(rig.session, null, 0);
    Expect.equal(right.bottom, Lang.format(TrainingText.text(Rez.Strings.UhrSideOf), [TrainingText.text(Rez.Strings.TrRight), 2, 2]));
    Expect.equal(right.done, 1);
    // reps counted per side, both sides at once
    var both = FaceText.rigWith([[1, 8, 60000]] as Array, true);
    var f = SetScreen.face(both.session, null, 0);
    Expect.equal(f.top[1], TrainingText.text(Rez.Strings.TrPerSide));
    return true;
}

(:test)
function setFaceWrapsAndCutsLongNames(logger as Logger) as Boolean {
    var two = SetScreen.wrap("Überzüge am Kabelzug", SetScreen.LINE_CHARS);
    Expect.equal(two.size(), 2);
    Expect.equal(two[0], "Überzüge am");
    Expect.equal(two[1], "Kabelzug");
    var cut = SetScreen.wrap(NameRig.LONG, SetScreen.LINE_CHARS);
    Expect.equal(cut.size(), 2);
    Test.assert(cut[0].length() <= SetScreen.LINE_CHARS && cut[1].length() <= SetScreen.LINE_CHARS);
    Test.assert(cut[1].find("…") != null);
    Expect.equal(SetScreen.wrap("Dips", SetScreen.LINE_CHARS).size(), 1);
    // a long name leaves no room for the load note on the top: it is not drawn twice
    var rig = NameRig.rig(NameRig.LONG, "Rudern");
    rig.toFirstSet();
    Expect.equal(SetScreen.face(rig.session, null, 0).top.size(), 2);
    return true;
}

(:test)
function setFaceSecondPageShowsTheHeartRateAndLastTime(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    var page = SetScreen.face(rig.session, 132, 1);
    Expect.equal(page.hero, "132");
    Expect.equal(page.sub, TrainingText.text(Rez.Strings.UhrBpm));
    Test.assert(FaceText.joined(page).find("Letztes Mal") != null);
    Expect.equal(page.top[0], "Letztes Mal");
    Expect.equal(page.top[1], "8 · 8 · 7");
    Expect.equal(page.ring, InstrumentFace.RING_SEGMENTS);
    var none = SetScreen.face(rig.session, null, 1);
    Expect.equal(none.hero, "–");
    Test.assertMessage(!(none.hero as String).equals("0"), "never 0");
    // without a last time: the word "Heart rate" on top
    var day = PlayerRig.dayBody(true);
    PlayerRig.change(day, "items", 0, "l", null);
    var plain = new PlayerRig(true);
    plain.session = TrainingSession.start(day, plain.journal, plain.clock, plain.signals);
    plain.toFirstSet();
    Expect.equal(SetScreen.face(plain.session, 90, 1).top[0], TrainingText.text(Rez.Strings.UhrPulse));
    return true;
}

(:test)
function restFaceCountsDownAndShowsTheLastSet(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    rig.session.confirmSet();
    var f = RestScreen.face(rig.session, null, 0);
    Expect.equal(f.top[0], TrainingText.text(Rez.Strings.TrRest));
    Expect.equal(f.hero, "2:00");
    Expect.equal(f.sub, Lang.format(TrainingText.text(Rez.Strings.UhrLast), ["60", 8]));
    Expect.equal(f.bottom, Lang.format(TrainingText.text(Rez.Strings.UhrThenSet), [2]));
    Expect.equal(f.ring, InstrumentFace.RING_TIME);
    Expect.equal(f.timeLength, 360);
    Expect.equal(f.heroColor, Graphics.COLOR_WHITE);
    Expect.equal(f.ringColor, Graphics.COLOR_WHITE);
    return true;
}

(:test)
function restFaceRingShrinksAndEndsAtTwelve(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 30;   // 90 of 120 s left
    var f = RestScreen.face(rig.session, null, 0);
    Expect.equal(f.hero, "1:30");
    Expect.equal(f.timeLength, 270);
    Expect.equal(f.timeFrom + f.timeLength, 360);
    rig.clock.now += 60;   // 30 of 120 s
    var g = RestScreen.face(rig.session, null, 0);
    Expect.equal(g.timeLength, 90);
    Expect.equal(g.timeFrom, 270);
    // UP adds 15 s: the whole rest is longer, the ring follows
    rig.session.adjustRest(15);
    var h = RestScreen.face(rig.session, null, 0);
    Expect.equal(h.timeLength, 45 * 360 / 135);
    return true;
}

(:test)
function restFaceTurnsOrangeInTheLastTenSeconds(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    rig.session.confirmSet();
    rig.clock.now += 109;   // 11 s left
    var before = RestScreen.face(rig.session, null, 0);
    Expect.equal(before.hero, "0:11");
    Expect.equal(before.heroColor, Graphics.COLOR_WHITE);
    Expect.equal(before.ringColor, Graphics.COLOR_WHITE);
    rig.clock.now += 1;    // 10 s left
    var at = RestScreen.face(rig.session, null, 0);
    Expect.equal(at.heroColor, SetScreen.WARN);
    Expect.equal(at.ringColor, SetScreen.WARN);
    rig.clock.now += 5;
    var late = RestScreen.face(rig.session, null, 0);
    Expect.equal(late.hero, "0:05");
    Expect.equal(late.heroColor, SetScreen.WARN);
    return true;
}

(:test)
function restFaceNamesTheNextSetOrTheNextExercise(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    rig.session.confirmSet();
    var same = RestScreen.face(rig.session, null, 0);
    Expect.equal(same.bottom, Lang.format(TrainingText.text(Rez.Strings.UhrThenSet), [2]));
    rig.session.endRest();
    rig.setAndRest();
    rig.session.confirmSet();   // the last set of the first exercise
    var next = RestScreen.face(rig.session, null, 0);
    Test.assert((next.bottom as String).find("Bizeps") != null);
    Test.assert((next.bottom as String).length() <= 16);
    return true;
}

(:test)
function restFaceSecondPageShowsTheHeartRate(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    rig.session.confirmSet();
    var f = RestScreen.face(rig.session, 98, 1);
    Expect.equal(f.hero, "98");
    Expect.equal(f.sub, TrainingText.text(Rez.Strings.UhrBpm));
    Expect.equal(f.top[0], TrainingText.text(Rez.Strings.TrRest));
    Expect.equal(f.bottom, Lang.format(TrainingText.text(Rez.Strings.UhrThenSet), [2]));
    var none = RestScreen.face(rig.session, null, 1);
    Test.assert(!(none.hero as String).equals("0"));
    Test.assert(none.ring == InstrumentFace.RING_TIME);
    return true;
}

(:test)
function pageGoesBackToTheValuesWhenTheSetChanges(logger as Logger) as Boolean {
    var rig = new PlayerRig(true);
    rig.toFirstSet();
    Expect.equal(TrainingPages.current(rig.session), 0);
    TrainingPages.toggle(rig.session);
    Expect.equal(TrainingPages.current(rig.session), 1);
    rig.session.confirmSet();   // the rest begins
    Expect.equal(TrainingPages.current(rig.session), 0);
    TrainingPages.toggle(rig.session);
    rig.session.endRest();      // the next set
    Expect.equal(TrainingPages.current(rig.session), 0);
    TrainingPages.toggle(rig.session);
    TrainingPages.toggle(rig.session);
    Expect.equal(TrainingPages.current(rig.session), 0);
    return true;
}
