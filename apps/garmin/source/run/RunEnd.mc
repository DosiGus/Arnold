import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// The effort of a run (RUN-018): 1 to 10 with a word for each pair of steps, and the effort a run type is expected to
// have, which is what the question starts on.
module RunEffort {
    // Expected effort by run type code: recovery, base, long, progression, tempo, threshold, intervals, repetitions,
    // strides, hills, fartlek, run-walk, test, free.
    const EXPECTED as Array<Number> = [2, 3, 4, 6, 7, 7, 8, 8, 5, 7, 6, 4, 9, 5] as Array<Number>;
    const MIN as Number = 1;
    const MAX as Number = 10;

    function expected(kind as Number) as Number {
        return kind >= 0 && kind < EXPECTED.size() ? EXPECTED[kind] : 5;
    }

    // "sehr leicht" (1-2), "locker" (3-4), "mittel" (5-6), "hart" (7-8), "maximal" (9-10).
    function word(level as Number) as String {
        var ids = [Rez.Strings.RunEffort1, Rez.Strings.RunEffort2, Rez.Strings.RunEffort3, Rez.Strings.RunEffort4, Rez.Strings.RunEffort5] as Array<ResourceId>;
        var index = (level - 1) / 2;
        return HomeScreen.text(ids[index < 0 ? 0 : (index > 4 ? 4 : index)]);
    }
}

// What happens after SAVE (RUN-018), without WatchUi so tests press the keys and read the result:
//   treadmill: "Correct distance?" (UP and DOWN change it by 10 m, START takes it, BACK keeps the watch's estimate)
//   the effort 1-10, started on what the run type expects (START takes it: one press; BACK skips: one press)
//   -> the result is built, frozen in the run outbox and sent; then the summary on two or three pages.
class RunEndFlow {
    enum Step {
        STEP_CORRECT,
        STEP_EFFORT,
        STEP_SUMMARY
    }

    const DISTANCE_STEP_CM as Number = 1000;   // 10 m
    const MAX_CM as Number = 10000000;         // 100 km

    var session as RunSession;
    var saved as Boolean;
    var afterPreStart as Boolean;
    var step as Number;
    var distanceCm as Number;      // what the correction shows now
    var effort as Number;          // what the effort question shows now
    var page as Number;
    var presses as Number;         // key presses since SAVE that the effort and distance questions took (tests count them)
    private var _sender as RunSender or Null;
    private var _consent as Boolean;
    private var _base as Number;

    function initialize(runSession as RunSession, wasSaved as Boolean, afterPreStartScreen as Boolean, sender as RunSender or Null, consent as Boolean) {
        session = runSession;
        saved = wasSaved;
        afterPreStart = afterPreStartScreen;
        _sender = sender;
        _consent = consent;
        _base = (runSession.calc.distanceCm + DISTANCE_STEP_CM / 2) / DISTANCE_STEP_CM * DISTANCE_STEP_CM;
        distanceCm = _base;
        effort = RunEffort.expected(RunUpload.runKind(runSession));
        page = 0;
        presses = 0;
        step = STEP_EFFORT;
    }

    function sender() as RunSender or Null {
        return _sender;
    }

    // Only the treadmill's distance is an estimate the user may correct.
    function needsCorrection() as Boolean {
        return session.distanceIsEstimated() && session.calc.distanceCm > 0;
    }

    function begin(nav as RunNav) as Void {
        step = needsCorrection() ? STEP_CORRECT : STEP_EFFORT;
        nav.show(self);
    }

    // DOWN is +1, UP is -1: UP raises the distance and the effort, DOWN lowers them; on the summary they turn the pages.
    function move(delta as Number) as Void {
        presses++;
        if (step == STEP_CORRECT) {
            var next = distanceCm - delta * DISTANCE_STEP_CM;   // UP raises the distance, DOWN lowers it
            distanceCm = next < 0 ? 0 : (next > MAX_CM ? MAX_CM : next);
        } else if (step == STEP_EFFORT) {
            var value = effort - delta;   // UP raises the effort, DOWN lowers it (as the distance)
            effort = value < RunEffort.MIN ? RunEffort.MIN : (value > RunEffort.MAX ? RunEffort.MAX : value);
        } else {
            var count = pageCount();
            page = ((page + delta) % count + count) % count;
        }
    }

    // START.
    function confirm(nav as RunNav) as Void {
        presses++;
        if (step == STEP_CORRECT) {
            if (distanceCm != _base) {
                session.correctDistance(distanceCm);
            }
            step = STEP_EFFORT;
            nav.show(self);
        } else if (step == STEP_EFFORT) {
            session.effort = effort;
            finishRun();
            step = STEP_SUMMARY;
            nav.show(self);
        } else {
            nav.leave(afterPreStart);
        }
    }

    // BACK: the question is skipped (the watch's distance stays, no effort is sent), on the summary the screen closes.
    function back(nav as RunNav) as Void {
        presses++;
        if (step == STEP_CORRECT) {
            step = STEP_EFFORT;
            nav.show(self);
        } else if (step == STEP_EFFORT) {
            session.effort = 0;
            finishRun();
            step = STEP_SUMMARY;
            nav.show(self);
        } else {
            nav.leave(afterPreStart);
        }
    }

    // The result goes into the run outbox and is sent (or waits for the phone).
    hidden function finishRun() as Void {
        var sender = _sender;
        if (sender != null) {
            try {
                RunHandover.queue(session, sender as RunSender, session.services(), _consent);
            } catch (e) {
                // the journal still holds the run: the next start of the app queues it
            }
        }
    }

    function pageCount() as Number {
        return RunSummary.hasPartThree(session) ? 3 : 2;
    }
}

// The numbers of the summary, worked out from the run (nothing is stored): pace of work segments, kilometres.
module RunSummary {
    const KM_LAP_MIN_M as Number = 950;
    const KIND_WORK as Number = 1;
    const KIND_LAP as Number = 5;

    // Seconds per km of t seconds over dm metres; null for nothing to divide.
    function paceOf(seconds as Number, meters as Number) as Number or Null {
        return meters > 0 && seconds > 0 ? seconds * 1000 / meters : null;
    }

    // Seconds per km over the whole run, from the distance of the result.
    function averagePace(session as RunSession) as Number or Null {
        var cm = session.resultDistanceCm();
        return cm > 0 && session.calc.timerS > 0 ? session.calc.timerS * 100000 / cm : null;
    }

    // [count, total seconds, total metres, best pace or -1] of the segments of a kind (laps: only full km).
    function stats(session as RunSession, kind as Number) as Array<Number> {
        var count = 0;
        var seconds = 0;
        var meters = 0;
        var best = -1;
        var worst = -1;
        for (var i = 0; i < session.results.size(); i++) {
            var r = session.results[i];
            if (r[0] != kind || r[2] <= 0 || r[3] <= 0 || (kind == KIND_LAP && r[3] < KM_LAP_MIN_M)) {
                continue;
            }
            var pace = r[2] * 1000 / r[3];
            count++;
            seconds += r[2];
            meters += r[3];
            best = best < 0 || pace < best ? pace : best;
            worst = pace > worst ? pace : worst;
        }
        return [count, seconds, meters, best, worst] as Array<Number>;
    }

    function hasPartThree(session as RunSession) as Boolean {
        return stats(session, KIND_WORK)[0] > 0 || stats(session, KIND_LAP)[0] > 0;
    }
}

// The lines of the three steps after SAVE.
module RunEndScreens {
    function lines(dc as Dc, flow as RunEndFlow) as Array<PairingLine> {
        if (flow.step == RunEndFlow.STEP_CORRECT) {
            return correct(dc, flow);
        }
        return flow.step == RunEndFlow.STEP_EFFORT ? effort(dc, flow) : summary(dc, flow);
    }

    function correct(dc as Dc, flow as RunEndFlow) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunCorrectTitle), Graphics.FONT_TINY, Graphics.COLOR_ORANGE));
        out.add(PairingLayout.bigLine(dc, RunText.distance(flow.distanceCm, false), Graphics.COLOR_WHITE));
        out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunCorrectHint), Graphics.FONT_XTINY, Graphics.COLOR_DK_GRAY).skippable());
        return out;
    }

    function effort(dc as Dc, flow as RunEndFlow) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunEffortTitle), Graphics.FONT_TINY, Graphics.COLOR_ORANGE));
        out.add(PairingLayout.bigLine(dc, flow.effort.toString(), Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunEffort.word(flow.effort), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunEffortOf), [flow.effort]), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable());
        out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunEffortHint), Graphics.FONT_XTINY, Graphics.COLOR_DK_GRAY).skippable());
        return out;
    }

    // Page 1 distance, time, pace; page 2 heart rate and zones; page 3 segments or kilometres (when there are some).
    function summary(dc as Dc, flow as RunEndFlow) as Array<PairingLine> {
        var session = flow.session;
        var out = [] as Array<PairingLine>;
        if (flow.page == 0) {
            out.add(PairingLayout.bigLine(dc, RunText.distance(session.resultDistanceCm(), session.distanceIsEstimated() && session.correctedCm < 0), Graphics.COLOR_WHITE));
            out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumTime), [RunText.clock(session.calc.timerS)]), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
            out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSegAvg), [RunText.pace(RunSummary.averagePace(session))]), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
            if (session.effort > 0) {
                out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumEffort), [session.effort]), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable());
            }
            if (!flow.saved) {
                out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunSaveFailed), Graphics.FONT_XTINY, Graphics.COLOR_ORANGE).skippable());
            }
        } else if (flow.page == 1) {
            heart(session, out);
        } else {
            segments(session, out);
        }
        var status = statusLine(flow);
        if (status != null) {
            out.add(status as PairingLine);
        }
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunPageOf), [flow.page + 1, flow.pageCount()]), Graphics.FONT_XTINY, Graphics.COLOR_DK_GRAY).skippable());
        return out;
    }

    function heart(session as RunSession, out as Array<PairingLine>) as Void {
        var calc = session.calc;
        if (calc.heartN <= 0) {
            out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunSumNoHeart), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
            return;
        }
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumHeart), [calc.heartSum / calc.heartN, calc.heartMax]), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        var z = calc.zoneSeconds;
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumZonesA), [z[0] / 60, z[1] / 60, z[2] / 60]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumZonesB), [z[3] / 60, z[4] / 60]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
    }

    function segments(session as RunSession, out as Array<PairingLine>) as Void {
        var work = RunSummary.stats(session, RunSummary.KIND_WORK);
        if (work[0] > 0) {
            out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumWork), [work[0], RunText.pace(work[2] > 0 ? work[1] * 1000 / work[2] : null)]), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
            out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumBest), [RunText.pace(work[3])]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
            out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumSegments), [session.results.size()]), Graphics.FONT_XTINY, Graphics.COLOR_DK_GRAY).skippable());
            return;
        }
        var km = RunSummary.stats(session, RunSummary.KIND_LAP);
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumKms), [km[0]]), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumKmFast), [RunText.pace(km[3])]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSumKmSlow), [RunText.pace(km[4])]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
    }

    // "An Arnold gesendet", "Wird gesendet, sobald das Handy verbunden ist", ... (nothing without a sender).
    function statusLine(flow as RunEndFlow) as PairingLine or Null {
        var sender = flow.sender();
        if (sender == null) {
            return null;
        }
        var s = sender as RunSender;
        var phase = s.phaseOf(flow.session.uuid);
        if (phase == RunSender.PHASE_SENT) {
            var id = s.wasAlreadySent(flow.session.uuid) ? Rez.Strings.RunSentAlready : Rez.Strings.RunSentOk;
            return new PairingLine(HomeScreen.text(id), Graphics.FONT_XTINY, Graphics.COLOR_GREEN).skippable();
        }
        if (phase == RunSender.PHASE_REJECTED) {
            return new PairingLine(HomeScreen.text(Rez.Strings.RunSendRejected), Graphics.FONT_XTINY, Graphics.COLOR_ORANGE).skippable();
        }
        if (phase == RunSender.PHASE_SENDING && !s.isPhoneMissing()) {
            return new PairingLine(HomeScreen.text(Rez.Strings.RunSending), Graphics.FONT_XTINY, Graphics.COLOR_LT_GRAY).skippable();
        }
        if (phase == RunSender.PHASE_NONE) {
            return null;
        }
        return new PairingLine(HomeScreen.text(Rez.Strings.RunSendWait), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW).skippable();
    }
}

class RunEndView extends WatchUi.View {
    private var _flow as RunEndFlow;

    function initialize(flow as RunEndFlow) {
        View.initialize();
        _flow = flow;
    }

    function flow() as RunEndFlow {
        return _flow;
    }

    // The status line follows the sender while the summary is on screen.
    function onShow() as Void {
        var sender = _flow.sender();
        if (sender != null) {
            (sender as RunSender).setObserver(method(:onChanged));
        }
    }

    function onHide() as Void {
        var sender = _flow.sender();
        if (sender != null) {
            (sender as RunSender).setObserver(null);
        }
    }

    function onChanged() as Void {
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, RunEndScreens.lines(dc, _flow));
    }
}

class RunEndDelegate extends WatchUi.BehaviorDelegate {
    private var _flow as RunEndFlow;
    private var _nav as RunNav;

    function initialize(flow as RunEndFlow, nav as RunNav) {
        BehaviorDelegate.initialize();
        _flow = flow;
        _nav = nav;
    }

    function onNextPage() as Boolean {
        _flow.move(1);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _flow.move(-1);
        WatchUi.requestUpdate();
        return true;
    }

    function onSelect() as Boolean {
        _flow.confirm(_nav);
        return true;
    }

    function onBack() as Boolean {
        _flow.back(_nav);
        return true;
    }
}
