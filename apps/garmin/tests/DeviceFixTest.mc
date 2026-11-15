import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Test;
import Toybox.WatchUi;

// Found on a Forerunner 255 (15.11.2026): YES on "start without GPS?" must not open the run display inside
// onResponse (the question closes itself afterwards and took the run display with it). The start comes a
// moment later through RunLater.
(:test)
function yesOnTheGpsQuestionStartsAfterTheQuestionHasClosed(logger as Logger) as Boolean {
    var rig = new PreStartRig(PreStartRig.planned(0, "Zone 2", 45, PreStartRig.threeSegments()));
    rig.sensors.quality = Position.QUALITY_NOT_AVAILABLE;
    Test.assert(rig.delegate.onSelect());
    RunLater.timer = null;
    var question = new PreStartQuestion(rig.delegate);
    Test.assert(question.onResponse(WatchUi.CONFIRM_YES));
    Expect.equal(rig.starter.started.size(), 0);   // not inside onResponse
    Test.assert(RunLater.timer != null);           // but a moment later
    rig.delegate.confirmed();                      // what the timer calls
    Expect.equal(rig.starter.started.size(), 1);   // exactly one start
    // NO starts nothing and schedules nothing
    RunLater.timer = null;
    Test.assert(new PreStartQuestion(rig.delegate).onResponse(WatchUi.CONFIRM_NO));
    Test.assert(RunLater.timer == null);
    Expect.equal(rig.starter.started.size(), 1);
    return true;
}

// The summary after a workout scrolls: a long list keeps every line, the position stays within the lines,
// a short list looks as before.
(:test)
function theSummaryScrollsWithinItsLines(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var many = [] as Array<PairingLine>;
    for (var i = 0; i < 30; i++) {
        many.add(new PairingLine("Zeile " + i, Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
    }
    var end = PairingLayout.drawFrom(dc, many, 1000);
    Test.assertMessage(end > 0 && end < 30, "end " + end);
    Expect.equal(PairingLayout.drawFrom(dc, many, -3), 0);
    Expect.equal(PairingLayout.drawFrom(dc, many, 2), 2);
    var few = [new PairingLine("Gespeichert", Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE)] as Array<PairingLine>;
    Expect.equal(PairingLayout.drawFrom(dc, few, 5), 0);
    SummaryScroll.first = 0;
    SummaryScroll.by(-1);
    Expect.equal(SummaryScroll.first, 0);
    SummaryScroll.by(2);
    Expect.equal(SummaryScroll.first, 2);
    SummaryScroll.first = 0;
    return true;
}

// RUN-029: the first question of discarding a workout must not open the second one inside onResponse (the
// question closes itself afterwards and would close the second with it: the same hang as RUN-028). The second
// question comes a moment later through RunLater; NO does nothing.
(:test)
function theFirstDiscardQuestionAsksTheSecondAfterItHasClosed(logger as Logger) as Boolean {
    var rig = new PlayerRig(false);
    RunLater.timer = null;
    var first = new DiscardConfirmDelegate(rig.session, 1, 1);
    Test.assert(first.onResponse(WatchUi.CONFIRM_NO));
    Test.assert(RunLater.timer == null);              // NO schedules nothing
    Test.assert(first.onResponse(WatchUi.CONFIRM_YES));
    Test.assert(RunLater.timer != null);              // the second question is scheduled, not pushed now
    RunLater.timer = null;
    return true;
}
