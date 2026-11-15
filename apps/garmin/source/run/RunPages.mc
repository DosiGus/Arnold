import Toybox.Graphics;
import Toybox.Lang;

// One page of the run display: its text lines and, on the heart rate page, the zone bar.
// The bar sits in the block like a line (a placeholder line with the colour COLOR_TRANSPARENT), so the
// layout of PairingLayout places it and drops optional lines when the block is too high.
class RunPage {
    var lines as Array<PairingLine>;
    var zone as Number;       // 0..5 = bar with this zone lit, -1 = no bar

    function initialize(pageLines as Array<PairingLine>, barZone as Number) {
        lines = pageLines;
        zone = barZone;
    }
}

// What each page of a run shows (RUN-016). The pages only read: every value comes from the session
// (RunSession, RunTick, RunSegments) and is turned into text here, nothing is calculated.
//   page 1  by run type: heart rate + zone bar / segment with target / run-walk / free run
//   page 2  time, distance, average pace, heart rate
//   page 3  last km, current lap, climb
//   page 4  the next segments (only with segments)
module RunPages {
    enum Style {
        STYLE_HEART,       // base, recovery, long run, zone 2: a heart rate run
        STYLE_SEGMENT,     // intervals, tempo, threshold, repetitions, hills, fartlek, ...
        STYLE_RUN_WALK,
        STYLE_FREE         // free run, and what follows the last segment of a plan
    }

    const SEGMENT_KIND_WORK as Number = 1;
    const SEGMENT_KIND_WALK as Number = 2;
    const SEGMENT_KIND_REST as Number = 4;
    const NEXT_LINES as Number = 3;

    function pageCount(session as RunSession) as Number {
        return session.plan.count() > 0 ? 4 : 3;
    }

    function styleOf(session as RunSession) as Number {
        var kind = session.plan.runKind();
        if (session.mode == PreStartRequest.MODE_ZONE2 || kind <= 2) {
            return STYLE_HEART;
        }
        if (session.plan.count() == 0 || session.isPlanDone()) {
            return STYLE_FREE;
        }
        return kind == 11 ? STYLE_RUN_WALK : STYLE_SEGMENT;
    }

    function build(dc as Dc, session as RunSession, index as Number) as RunPage {
        var out = [] as Array<PairingLine>;
        var zone = -1;
        var status = statusLine(session);
        if (status != null) {
            out.add((status as PairingLine).skippable());    // the main number turns orange as well, so a tight display loses the words first
        }
        var page = index < 0 ? 0 : (index >= pageCount(session) ? pageCount(session) - 1 : index);
        if (page == 0) {
            var hint = hintLine(session);
            if (hint != null) {
                out.add(hint as PairingLine);   // at the top, so the small lines below go before it on a tight display
            }
            zone = first(dc, session, out);
        } else if (page == 1) {
            second(dc, session, out);
        } else if (page == 2) {
            third(session, out);
        } else {
            fourth(session, out);
        }
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunPageOf), [page + 1, pageCount(session)]), Graphics.FONT_XTINY, Graphics.COLOR_DK_GRAY).skippable());
        if (status != null) {
            for (var i = 0; i < out.size(); i++) {
                if (out[i].wide) {
                    out[i].color = Graphics.COLOR_ORANGE;
                }
            }
        }
        return new RunPage(out, zone);
    }

    // "Pausiert" / "Auto-Pause" while the run stands still.
    function statusLine(session as RunSession) as PairingLine or Null {
        if (session.state == RunSession.STATE_AUTO_PAUSED) {
            return new PairingLine(HomeScreen.text(Rez.Strings.RunAutoPaused), Graphics.FONT_TINY, Graphics.COLOR_ORANGE);
        }
        if (session.state == RunSession.STATE_PAUSED) {
            return new PairingLine(HomeScreen.text(Rez.Strings.RunPaused), Graphics.FONT_TINY, Graphics.COLOR_ORANGE);
        }
        return null;
    }

    // The hint of the alarms (RUN-017), small, for the five seconds it lasts: "Puls zu hoch, langsamer", "Gleich: Belastung" ...
    // Optional like the other small lines, but on top of the page: a tight display drops the lines from the bottom, so it is the last to go.
    function hintLine(session as RunSession) as PairingLine or Null {
        var hint = session.alerts.currentHint();
        if (hint == null) {
            return null;
        }
        return new PairingLine((hint as RunAlertHint).text, Graphics.FONT_XTINY, Graphics.COLOR_YELLOW).skippable();
    }

    function bar() as PairingLine {
        return new PairingLine("-", Graphics.FONT_XTINY, Graphics.COLOR_TRANSPARENT);
    }

    function dim(text as String) as PairingLine {
        return new PairingLine(text, Graphics.FONT_TINY, Graphics.COLOR_LT_GRAY);
    }

    function fitColor(fit as Number) as Graphics.ColorType {
        if (fit == RunSession.FIT_OK) {
            return Graphics.COLOR_GREEN;
        }
        return fit == RunSession.FIT_NONE ? Graphics.COLOR_WHITE : Graphics.COLOR_ORANGE;
    }

    // Page 1. Returns the zone of the bar, -1 without one.
    function first(dc as Dc, session as RunSession, out as Array<PairingLine>) as Number {
        var style = styleOf(session);
        if (style == STYLE_HEART) {
            var hr = session.heartRate();
            out.add(PairingLayout.bigLine(dc, hr == null ? RunText.NONE : (hr as Number).toString(), Graphics.COLOR_WHITE));
            out.add(bar());
            out.add(new PairingLine(RunText.paceLine(session.calc.paceDisplay()), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
            out.add(new PairingLine(RunText.distance(session.calc.distanceCm, session.distanceIsEstimated()) + " · " + RunText.clock(session.calc.timerS), Graphics.FONT_TINY, Graphics.COLOR_LT_GRAY).shrinks(Graphics.FONT_XTINY));
            return session.heartZone();
        }
        if (style == STYLE_SEGMENT) {
            segmentPage(dc, session, out);
        } else if (style == STYLE_RUN_WALK) {
            runWalkPage(dc, session, out);
        } else {
            freePage(dc, session, out);
        }
        return -1;
    }

    // "3/6 · Belastung", big time or distance left, the target and what the run is at, the pace of the segment.
    function segmentPage(dc as Dc, session as RunSession, out as Array<PairingLine>) as Void {
        var plan = session.plan;
        var o = session.ordinal;
        out.add(dim(Lang.format(HomeScreen.text(Rez.Strings.RunHeadSeg), [session.segmentNumber(), plan.count(), RunText.kindName(plan.kindOf(o))])));
        out.add(PairingLayout.bigLine(dc, remaining(session), Graphics.COLOR_WHITE));
        var type = plan.targetType(o);
        if (type != 0) {
            out.add(dim(RunText.target(type, plan.targetLow(o), plan.targetHigh(o))).shrinks(Graphics.FONT_XTINY).skippable());
            var actual = actualText(session, type);
            if (actual != null) {
                out.add(new PairingLine(actual as String, Graphics.FONT_MEDIUM, fitColor(session.targetFit())));
            }
        } else {
            out.add(new PairingLine(RunText.paceLine(session.calc.paceDisplay()), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
            out.add(dim(RunText.heartLine(session.heartRate())).skippable());
        }
        out.add(dim(Lang.format(HomeScreen.text(Rez.Strings.RunSegAvg), [RunText.pace(session.segmentPace())])).skippable());
    }

    // The value of the segment's target the run is at; null for an effort target (nothing measures it).
    function actualText(session as RunSession, type as Number) as String or Null {
        var value = session.targetActual();
        if (type == 1) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunActualZone), [value == null ? RunText.NONE : value]);
        }
        if (type == 2) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunActualPace), [RunText.pace(value)]);
        }
        if (type == 3) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunActualBpm), [value == null ? RunText.NONE : value]);
        }
        return null;
    }

    // Time left (timed), distance left (distance), time of the segment so far (open).
    function remaining(session as RunSession) as String {
        var seconds = session.segmentRemainingSeconds();
        if (seconds != null) {
            return RunText.clock(seconds as Number);
        }
        var meters = session.segmentRemainingMeters();
        if (meters != null) {
            return RunText.meters(meters as Number);
        }
        return RunText.clock(session.segmentSeconds());
    }

    // "LAUFEN" / "GEHEN", the time left of it, "Runde 3 von 8".
    function runWalkPage(dc as Dc, session as RunSession, out as Array<PairingLine>) as Void {
        var plan = session.plan;
        var o = session.ordinal;
        var round = plan.roundOf(o);
        if (round != null) {
            out.add(dim(Lang.format(HomeScreen.text(Rez.Strings.RunRoundOf), [(round as Array<Number>)[0], (round as Array<Number>)[1]])));
        } else {
            out.add(dim(Lang.format(HomeScreen.text(Rez.Strings.RunSegmentOf), [session.segmentNumber(), plan.count()])));
        }
        var kind = plan.kindOf(o);
        var walking = kind == SEGMENT_KIND_WALK || kind == SEGMENT_KIND_REST;
        var label = kind == SEGMENT_KIND_WORK ? HomeScreen.text(Rez.Strings.RunRunNow) : (walking ? HomeScreen.text(Rez.Strings.RunWalkNow) : RunText.kindName(kind));
        out.add(new PairingLine(label, Graphics.FONT_LARGE, kind == SEGMENT_KIND_WORK ? Graphics.COLOR_GREEN : Graphics.COLOR_YELLOW));
        out.add(PairingLayout.bigLine(dc, remaining(session), Graphics.COLOR_WHITE));
        out.add(dim(RunText.heartLine(session.heartRate())).skippable());
    }

    // Time, distance, pace, heart rate of a run without segments.
    function freePage(dc as Dc, session as RunSession, out as Array<PairingLine>) as Void {
        if (session.isPlanDone()) {
            out.add(dim(HomeScreen.text(Rez.Strings.RunPlanDone)).skippable());
        }
        out.add(PairingLayout.bigLine(dc, RunText.clock(session.calc.timerS), Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunText.distance(session.calc.distanceCm, session.distanceIsEstimated()), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunText.paceLine(session.calc.paceDisplay()), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunText.heartLine(session.heartRate()), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
    }

    // Page 2: time, distance, average pace, heart rate.
    function second(dc as Dc, session as RunSession, out as Array<PairingLine>) as Void {
        out.add(PairingLayout.bigLine(dc, RunText.clock(session.calc.timerS), Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunText.distance(session.calc.distanceCm, session.distanceIsEstimated()), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunSegAvg), [RunText.pace(session.calc.paceAverage())]), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        out.add(new PairingLine(RunText.heartLine(session.heartRate()), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
    }

    // Page 3: the last full km, the lap running now, the climb (a treadmill has none).
    function third(session as RunSession, out as Array<PairingLine>) as Void {
        var km = session.calc.lastKmSeconds();
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunLastKm), [RunText.pace(km)]), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunLapLine), [session.laps + 1, RunText.clock(session.segmentSeconds())]), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE).shrinks(Graphics.FONT_TINY));
        var climb = session.distanceIsEstimated() ? RunText.NONE : session.calc.ascentM.toString();
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.RunAscent), [climb]), Graphics.FONT_MEDIUM, Graphics.COLOR_LT_GRAY));
    }

    // Page 4: the segments after the one being run.
    function fourth(session as RunSession, out as Array<PairingLine>) as Void {
        var plan = session.plan;
        var first = session.ordinal + 1;
        if (first >= plan.count()) {
            out.add(new PairingLine(HomeScreen.text(Rez.Strings.RunNextNone), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
            return;
        }
        out.add(dim(HomeScreen.text(Rez.Strings.RunNext)));
        for (var k = 0; k < NEXT_LINES && first + k < plan.count(); k++) {
            var o = first + k;
            var line = new PairingLine(RunText.kindName(plan.kindOf(o)) + " " + RunText.duration(plan.durationType(o), plan.durationValue(o)), Graphics.FONT_SMALL, Graphics.COLOR_WHITE);
            out.add(k == 0 ? line : line.skippable());
            var type = plan.targetType(o);
            if (type != 0) {
                out.add(dim(RunText.target(type, plan.targetLow(o), plan.targetHigh(o))).shrinks(Graphics.FONT_XTINY).skippable());
            }
        }
    }

    // The reduced picture of the energy saving mode (AMOLED): minutes, distance, nothing else, dark grey.
    function sleepLines(session as RunSession) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.HomeMinutes), [session.calc.timerS / 60]), Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
        out.add(new PairingLine(RunText.distance(session.calc.distanceCm, session.distanceIsEstimated()), Graphics.FONT_TINY, Graphics.COLOR_DK_GRAY));
        return out;
    }
}

// Draws a page: black background, the block of lines centred, the zone bar where its placeholder sits.
module RunLayout {
    const ZONE_COLORS as Array<Number> = [Graphics.COLOR_BLUE, Graphics.COLOR_GREEN, Graphics.COLOR_YELLOW, Graphics.COLOR_ORANGE, Graphics.COLOR_RED];

    // dx and dy move the whole block (the energy saving picture moves a little every minute against burn-in).
    function draw(dc as Dc, lines as Array<PairingLine>, zone as Number, dx as Number, dy as Number) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var drawn = PairingLayout.arrange(dc, lines);
        var y = (h - PairingLayout.blockHeight(dc, drawn)) / 2 + dy;
        for (var i = 0; i < drawn.size(); i++) {
            var height = dc.getFontHeight(drawn[i].font);
            if (drawn[i].color == Graphics.COLOR_TRANSPARENT) {
                drawBar(dc, w / 2 + dx, y, height, zone);
            } else {
                dc.setColor(drawn[i].color, Graphics.COLOR_BLACK);
                dc.drawText(w / 2 + dx, y, drawn[i].font, drawn[i].text, Graphics.TEXT_JUSTIFY_CENTER);
            }
            y += height;
        }
    }

    // Five segments, the zones up to the current one lit in their colour.
    function drawBar(dc as Dc, centerX as Number, top as Number, slot as Number, zone as Number) as Void {
        var total = dc.getWidth() * 60 / 100;
        var gap = dc.getWidth() / 70 + 1;
        var each = (total - 4 * gap) / 5;
        var height = slot * 60 / 100;
        var y = top + (slot - height) / 2;
        var x = centerX - total / 2;
        for (var z = 0; z < 5; z++) {
            dc.setColor(z < zone ? ZONE_COLORS[z] : Graphics.COLOR_DK_GRAY, Graphics.COLOR_BLACK);
            dc.fillRectangle(x + z * (each + gap), y, each, height);
        }
    }
}
