import Toybox.Graphics;
import Toybox.Lang;

// Page 1 of the run display in the design "Instrument": what the first page shows, as plain data
// (an InstrumentFace). No dc and no arithmetic of the run: the values come from the session and are
// turned into text here, so tests can read them. Orange always comes with a word ("Zu hoch", "Langsamer").
module RunFaces {
    const DASH as String = "–";                 // a value the watch does not have (never 0)
    const OK as Number = 0x55FF55;
    const WARN as Number = 0xFFAA00;
    const KIND_WORK as Number = 1;
    const KIND_RECOVERY as Number = 2;
    const KIND_REST as Number = 4;

    function first(session as RunSession) as InstrumentFace {
        var face = new InstrumentFace();
        var style = RunPages.styleOf(session);
        if (style == RunPages.STYLE_HEART) {
            heart(face, session);
        } else if (style == RunPages.STYLE_FREE) {
            free(face, session);
        } else {
            segmented(face, session, style == RunPages.STYLE_RUN_WALK);
        }
        standing(face, session);
        return face;
    }

    // "m:ss", from one hour "h:mm:ss" (no leading zero: the digits are big).
    function clock(seconds as Number) as String {
        var s = seconds < 0 ? 0 : seconds;
        var h = s / 3600;
        var m = (s % 3600) / 60;
        if (h > 0) {
            return h.toString() + ":" + m.format("%02d") + ":" + (s % 60).format("%02d");
        }
        return m.toString() + ":" + (s % 60).format("%02d");
    }

    function pace(secondsPerKm as Number or Null) as String {
        var text = RunText.pace(secondsPerKm);
        return text.equals(RunText.NONE) ? DASH : text;
    }

    function heartText(session as RunSession) as String {
        var hr = session.heartRate();
        return hr == null ? DASH : (hr as Number).toString();
    }

    // Page 1 of a heart rate run: heart rate | pace, the state, the time against the plan.
    function heart(face as InstrumentFace, session as RunSession) as Void {
        var plan = session.plan;
        var o = session.ordinal;
        var inPlan = o < plan.count();
        var type = inPlan ? plan.targetType(o) : 0;
        var low = inPlan ? plan.targetLow(o) : 0;
        var high = inPlan ? plan.targetHigh(o) : 0;
        if (type == 0 && session.mode == PreStartRequest.MODE_ZONE2) {
            type = 1;                  // the free zone 2 run has no plan, its target is zone 2
            low = 2;
            high = 2;
        }
        var fit = fitOf(session, type, low, high);
        if (type == 1) {
            face.top = [low == high ? Lang.format(HomeScreen.text(Rez.Strings.RunActualZone), [low]) : Lang.format(HomeScreen.text(Rez.Strings.RunZoneRange), [low, high])] as Array<String>;
        } else if (type == 3) {
            face.top = [Lang.format(HomeScreen.text(Rez.Strings.RunBpmRange), [low, high])] as Array<String>;
        } else {
            face.top = [runTypeName(plan.runKind())] as Array<String>;
        }
        if (type == 1 || type == 3) {
            if (fit == RunSession.FIT_OK) {
                face.status = HomeScreen.text(Rez.Strings.RunInTarget);
                face.statusColor = OK;
            } else if (fit != RunSession.FIT_NONE) {
                face.status = HomeScreen.text(fit == RunSession.FIT_ABOVE ? Rez.Strings.RunTooHigh : Rez.Strings.RunTooLow);
                face.statusColor = WARN;
                face.leftColor = WARN;
            }
        }
        pair(face, heartText(session), "bpm", pace(session.calc.paceDisplay()), "/km");
        if (type == 2) {
            face.rightColor = fitColor(fit);
        }
        if (fit != RunSession.FIT_NONE && fit != RunSession.FIT_OK) {
            face.bottom = word(type, fit);
            face.bottomColor = WARN;
        } else if (type == 2 || type == 4) {
            face.bottom = targetShort(type, low, high);
        } else {
            face.bottom = progressText(session);
        }
        timeRing(face, session);
    }

    // The name of the run type ("Base", "Long run", ...).
    function runTypeName(kind as Number) as String {
        var ids = [
            Rez.Strings.RunType0, Rez.Strings.RunType1, Rez.Strings.RunType2, Rez.Strings.RunType3,
            Rez.Strings.RunType4, Rez.Strings.RunType5, Rez.Strings.RunType6, Rez.Strings.RunType7,
            Rez.Strings.RunType8, Rez.Strings.RunType9, Rez.Strings.RunType10, Rez.Strings.RunType11,
            Rez.Strings.RunType12, Rez.Strings.RunType13
        ] as Array<ResourceId>;
        return HomeScreen.text(ids[kind >= 0 && kind < 14 ? kind : 13]);
    }

    // Time so far against the planned duration of the segment ("12:18 von 45:00"), else just the time.
    function progressText(session as RunSession) as String {
        var plan = session.plan;
        var o = session.ordinal;
        if (o < plan.count()) {
            var type = plan.durationType(o);
            if (type == RunSegments.DURATION_SECONDS) {
                return Lang.format(HomeScreen.text(Rez.Strings.RunOfTotal), [clock(session.segmentSeconds()), clock(plan.durationValue(o))]);
            }
            if (type == RunSegments.DURATION_METERS) {
                var total = plan.durationValue(o);
                if (total >= 1000) {
                    // "4,2 von 20 km": metres of a long segment do not fit the line ("21 m von 20000 m").
                    var done = session.segmentMeters();
                    return Lang.format(HomeScreen.text(Rez.Strings.RunOfTotal), [tenthKm(done < 0 ? 0 : done), Lang.format(HomeScreen.text(Rez.Strings.RunKm), [total % 1000 == 0 ? (total / 1000).toString() : tenthKm(total)])]);
                }
                return Lang.format(HomeScreen.text(Rez.Strings.RunOfTotal), [RunText.meters(session.segmentMeters()), RunText.meters(plan.durationValue(o))]);
            }
        }
        return clock(session.calc.timerS);
    }

    // Metres as km with one decimal: "4,2".
    function tenthKm(meters as Number) as String {
        var tenths = meters / 100;
        return (tenths / 10).toString() + HomeScreen.text(Rez.Strings.RunSep) + (tenths % 10).toString();
    }

    // The ring is the share of the planned duration of the segment that is over; none without a duration.
    function timeRing(face as InstrumentFace, session as RunSession) as Void {
        var share = share1000(session);
        if (share < 0) {
            return;
        }
        face.ring = InstrumentFace.RING_TIME;
        face.timeFrom = 0;
        face.timeLength = share * 360 / 1000;
    }

    // How far the segment is, 0..1000; -1 when it has no duration.
    function share1000(session as RunSession) as Number {
        var plan = session.plan;
        var o = session.ordinal;
        if (o >= plan.count()) {
            return -1;
        }
        var type = plan.durationType(o);
        var total = plan.durationValue(o);
        if (type == RunSegments.DURATION_OPEN || total <= 0) {
            return -1;
        }
        var spent = type == RunSegments.DURATION_SECONDS ? session.segmentSeconds() : session.segmentMeters();
        var share = spent * 1000 / total;
        return share < 0 ? 0 : (share > 1000 ? 1000 : share);
    }

    // Intervals and run-walk: "Belastung 3 von 6", what is left | pace, the target; the ring counts the work segments.
    function segmented(face as InstrumentFace, session as RunSession, runWalk as Boolean) as Void {
        var plan = session.plan;
        var o = session.ordinal;
        var kind = plan.kindOf(o);
        var counts = workCounts(plan, o);       // [work segments, work segments done before this one]
        var total = counts[0];
        var done = counts[1];
        var number = kind == KIND_WORK ? done + 1 : done;
        var name = phaseName(kind, runWalk);
        var numbered = total > 1 && number > 0 && (kind == KIND_WORK || kind == KIND_RECOVERY || kind == KIND_REST);
        face.top = [numbered ? Lang.format(HomeScreen.text(Rez.Strings.RunNOfM), [name, number, total]) : name] as Array<String>;
        var type = plan.targetType(o);
        var low = plan.targetLow(o);
        var high = plan.targetHigh(o);
        var fit = fitOf(session, type, low, high);
        var meters = session.segmentRemainingMeters();
        var seconds = session.segmentRemainingSeconds();
        if (seconds != null) {
            pair(face, clock(seconds as Number), HomeScreen.text(Rez.Strings.RunUnitLeft), pace(session.calc.paceDisplay()), "/km");
        } else if (meters != null) {
            pair(face, (meters as Number).toString(), "m", pace(session.calc.paceDisplay()), "/km");
        } else {
            pair(face, clock(session.segmentSeconds()), HomeScreen.text(Rez.Strings.RunUnitTime), pace(session.calc.paceDisplay()), "/km");
        }
        if (type == 2) {
            face.rightColor = fitColor(fit);
        }
        if (fit != RunSession.FIT_NONE && fit != RunSession.FIT_OK) {
            face.bottom = word(type, fit);
            face.bottomColor = WARN;
        } else if (type != 0) {
            face.bottom = targetShort(type, low, high);
        } else {
            face.bottom = Lang.format(HomeScreen.text(Rez.Strings.RunHeartLine), [heartText(session)]);
        }
        if (total > 0) {
            face.ring = InstrumentFace.RING_SEGMENTS;
            face.segments = total;
            face.done = done;
            var share = share1000(session);
            face.part = kind == KIND_WORK && share > 0 ? share : 0;
        }
    }

    function phaseName(kind as Number, runWalk as Boolean) as String {
        if (runWalk && kind == KIND_WORK) {
            return HomeScreen.text(Rez.Strings.RunPhaseRun);
        }
        if (runWalk && (kind == RunPages.SEGMENT_KIND_WALK || kind == KIND_REST)) {
            return HomeScreen.text(Rez.Strings.RunPhaseWalk);
        }
        return RunText.kindName(kind);
    }

    // [how many work segments the plan has, how many of them are before segment `ordinal`]
    function workCounts(plan as RunSegments, ordinal as Number) as Array<Number> {
        var total = 0;
        var done = 0;
        for (var i = 0; i < plan.count(); i++) {
            if (plan.kindOf(i) == KIND_WORK) {
                total++;
                if (i < ordinal) {
                    done++;
                }
            }
        }
        return [total, done] as Array<Number>;
    }

    // A free run (and what follows the last segment of a plan): time | distance, the pace below, no state, no ring.
    function free(face as InstrumentFace, session as RunSession) as Void {
        face.top = [HomeScreen.text(session.isPlanDone() ? Rez.Strings.RunPlanDone : Rez.Strings.RunType13)] as Array<String>;
        var unit = session.distanceIsEstimated() ? HomeScreen.text(Rez.Strings.RunUnitKmEst) : "km";
        pair(face, clock(session.calc.timerS), HomeScreen.text(Rez.Strings.RunUnitTime), RunText.km(session.calc.distanceCm), unit);
        face.bottom = Lang.format(HomeScreen.text(Rez.Strings.RunPace), [pace(session.calc.paceDisplay())]);
    }

    function pair(face as InstrumentFace, left as String, leftUnit as String, right as String, rightUnit as String) as Void {
        face.left = left;
        face.leftUnit = leftUnit;
        face.right = right;
        face.rightUnit = rightUnit;
    }

    // While the run stands still the word says so and the colours of the state are gone; the values stay.
    // The hint of the alarms (RUN-017) takes the bottom line for the seconds it lasts.
    function standing(face as InstrumentFace, session as RunSession) as Void {
        if (session.isPaused()) {
            face.status = null;
            face.leftColor = Graphics.COLOR_WHITE;
            face.rightColor = Graphics.COLOR_WHITE;
            face.bottom = HomeScreen.text(session.state == RunSession.STATE_AUTO_PAUSED ? Rez.Strings.RunAutoPaused : Rez.Strings.RunPaused);
            face.bottomColor = WARN;
            return;
        }
        var hint = session.alerts.currentHint();
        if (hint != null) {
            face.bottom = (hint as RunAlertHint).text;
            face.bottomColor = Graphics.COLOR_WHITE;
        }
    }

    // The target in few letters: the bottom line sits where the ring bends in ("Ziel 4:30–4:45", not "... /km").
    function targetShort(type as Number, low as Number, high as Number) as String {
        if (type == 2) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunTargetShort), [pace(low) + "–" + pace(high)]);
        }
        if (type == 3) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunBpmRange), [low, high]);
        }
        if (type == 4) {
            return Lang.format(HomeScreen.text(Rez.Strings.RunEffortRange), [low, high]);
        }
        return RunText.target(type, low, high);
    }

    // How the value stands against the target; FIT_NONE without a target or without the value.
    function fitOf(session as RunSession, type as Number, low as Number, high as Number) as Number {
        var actual = null;
        if (type == 1) {
            if (session.heartRate() == null) {
                return RunSession.FIT_NONE;
            }
            var zone = session.heartZone();
            if (zone == 0 && session.calc.zoneOf(1000) == 0) {
                return RunSession.FIT_NONE;      // no zones known: not "too low", just unknown
            }
            actual = zone;
        } else if (type == 2) {
            actual = session.calc.paceDisplay();
        } else if (type == 3) {
            actual = session.heartRate();
        }
        if (actual == null) {
            return RunSession.FIT_NONE;
        }
        if ((actual as Number) < low) {
            return RunSession.FIT_BELOW;
        }
        return (actual as Number) > high ? RunSession.FIT_ABOVE : RunSession.FIT_OK;
    }

    function fitColor(fit as Number) as Graphics.ColorType {
        if (fit == RunSession.FIT_OK) {
            return OK;
        }
        return fit == RunSession.FIT_NONE ? Graphics.COLOR_WHITE : WARN;
    }

    // What to do, in words. A pace under the range is faster than asked, a heart rate under it is too low.
    function word(type as Number, fit as Number) as String {
        var slower = type == 2 ? fit == RunSession.FIT_BELOW : fit == RunSession.FIT_ABOVE;
        return HomeScreen.text(slower ? Rez.Strings.RunAlSlower : Rez.Strings.RunAlFaster);
    }
}
