import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// The end of a run (RUN-018): summary on every display, the treadmill correction, the effort question, the request to
// POST /runs against the contract (strict keys, types, limits), the heart rate only with the consent, the run outbox
// (20 failed tries, no phone, an app that stopped after SAVE) and the hint line of the alarms on the run display.

// A JSON writer for the lines the end-to-end check sends to the mock server (the simulator prints them).
(:test)
module RunJson {
    function write(value as Object or Null) as String {
        if (value == null) {
            return "null";
        }
        if (value instanceof String) {
            return "\"" + (value as String) + "\"";
        }
        if (value instanceof Boolean) {
            return (value as Boolean) ? "true" : "false";
        }
        if (value instanceof Array) {
            var items = "";
            for (var i = 0; i < (value as Array).size(); i++) {
                items += (i > 0 ? "," : "") + write((value as Array)[i] as Object or Null);
            }
            return "[" + items + "]";
        }
        if (value instanceof Dictionary) {
            var keys = (value as Dictionary).keys();
            var out = "";
            for (var i = 0; i < keys.size(); i++) {
                out += (i > 0 ? "," : "") + "\"" + (keys[i] as String) + "\":" + write((value as Dictionary)[keys[i]] as Object or Null);
            }
            return "{" + out + "}";
        }
        return (value as Object).toString();
    }
}

// Typed reading of what a request holds (the SDK's type check does not know the values of a dictionary).
(:test)
module Wire {
    function missing(dict as Dictionary, key as String) as Boolean {
        return Expect.valueOf(dict, key) == null;
    }

    function present(dict as Dictionary, key as String) as Boolean {
        return Expect.valueOf(dict, key) != null;
    }

    function text(dict as Dictionary, key as String) as String {
        return Expect.valueOf(dict, key) as String;
    }

    function list(dict as Dictionary, key as String) as Array {
        return Expect.valueOf(dict, key) as Array;
    }

    function numberAt(items as Array, index as Number) as Number {
        return items[index] as Number;
    }
}

// The rules of WatchRunRequestSchema (src/shared/run-contract.ts) as far as they can be said without the schema library:
// the keys the strict object allows, the required ones, the types and limits, the order of splits and segments, and no
// place anywhere in the request. Returns what is wrong, or null.
(:test)
module PayloadCheck {
    const ALLOWED as Array<String> = ["request_id", "session_uuid", "planned_workout_id", "workout_date_local", "utc_offset_min",
        "started_at_utc", "ended_at_utc", "environment", "run_type", "timer_s", "elapsed_s", "distance_m", "distance_source",
        "ascent_m", "cadence_spm", "calories_kcal", "te_aerobic", "splits", "pauses", "segments", "hr", "rpe"] as Array<String>;
    const REQUIRED as Array<String> = ["request_id", "session_uuid", "workout_date_local", "utc_offset_min", "started_at_utc",
        "ended_at_utc", "environment", "run_type", "timer_s", "elapsed_s", "distance_m", "distance_source", "splits", "pauses",
        "segments"] as Array<String>;
    const NUMBERS as Array<String> = ["utc_offset_min", "timer_s", "elapsed_s", "distance_m", "pauses"] as Array<String>;
    const STRINGS as Array<String> = ["request_id", "session_uuid", "workout_date_local", "started_at_utc", "ended_at_utc",
        "environment", "run_type", "distance_source"] as Array<String>;
    const FORBIDDEN as Array<String> = ["lat", "lon", "coord", "position", "gps", "track", "route", "location"] as Array<String>;

    function contains(list as Array<String>, value as String) as Boolean {
        return list.indexOf(value) >= 0;
    }

    function whole(value as Object or Null, low as Number, high as Number) as Boolean {
        return value instanceof Number && (value as Number) >= low && (value as Number) <= high;
    }

    function isUuid(text as String) as Boolean {
        if (text.length() != 36) {
            return false;
        }
        var dashes = [8, 13, 18, 23] as Array<Number>;
        for (var i = 0; i < 36; i++) {
            var c = text.substring(i, i + 1) as String;
            if (dashes.indexOf(i) >= 0) {
                if (!c.equals("-")) {
                    return false;
                }
            } else if ("0123456789abcdef".find(c) == null) {
                return false;
            }
        }
        return part(text, 14, 15).equals("4") && "89ab".find(part(text, 19, 20)) != null;
    }

    function part(text as String, from as Number, to as Number) as String {
        return text.substring(from, to) as String;
    }

    function isIso(text as String) as Boolean {
        return text.length() == 20 && part(text, 4, 5).equals("-") && part(text, 10, 11).equals("T") && part(text, 19, 20).equals("Z");
    }

    function problem(body as Dictionary, consent as Boolean) as String or Null {
        var keys = body.keys();
        for (var i = 0; i < keys.size(); i++) {
            if (!contains(ALLOWED, keys[i] as String)) {
                return "key not in the contract: " + (keys[i] as String);
            }
        }
        for (var i = 0; i < REQUIRED.size(); i++) {
            if (body[REQUIRED[i]] == null) {
                return "missing: " + REQUIRED[i];
            }
        }
        for (var i = 0; i < NUMBERS.size(); i++) {
            if (!(body[NUMBERS[i]] instanceof Number)) {
                return "not a whole number: " + NUMBERS[i];
            }
        }
        for (var i = 0; i < STRINGS.size(); i++) {
            if (!(body[STRINGS[i]] instanceof String)) {
                return "not a text: " + STRINGS[i];
            }
        }
        var found = places(body, "");
        if (found != null) {
            return found;
        }
        var requestId = body["request_id"] as String;
        if (requestId.length() < 1 || requestId.length() > 128 || !requestId.equals("gr_" + (body["session_uuid"] as String))) {
            return "request_id " + requestId;
        }
        if (!isUuid(body["session_uuid"] as String)) {
            return "session_uuid " + (body["session_uuid"] as String);
        }
        if (!isIso(body["started_at_utc"] as String) || !isIso(body["ended_at_utc"] as String)) {
            return "times " + (body["started_at_utc"] as String) + " " + (body["ended_at_utc"] as String);
        }
        if (!whole(body["utc_offset_min"] as Object or Null, -840, 840) || (body["workout_date_local"] as String).length() != 10) {
            return "offset or date";
        }
        if (!contains(["outdoor", "treadmill", "track"] as Array<String>, body["environment"] as String)
            || !contains(RunUpload.RUN_TYPES, body["run_type"] as String) || !contains(["gps", "sensor", "corrected"] as Array<String>, body["distance_source"] as String)) {
            return "environment, run_type or distance_source";
        }
        if (!whole(body["timer_s"] as Object or Null, 0, 36000) || !whole(body["elapsed_s"] as Object or Null, 0, 36000) || (body["timer_s"] as Number) > (body["elapsed_s"] as Number)
            || !whole(body["distance_m"] as Object or Null, 0, 100000) || !whole(body["pauses"] as Object or Null, 0, 1000)) {
            return "timer, elapsed, distance or pauses";
        }
        var optional = [["ascent_m", 0, 100000], ["cadence_spm", 1, 300], ["calories_kcal", 0, 20000], ["rpe", 1, 10]] as Array;
        for (var i = 0; i < optional.size(); i++) {
            var spec = optional[i] as Array;
            if (body[spec[0] as String] != null && !whole(body[spec[0] as String] as Object or Null, spec[1] as Number, spec[2] as Number)) {
                return "range of " + (spec[0] as String);
            }
        }
        var te = body["te_aerobic"];
        if (te != null && (!(te instanceof Float) || (te as Float) < 0 || (te as Float) > 5)) {
            return "te_aerobic";
        }
        var other = splitsAndSegments(body);
        if (other != null) {
            return other;
        }
        return heart(body, consent);
    }

    // No key anywhere may name a place (the run has no coordinates).
    function places(value as Object or Null, path as String) as String or Null {
        if (value instanceof Dictionary) {
            var keys = (value as Dictionary).keys();
            for (var i = 0; i < keys.size(); i++) {
                var name = (keys[i] as String).toLower();
                for (var f = 0; f < FORBIDDEN.size(); f++) {
                    if (name.find(FORBIDDEN[f]) != null) {
                        return "place in " + path + "/" + (keys[i] as String);
                    }
                }
                var inner = places((value as Dictionary)[keys[i]] as Object or Null, path + "/" + (keys[i] as String));
                if (inner != null) {
                    return inner;
                }
            }
        } else if (value instanceof Array) {
            for (var i = 0; i < (value as Array).size(); i++) {
                var inner = places((value as Array)[i] as Object or Null, path + "[]");
                if (inner != null) {
                    return inner;
                }
            }
        }
        return null;
    }

    function splitsAndSegments(body as Dictionary) as String or Null {
        var splits = body["splits"];
        if (!(splits instanceof Array) || (splits as Array).size() > 600 || (splits as Array).size() * 100 > (body["distance_m"] as Number) + 100) {
            return "splits: count";
        }
        for (var i = 0; i < (splits as Array).size(); i++) {
            var value = (splits as Array)[i];
            if (!whole(value as Object or Null, 0, body["timer_s"] as Number) || (i > 0 && (value as Number) < ((splits as Array)[i - 1] as Number))) {
                return "splits: value " + i;
            }
        }
        var segments = body["segments"];
        if (!(segments instanceof Array) || (segments as Array).size() > 80) {
            return "segments: count";
        }
        var allowed = ["i", "rep", "kind", "st", "t", "dm", "tz", "hr"] as Array<String>;
        for (var i = 0; i < (segments as Array).size(); i++) {
            var s = (segments as Array)[i] as Dictionary;
            var names = s.keys();
            for (var k = 0; k < names.size(); k++) {
                if (!contains(allowed, names[k] as String)) {
                    return "segment key " + (names[k] as String);
                }
            }
            if (!whole(s["i"] as Object or Null, i, i) || !whole(s["kind"] as Object or Null, 0, 5) || !whole(s["st"] as Object or Null, 0, 2)
                || !whole(s["t"] as Object or Null, 0, 36000) || !whole(s["dm"] as Object or Null, 0, 100000)) {
                return "segment " + i + " numbers";
            }
            if (s["rep"] != null && !whole(s["rep"] as Object or Null, 1, 50)) {
                return "segment " + i + " rep";
            }
            if (s["tz"] != null && (!whole(s["tz"] as Object or Null, 0, 36000) || (s["tz"] as Number) > (s["t"] as Number))) {
                return "segment " + i + " tz";
            }
            var hr = s["hr"];
            if (hr != null && (!(hr instanceof Array) || (hr as Array).size() != 2 || !whole((hr as Array)[0] as Object or Null, 30, 250)
                || !whole((hr as Array)[1] as Object or Null, 30, 250) || ((hr as Array)[0] as Number) > ((hr as Array)[1] as Number))) {
                return "segment " + i + " hr";
            }
        }
        return null;
    }

    // The heart rate summary: only with the consent, with the five zone seconds and six ascending bounds or neither.
    function heart(body as Dictionary, consent as Boolean) as String or Null {
        var hr = body["hr"];
        var segments = body["segments"] as Array;
        if (!consent) {
            if (hr != null) {
                return "hr without the consent";
            }
            for (var i = 0; i < segments.size(); i++) {
                if ((segments[i] as Dictionary)["hr"] != null) {
                    return "segment hr without the consent";
                }
            }
            return null;
        }
        if (hr == null) {
            return null;
        }
        var h = hr as Dictionary;
        var names = h.keys();
        for (var i = 0; i < names.size(); i++) {
            if (!contains(["avg", "max", "zone_s", "zones", "zones_sport"] as Array<String>, names[i] as String)) {
                return "hr key " + (names[i] as String);
            }
        }
        if (!whole(h["avg"] as Object or Null, 30, 250) || !whole(h["max"] as Object or Null, 30, 250) || (h["avg"] as Number) > (h["max"] as Number)) {
            return "hr avg/max";
        }
        var zones = h["zones"];
        var seconds = h["zone_s"];
        if ((zones == null) != (seconds == null)) {
            return "zones and zone_s come together";
        }
        if (zones != null) {
            if (!(zones instanceof Array) || (zones as Array).size() != 6 || !(seconds instanceof Array) || (seconds as Array).size() != 5
                || !"running".equals(h["zones_sport"] as Object or Null)) {
                return "zones shape";
            }
            for (var i = 0; i < 6; i++) {
                if (!whole((zones as Array)[i] as Object or Null, 30, 250) || (i > 0 && ((zones as Array)[i] as Number) <= ((zones as Array)[i - 1] as Number))) {
                    return "zone bound " + i;
                }
            }
        }
        return null;
    }
}

// A run that was saved, a fake network and the outbox, the way the app has them after SAVE.
(:test)
class EndRig {
    var sim as RunSim;
    var transport as FakeTransport;
    var clientTimer as FakeScheduler;
    var client as ApiClient;
    var outbox as RunOutbox;
    var sender as RunSender;
    var rejected as CallCounter;
    var nav as FakeRunNav;
    var flow as RunEndFlow;
    var consent as Boolean;

    // `seconds` of running at `speed` (cm/s) and then SAVE; the flow is at its first question.
    function initialize(runSim as RunSim, speed as Number, seconds as Number, withConsent as Boolean) {
        sim = runSim;
        consent = withConsent;
        sim.source.speed = speed;
        sim.seconds(seconds);
        var clock = sim.parts.clock as FakeClock;
        clock.now += seconds;
        transport = new FakeTransport();
        clientTimer = new FakeScheduler();
        client = new ApiClient("http://mock/api/watch/v1", transport, clientTimer);
        outbox = new RunOutbox(sim.store);
        rejected = new CallCounter();
        sender = new RunSender(client, outbox, sim.parts.journal, sim.parts.clock, rejected.method(:onCall));
        nav = new FakeRunNav();
        var saved = sim.session.save();
        flow = new RunEndFlow(sim.session, saved, true, sender, consent);
        flow.begin(nav);
    }

    function uuid() as String {
        return sim.session.uuid;
    }

    // All questions answered with START (the preselected values), the run is queued and being sent.
    function confirmAll() as Void {
        while (flow.step != RunEndFlow.STEP_SUMMARY) {
            flow.confirm(nav);
        }
    }

    function queuedBody() as Dictionary {
        return (outbox.get(uuid()) as Dictionary)["b"] as Dictionary;
    }

    function sentBody(index as Number) as Dictionary {
        return transport.requests[index].body as Dictionary;
    }

    function built() as Dictionary {
        return RunUpload.build(sim.session, consent, sim.parts.zones, sim.parts.clock.utcOffsetMinutes());
    }

    static function accepted(rig as EndRig) as Void {
        rig.transport.respond(201, { "api_version" => 1, "min_app_version" => "1.0.0", "workout_id" => "wo_1", "replayed" => false, "hr_discarded" => false });
    }

    // The server does not answer (503) until the client gives up for now.
    function failOnce() as Void {
        if (!sender.isSending()) {
            sender.sendAll();
        }
        for (var i = 0; i < 12 && sender.isSending(); i++) {
            transport.respond(503, null);
            if (clientTimer.pendingCallback != null) {
                clientTimer.fire();
            }
        }
    }
}

// The lines of the end screens must fit every display and no word may be wider than the display.
(:test)
module EndRigCheck {
    function lines(dc as Dc, flow as RunEndFlow, label as String) as Void {
        var lines = RunEndScreens.lines(dc, flow);
        Test.assertMessage(LayoutRig.fits(dc, lines), label + " fits: " + ViewRig.heights(dc, lines));
        if (label.find(" page ") != null) {    // the summary pages keep every line on one line, in either language (RUN-030)
            Test.assertMessage(LayoutRig.wrapped(dc, lines).length() == 0, label + " wraps '" + LayoutRig.wrapped(dc, lines) + "': " + ViewRig.heights(dc, lines));
        }
        var drawn = PairingLayout.arrange(dc, lines);
        for (var i = 0; i < drawn.size(); i++) {
            Test.assertMessage(dc.getTextWidthInPixels(drawn[i].text, drawn[i].font) <= dc.getWidth(), label + " width of '" + drawn[i].text + "'");
        }
        PairingLayout.draw(dc, lines);
    }

    // The questions and every page of the summary.
    function all(dc as Dc, rig as EndRig, label as String) as Void {
        while (rig.flow.step != RunEndFlow.STEP_SUMMARY) {
            lines(dc, rig.flow, label + " question " + rig.flow.step);
            rig.flow.confirm(rig.nav);
        }
        var count = rig.flow.pageCount();
        for (var p = 0; p < count; p++) {
            rig.flow.page = p;
            lines(dc, rig.flow, label + " page " + (p + 1));
        }
    }

    function texts(dc as Dc, flow as RunEndFlow) as String {
        var joined = "";
        var lines = RunEndScreens.lines(dc, flow);
        for (var i = 0; i < lines.size(); i++) {
            joined += lines[i].text + "|";
        }
        return joined;
    }
}

(:test)
function theEndScreensFitEveryDisplayForEveryRunType(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var all = ViewRig.sims();
    for (var i = 0; i < all.size(); i++) {
        var rig = new EndRig(all[i], 400, 130, true);
        Test.assertMessage(rig.flow.step == (rig.sim.session.distanceIsEstimated() ? RunEndFlow.STEP_CORRECT : RunEndFlow.STEP_EFFORT), "first step of sim " + i);
        EndRigCheck.all(dc, rig, "sim " + i);
        Test.assertEqual(rig.flow.step, RunEndFlow.STEP_SUMMARY);
    }
    return true;
}

(:test)
function longRunsAndOddResultsFitToo(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    // three hours on the treadmill, 37 km: all pages with kilometres
    var long = new EndRig(new RunSim(ViewRig.body(1, [ViewRig.seg(1, 0, 0, 0, 0, 0)] as Array, null), PreStartModel.ENV_TREADMILL, false), 1000, 3700, true);
    EndRigCheck.all(dc, long, "long");
    // no heart rate at all, a failed save, nothing run yet
    var plain = new RunSim(null, 0, false);
    plain.source.hr = null;
    var none = new EndRig(plain, 300, 40, true);
    EndRigCheck.all(dc, none, "no heart rate");
    var empty = new EndRig(new RunSim(null, 0, false), 0, 1, true);
    EndRigCheck.all(dc, empty, "standing");
    var failed = new EndRig(new RunSim(null, 0, false), 300, 20, true);
    failed.flow.saved = false;
    EndRigCheck.all(dc, failed, "not saved");
    return true;
}

(:test)
function theSummaryShowsWhatTheRunTypeHas(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    // free run, 1.25 km: two pages and a third with the kilometres
    var free = new EndRig(new RunSim(null, 0, false), 500, 250, true);
    free.confirmAll();
    Test.assertEqual(free.flow.pageCount(), 3);
    free.flow.page = 0;
    var one = EndRigCheck.texts(dc, free.flow);
    Test.assertMessage(one.find(RunText.km(125000) + "|") != null && one.find("km") != null && one.find(RunText.clock(250)) != null && one.find("3:20") != null, "page 1: " + one);
    free.flow.page = 1;
    var two = EndRigCheck.texts(dc, free.flow);
    Test.assertMessage(two.find("140") != null, "page 2 heart rate: " + two);
    free.flow.page = 2;
    var three = EndRigCheck.texts(dc, free.flow);
    Test.assertMessage(three.find(Lang.format(HomeScreen.text(Rez.Strings.RunSumKms), [1])) != null, "page 3 kilometres: " + three);
    // a short free run has no kilometre: two pages
    var short = new EndRig(new RunSim(null, 0, false), 300, 60, true);
    short.confirmAll();
    Test.assertEqual(short.flow.pageCount(), 2);
    // intervals: the third page counts the work segments
    var intervals = new EndRig(new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 30, 0, 0, 0), ViewRig.seg(2, 1, 20, 0, 0, 0)] as Array, [[0, 1, 3]] as Array), 0, false), 400, 160, true);
    intervals.confirmAll();
    Test.assertEqual(intervals.flow.pageCount(), 3);
    intervals.flow.page = 2;
    var work = EndRigCheck.texts(dc, intervals.flow);
    Test.assertMessage(work.find(Lang.format(HomeScreen.text(Rez.Strings.RunSumWork), [3, "4:10"])) != null, "work page: " + work);
    // no heart rate: page 2 says so
    var plain = new RunSim(null, 0, false);
    plain.source.hr = null;
    var quiet = new EndRig(plain, 300, 30, true);
    quiet.confirmAll();
    quiet.flow.page = 1;
    Test.assertMessage(EndRigCheck.texts(dc, quiet.flow).find(HomeScreen.text(Rez.Strings.RunSumNoHeart)) != null, "no heart rate");
    // UP and DOWN turn the pages around
    short.flow.page = 0;
    short.flow.move(1);
    Test.assertEqual(short.flow.page, 1);
    short.flow.move(1);
    Test.assertEqual(short.flow.page, 0);
    short.flow.move(-1);
    Test.assertEqual(short.flow.page, 1);
    return true;
}

(:test)
function theTreadmillAsksToCorrectTheDistanceInSteps(logger as Logger) as Boolean {
    var rig = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 400, true);   // 1200 m by the watch
    Test.assertEqual(rig.flow.step, RunEndFlow.STEP_CORRECT);
    Test.assertEqual(rig.nav.flows.size(), 1);
    Test.assertEqual(rig.flow.distanceCm, 120000);
    rig.flow.move(-1);                                    // UP raises
    rig.flow.move(-1);
    rig.flow.move(-1);
    Test.assertEqual(rig.flow.distanceCm, 123000);        // three steps of 10 m
    rig.flow.move(1);
    Test.assertEqual(rig.flow.distanceCm, 122000);        // DOWN lowers
    rig.flow.confirm(rig.nav);
    Test.assertEqual(rig.flow.step, RunEndFlow.STEP_EFFORT);
    Test.assertEqual(rig.sim.session.correctedCm, 122000);
    rig.flow.confirm(rig.nav);
    var body = rig.queuedBody();
    Expect.field(body, "distance_m", 1220);
    Expect.field(body, "distance_source", "corrected");
    Expect.field(body, "environment", "treadmill");
    Test.assertEqual(rig.sim.session.resultDistanceCm(), 122000);
    Test.assertEqual(rig.flow.step, RunEndFlow.STEP_SUMMARY);
    // the correction survives a crash: it is in the journal
    var again = new RunParts(new RunJournal(rig.sim.store), rig.sim.parts.clock, new Settings(rig.sim.store), rig.sim.source, rig.sim.backend, null, rig.sim.parts.zones);
    var reopened = RunSession.reopenSaved(again) as RunSession;
    Test.assertEqual(reopened.resultDistanceCm(), 122000);
    return true;
}

(:test)
function aTreadmillRunKeepsTheWatchDistanceWhenItIsNotCorrected(logger as Logger) as Boolean {
    // START without a change: the watch's distance, source "sensor"
    var same = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 400, true);
    same.flow.confirm(same.nav);
    Test.assertEqual(same.sim.session.correctedCm, -1);
    same.flow.confirm(same.nav);
    Expect.field(same.queuedBody(), "distance_source", "sensor");
    Expect.field(same.queuedBody(), "distance_m", 1200);
    // BACK skips the correction
    var skipped = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 400, true);
    skipped.flow.move(-1);
    skipped.flow.back(skipped.nav);
    Test.assertEqual(skipped.flow.step, RunEndFlow.STEP_EFFORT);
    Test.assertEqual(skipped.sim.session.correctedCm, -1);
    skipped.flow.confirm(skipped.nav);
    Expect.field(skipped.queuedBody(), "distance_source", "sensor");
    // corrected back to the watch's number counts as not corrected
    var back = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 400, true);
    back.flow.move(-1);
    back.flow.move(1);
    back.flow.confirm(back.nav);
    Test.assertEqual(back.sim.session.correctedCm, -1);
    // the distance cannot go below nothing
    var low = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 10, 40, true);   // 4 m
    for (var i = 0; i < 5; i++) {
        low.flow.move(1);
    }
    Test.assertEqual(low.flow.distanceCm, 0);
    // outdoors there is no correction: the effort comes first
    var outdoor = new EndRig(new RunSim(null, 0, false), 300, 60, true);
    Test.assertEqual(outdoor.flow.step, RunEndFlow.STEP_EFFORT);
    Test.assert(!outdoor.flow.needsCorrection());
    return true;
}

(:test)
function theEffortStartsOnWhatTheRunTypeExpectsAndOnePressTakesIt(logger as Logger) as Boolean {
    var free = new EndRig(new RunSim(null, 0, false), 300, 60, true);
    Test.assertEqual(free.flow.effort, RunEffort.expected(13));
    free.flow.confirm(free.nav);                          // one press
    Test.assertEqual(free.flow.presses, 1);
    Test.assertEqual(free.sim.session.effort, RunEffort.expected(13));
    Expect.field(free.queuedBody(), "rpe", RunEffort.expected(13));
    Test.assertEqual(free.flow.step, RunEndFlow.STEP_SUMMARY);
    var intervals = new EndRig(new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 30, 0, 0, 0)] as Array, null), 0, false), 300, 60, true);
    Test.assertEqual(intervals.flow.effort, 8);
    // UP and DOWN change it by one, within 1 to 10
    intervals.flow.move(-1);
    Test.assertEqual(intervals.flow.effort, 9);
    intervals.flow.move(-1);
    intervals.flow.move(-1);
    Test.assertEqual(intervals.flow.effort, 10);
    intervals.flow.confirm(intervals.nav);
    Expect.field(intervals.queuedBody(), "rpe", 10);
    var low = new EndRig(new RunSim(null, 0, false), 300, 60, true);
    for (var i = 0; i < 12; i++) {
        low.flow.move(1);
    }
    Test.assertEqual(low.flow.effort, 1);
    // every run type expects a value in range and every step has its word
    for (var kind = -1; kind <= 14; kind++) {
        Test.assert(RunEffort.expected(kind) >= 1 && RunEffort.expected(kind) <= 10);
    }
    var seen = "";
    for (var level = 1; level <= 10; level++) {
        Test.assert(RunEffort.word(level).length() > 0);
        seen += RunEffort.word(level) + "|";
    }
    Test.assertMessage(RunEffort.word(1).equals(RunEffort.word(2)) && !RunEffort.word(2).equals(RunEffort.word(3)), "five words: " + seen);
    return true;
}

(:test)
function skippingTheEffortSendsNoEffortAndTakesOnePress(logger as Logger) as Boolean {
    var rig = new EndRig(new RunSim(null, 0, false), 300, 60, true);
    rig.flow.back(rig.nav);                               // one press
    Test.assertEqual(rig.flow.presses, 1);
    Test.assertEqual(rig.sim.session.effort, 0);
    Test.assert(Wire.missing(rig.queuedBody(), "rpe"));         // unknown, never a made-up value
    Test.assertEqual(rig.flow.step, RunEndFlow.STEP_SUMMARY);
    Expect.equal(PayloadCheck.problem(rig.queuedBody(), true), null);
    // the treadmill: distance and effort, two presses at most when nothing is changed
    var tread = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 400, true);
    tread.flow.confirm(tread.nav);
    tread.flow.confirm(tread.nav);
    Test.assertEqual(tread.flow.presses, 2);
    Test.assertEqual(tread.flow.step, RunEndFlow.STEP_SUMMARY);
    // on the summary START and BACK leave the screen
    tread.flow.confirm(tread.nav);
    Test.assert(tread.nav.said().find("leave:true") != null);
    // the questions are never asked twice: the run is in the outbox once
    Test.assertEqual(tread.outbox.count(), 1);
    return true;
}

(:test)
function theRequestMatchesTheContractForEveryRunType(logger as Logger) as Boolean {
    for (var c = 0; c < 2; c++) {
        var all = ViewRig.sims();
        for (var i = 0; i < all.size(); i++) {
            var rig = new EndRig(all[i], 350, 230, c == 0);
            rig.confirmAll();
            var message = PayloadCheck.problem(rig.queuedBody(), c == 0);
            Test.assertMessage(message == null, "sim " + i + " consent " + (c == 0) + ": " + message);
            Expect.field(rig.queuedBody(), "run_type", RunUpload.RUN_TYPES[RunUpload.runKind(rig.sim.session)]);
        }
    }
    return true;
}

(:test)
function theRequestCarriesTheRunTheWayItWasRun(logger as Logger) as Boolean {
    var sim = new RunSim(ViewRig.body(6, [ViewRig.seg(0, 1, 20, 0, 0, 0), ViewRig.seg(1, 1, 30, 0, 0, 0), ViewRig.seg(2, 1, 20, 0, 0, 0)] as Array, [[1, 2, 2]] as Array), 0, true);
    var rig = new EndRig(sim, 400, 160, true);
    rig.confirmAll();
    var body = rig.queuedBody();
    Expect.equal(PayloadCheck.problem(body, true), null);
    Expect.field(body, "session_uuid", sim.session.uuid);
    Expect.field(body, "request_id", "gr_" + sim.session.uuid);
    Expect.field(body, "planned_workout_id", "run-1");
    Expect.field(body, "run_type", "intervals");
    Expect.field(body, "environment", "outdoor");
    Expect.field(body, "distance_source", "gps");
    Expect.field(body, "timer_s", 160);
    Expect.field(body, "elapsed_s", 160);
    Expect.field(body, "distance_m", 640);
    Expect.field(body, "workout_date_local", Clock.localDate(sim.session.startedAt, sim.parts.clock.utcOffsetMinutes()));
    Expect.field(body, "started_at_utc", Clock.isoUtc(sim.session.startedAt));
    Expect.field(body, "ended_at_utc", Clock.isoUtc(sim.session.startedAt + 160));
    var segments = body["segments"] as Array;
    Test.assertEqual(segments.size(), 6);                 // warm-up, work, recovery, work, recovery, then the 40 s after the plan as a lap
    Expect.field(segments[5] as Dictionary, "kind", 5);
    Expect.field(segments[5] as Dictionary, "t", 40);
    Expect.field(segments[1] as Dictionary, "kind", 1);
    Expect.field(segments[1] as Dictionary, "t", 30);
    Expect.field(segments[1] as Dictionary, "dm", 120);
    Expect.field(segments[1] as Dictionary, "rep", 1);
    Expect.field(segments[3] as Dictionary, "rep", 2);
    Test.assert(Wire.missing((segments[0] as Dictionary), "rep"));   // outside a repeat: null, never 0
    Test.assert(Wire.missing((segments[1] as Dictionary), "tz"));    // no target: unknown
    Test.assertEqual(Wire.numberAt(Wire.list(segments[1] as Dictionary, "hr"), 0), 140);
    // the splits: one per 100 m, never after the end
    var splits = body["splits"] as Array;
    Test.assertEqual(splits.size(), 6);
    Test.assertEqual(Wire.numberAt(splits, 0), 25);                      // 100 m at 4 m/s
    // what the watch did not tell is not in the request: no calories, no training effect
    Test.assert(Wire.missing(body, "calories_kcal") && Wire.missing(body, "te_aerobic"));
    Expect.field(body, "cadence_spm", 170);
    Expect.field(body, "rpe", 8);
    return true;
}

(:test)
function whatTheWatchKnowsGoesInAndWhatItDoesNotStaysOut(logger as Logger) as Boolean {
    var sim = new RunSim(null, 0, false);
    var rig = new EndRig(sim, 300, 100, true);
    sim.session.calories = 612;
    sim.session.effect10 = 34;
    var body = rig.built();
    Expect.field(body, "calories_kcal", 612);
    Test.assert(((body["te_aerobic"] as Float) - 3.4).abs() < 0.001);
    Expect.equal(PayloadCheck.problem(body, true), null);
    sim.session.calories = -1;
    sim.session.effect10 = -1;
    Test.assert(Wire.missing(rig.built(), "calories_kcal") && Wire.missing(rig.built(), "te_aerobic"));
    // a free run carries no planned run, a planned one its id
    Test.assert(Wire.missing(body, "planned_workout_id"));
    // a treadmill has no climb
    var tread = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 100, true);
    Test.assert(Wire.missing(tread.built(), "ascent_m"));
    return true;
}

(:test)
function heartRateAndZoneBoundsGoOnlyWithTheConsent(logger as Logger) as Boolean {
    var plan = ViewRig.body(6, [ViewRig.seg(1, 1, 30, 0, 0, 0), ViewRig.seg(2, 1, 20, 0, 0, 0)] as Array, [[0, 1, 2]] as Array);
    var with = new EndRig(new RunSim(plan, 0, false), 300, 100, true);
    var yes = with.built();
    Expect.equal(PayloadCheck.problem(yes, true), null);
    var hr = yes["hr"] as Dictionary;
    Expect.field(hr, "avg", 140);
    Expect.field(hr, "max", 140);
    Expect.field(hr, "zones_sport", "running");
    Test.assertEqual((hr["zones"] as Array).size(), 6);
    Test.assertEqual(Wire.numberAt(Wire.list(hr, "zone_s"), 2), 100);   // 140 bpm is zone 3 here, all 100 s
    Test.assert(Wire.present(((yes["segments"] as Array)[0] as Dictionary), "hr"));
    // the same run without the consent: no value of the heart anywhere
    var without = new EndRig(new RunSim(plan, 0, false), 300, 100, false);
    var no = without.built();
    Expect.equal(PayloadCheck.problem(no, false), null);
    Test.assert(Wire.missing(no, "hr"));
    var text = RunJson.write(no);
    Test.assertMessage(text.find("\"hr\"") == null && text.find("zone") == null, "no heart rate without the consent: " + text);
    // consent on, but no heart rate measured: nothing to send, nothing made up
    var quiet = new RunSim(plan, 0, false);
    quiet.source.hr = null;
    var none = new EndRig(quiet, 300, 100, true);
    Test.assert(Wire.missing(none.built(), "hr"));
    Test.assert(Wire.missing(((none.built()["segments"] as Array)[0] as Dictionary), "hr"));
    // zone bounds of the watch that make no sense are not sent
    Test.assert(RunUpload.validBounds([100, 120, 120, 160, 180, 200] as Array<Number>) == null);
    Test.assert(RunUpload.validBounds([100, 120, 140] as Array<Number>) == null);
    Test.assert(RunUpload.validBounds(null) == null);
    Test.assert(RunUpload.validBounds([100, 120, 140, 160, 180, 200] as Array<Number>) != null);
    // the consent that counts is what the server said last; nothing known is "no"
    var store = new MemoryStore();
    Test.assert(!RunConsent.isOn(store));
    return true;
}

(:test)
function aSavedRunIsQueuedOnceAndSentAsTheSameRequest(logger as Logger) as Boolean {
    var rig = new EndRig(new RunSim(null, 0, false), 300, 100, true);
    Test.assertEqual(rig.outbox.count(), 0);              // nothing before the questions are answered
    Test.assert(rig.sim.parts.journal.activeId() != null);
    rig.confirmAll();
    Test.assertEqual(rig.outbox.count(), 1);
    Test.assertEqual(rig.transport.sentCount(), 1);
    Expect.equal(rig.transport.urls[0], "http://mock/api/watch/v1/runs");
    Test.assert(rig.transport.requests[0].method == Communications.HTTP_REQUEST_METHOD_POST);
    Expect.equal(rig.sender.phaseOf(rig.uuid()), RunSender.PHASE_SENDING);
    Expect.equal(PayloadCheck.problem(rig.sentBody(0), true), null);
    // the journal marker stays until the server has the run
    Test.assert(rig.sim.parts.journal.activeId() != null);
    var status = RunEndScreens.statusLine(rig.flow) as PairingLine;
    Test.assertMessage(status.text.equals(HomeScreen.text(Rez.Strings.RunSending)), "sending: " + status.text);
    EndRig.accepted(rig);
    Expect.equal(rig.sender.phaseOf(rig.uuid()), RunSender.PHASE_SENT);
    Test.assertEqual(rig.outbox.count(), 0);
    Test.assert(rig.sim.parts.journal.activeId() == null);    // run:active only after the success
    Test.assert(rig.sim.store.getValue(StoreKeys.runExtra(rig.uuid())) == null);
    var sent = RunEndScreens.statusLine(rig.flow) as PairingLine;
    Test.assertMessage(sent.text.equals(HomeScreen.text(Rez.Strings.RunSentOk)), "sent: " + sent.text);
    // answering the questions again changes nothing (a second tap)
    var again = RunHandover.queue(rig.sim.session, rig.sender, rig.sim.session.services(), true);
    Test.assert(again == false || rig.outbox.count() <= 1);
    return true;
}

(:test)
function twentyFailedTriesNeverMakeADuplicate(logger as Logger) as Boolean {
    var rig = new EndRig(new RunSim(null, 0, false), 300, 100, true);
    rig.confirmAll();
    var first = rig.sentBody(0);
    var id = first["request_id"] as String;
    var expected = RunJson.write(first);
    for (var i = 0; i < 20; i++) {
        rig.failOnce();
        Test.assertEqual(rig.outbox.count(), 1);
        Expect.equal(rig.sender.phaseOf(rig.uuid()), RunSender.PHASE_QUEUED);
        Test.assert(rig.sim.parts.journal.activeId() != null);    // the run is still on the watch
        rig.sender.sendAll();                                      // the next occasion: the same request again
    }
    for (var i = 0; i < rig.transport.sentCount(); i++) {
        Test.assertMessage(Wire.text(rig.sentBody(i), "request_id").equals(id) && RunJson.write(rig.sentBody(i)).equals(expected), "try " + i + " is the same request");
    }
    Test.assert(rig.transport.sentCount() >= 20);
    var tries = (rig.outbox.get(rig.uuid()) as Dictionary)["n"] as Number;
    Test.assertMessage(tries >= 20, "tries " + tries);
    // the server has it at last: one run, everything cleaned up
    EndRig.accepted(rig);
    Test.assertEqual(rig.outbox.count(), 0);
    Test.assert(rig.sim.parts.journal.activeId() == null);
    Test.assertEqual(rig.sender.pendingCount(), 0);
    return true;
}

(:test)
function aRunWithoutTheNetworkGoesOutAtTheNextContact(logger as Logger) as Boolean {
    var rig = new EndRig(new RunSim(null, 0, false), 300, 100, true);
    rig.confirmAll();
    rig.transport.respond(-104, null);                    // no Bluetooth link to the phone
    Test.assert(rig.sender.isPhoneMissing());
    var wait = RunEndScreens.statusLine(rig.flow) as PairingLine;
    Test.assertMessage(wait.text.equals(HomeScreen.text(Rez.Strings.RunSendWait)), "waiting: " + wait.text);
    // the app is closed and opened again later: a new sender over the same storage finds the run
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock/api/watch/v1", transport, new FakeScheduler());
    var later = new RunSender(client, new RunOutbox(rig.sim.store), new RunJournal(rig.sim.store), rig.sim.parts.clock, new CallCounter().method(:onCall));
    Test.assertEqual(later.pendingCount(), 1);
    later.sendAll();
    Test.assertEqual(transport.sentCount(), 1);
    Expect.field(transport.requests[0].body as Dictionary, "session_uuid", rig.uuid());
    transport.respond(201, { "api_version" => 1, "min_app_version" => "1.0.0", "workout_id" => "wo_1", "replayed" => false, "hr_discarded" => false });
    Test.assertEqual(later.pendingCount(), 0);
    Test.assert(rig.sim.parts.journal.activeId() == null);
    Expect.equal(later.phaseOf(rig.uuid()), RunSender.PHASE_SENT);
    return true;
}

(:test)
function aRunTheServerHasAlreadyCountsAsSent(logger as Logger) as Boolean {
    var codes = ["DUPLICATE_WORKOUT", "DUPLICATE_OPERATION"] as Array<String>;
    for (var i = 0; i < 2; i++) {
        var rig = new EndRig(new RunSim(null, 0, false), 300, 100, true);
        rig.confirmAll();
        rig.transport.respond(409, { "api_version" => 1, "min_app_version" => "1.0.0", "error" => { "code" => codes[i], "retryable" => false, "message" => "Schon da." } });
        Expect.equal(rig.sender.phaseOf(rig.uuid()), RunSender.PHASE_SENT);
        Test.assert(rig.sender.wasAlreadySent(rig.uuid()));
        Test.assertEqual(rig.outbox.count(), 0);
        Test.assert(rig.sim.parts.journal.activeId() == null);
        var line = RunEndScreens.statusLine(rig.flow) as PairingLine;
        Test.assertMessage(line.text.equals(HomeScreen.text(Rez.Strings.RunSentAlready)), "already: " + line.text);
    }
    // a refusal for good stays on the watch with its text and is shown
    var refused = new EndRig(new RunSim(null, 0, false), 300, 100, true);
    refused.confirmAll();
    refused.transport.respond(422, { "api_version" => 1, "min_app_version" => "1.0.0", "error" => { "code" => "VALIDATION_ERROR", "retryable" => false, "message" => "Falsch." } });
    Expect.equal(refused.sender.phaseOf(refused.uuid()), RunSender.PHASE_REJECTED);
    Test.assertEqual(refused.outbox.count(), 1);
    Test.assert(refused.sim.parts.journal.activeId() != null);
    var shown = RunEndScreens.statusLine(refused.flow) as PairingLine;
    Test.assertMessage(shown.text.equals(HomeScreen.text(Rez.Strings.RunSendRejected)), "refused: " + shown.text);
    // an expired login keeps the run and asks for the pairing again
    var login = new EndRig(new RunSim(null, 0, false), 300, 100, true);
    login.confirmAll();
    login.transport.respond(401, { "api_version" => 1, "min_app_version" => "1.0.0", "error" => { "code" => "AUTH_REQUIRED", "retryable" => false, "message" => "Anmelden." } });
    Test.assertEqual(login.rejected.count, 1);
    Test.assertEqual(login.outbox.count(), 1);
    return true;
}

(:test)
function aRunSavedBeforeACrashIsOneRunAtArnold(logger as Logger) as Boolean {
    // SAVE was pressed, the watch stopped before the result reached the outbox
    var sim = new RunSim(ViewRig.body(6, [ViewRig.seg(1, 1, 30, 0, 0, 0), ViewRig.seg(2, 1, 20, 0, 0, 0)] as Array, [[0, 1, 2]] as Array), 0, false);
    sim.source.speed = 300;
    sim.seconds(100);
    var clock = sim.parts.clock as FakeClock;
    clock.now += 100;
    Test.assert(sim.session.save());
    var expected = RunUpload.build(sim.session, true, sim.parts.zones, sim.parts.clock.utcOffsetMinutes());
    // the app opens again: new objects over the same storage
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock/api/watch/v1", transport, new FakeScheduler());
    var outbox = new RunOutbox(sim.store);
    var journal = new RunJournal(sim.store);
    var sender = new RunSender(client, outbox, journal, sim.parts.clock, new CallCounter().method(:onCall));
    var parts = new RunParts(journal, sim.parts.clock, new Settings(sim.store), sim.source, sim.backend, null, sim.parts.zones);
    Test.assertEqual(outbox.count(), 0);
    Test.assert(RunHandover.recover(sender, parts, true));
    Test.assertEqual(outbox.count(), 1);
    Test.assertEqual(transport.sentCount(), 1);
    // the same request as before the crash: same ids, same numbers
    var body = transport.requests[0].body as Dictionary;
    Expect.field(body, "request_id", expected["request_id"] as String);
    Expect.field(body, "session_uuid", sim.session.uuid);
    Expect.field(body, "distance_m", expected["distance_m"] as Number);
    Test.assertEqual((body["segments"] as Array).size(), (expected["segments"] as Array).size());
    Expect.equal(PayloadCheck.problem(body, true), null);
    // the app opens a second time before the answer: still one entry, one request
    Test.assert(!RunHandover.recover(sender, parts, true));
    Test.assertEqual(outbox.count(), 1);
    Test.assertEqual(transport.sentCount(), 1);
    // the answer: gone for good; opening again finds nothing to send
    transport.respond(201, { "api_version" => 1, "min_app_version" => "1.0.0", "workout_id" => "wo_1", "replayed" => false, "hr_discarded" => false });
    Test.assertEqual(outbox.count(), 0);
    Test.assert(journal.activeId() == null);
    Test.assert(!RunHandover.recover(sender, parts, true));
    Test.assertEqual(outbox.count(), 0);
    Test.assertEqual(transport.sentCount(), 1);
    return true;
}

(:test)
function aRunStillRunningIsNotQueuedByTheRecovery(logger as Logger) as Boolean {
    var sim = new RunSim(null, 0, false);
    sim.seconds(40);
    sim.session.pause();
    var transport = new FakeTransport();
    var client = new ApiClient("http://mock/api/watch/v1", transport, new FakeScheduler());
    var outbox = new RunOutbox(sim.store);
    var sender = new RunSender(client, outbox, new RunJournal(sim.store), sim.parts.clock, new CallCounter().method(:onCall));
    var parts = new RunParts(new RunJournal(sim.store), sim.parts.clock, new Settings(sim.store), sim.source, sim.backend, null, sim.parts.zones);
    Test.assert(!RunHandover.recover(sender, parts, true));
    Test.assertEqual(outbox.count(), 0);
    Test.assertEqual(transport.sentCount(), 0);
    Test.assert(new RunJournal(sim.store).hasInterrupted());   // it can still be continued
    // nothing at all: nothing happens
    var empty = new MemoryStore();
    var other = new RunSender(client, new RunOutbox(empty), new RunJournal(empty), sim.parts.clock, new CallCounter().method(:onCall));
    Test.assert(!RunHandover.recover(other, new RunParts(new RunJournal(empty), sim.parts.clock, new Settings(empty), sim.source, sim.backend, null, null), false));
    return true;
}

(:test)
function theHintLineOfTheAlarmsFitsEveryDisplayOnEveryRunType(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var all = ViewRig.sims();
    var shownAnywhere = 0;
    for (var i = 0; i < all.size(); i++) {
        var sim = all[i];
        sim.source.speed = 1000;
        var seen = 0;
        for (var s = 0; s < 110; s++) {
            sim.seconds(1);
            var hint = sim.session.alerts.currentHint();
            if (hint == null) {
                continue;
            }
            seen++;
            var text = (hint as RunAlertHint).text;
            var page = RunPages.build(dc, sim.session, 0);
            var message = "sim " + i + " second " + s + " hint '" + text + "'";
            Test.assertMessage(LayoutRig.fits(dc, page.lines), message + " fits: " + ViewRig.heights(dc, page.lines));
            var drawn = PairingLayout.arrange(dc, page.lines);
            var found = false;
            for (var l = 0; l < drawn.size(); l++) {
                found = found || drawn[l].text.equals(text);
                Test.assertMessage(dc.getTextWidthInPixels(drawn[l].text, drawn[l].font) <= dc.getWidth(), message + " width of '" + drawn[l].text + "'");
            }
            Test.assertMessage(found, message + " is on the screen: " + ViewRig.heights(dc, page.lines));
            RunLayout.draw(dc, page.lines, page.zone, 0, 0);
        }
        Test.assertMessage(seen > 0, "sim " + i + " showed no hint at all");
        shownAnywhere += seen;
    }
    Test.assert(shownAnywhere > 9);
    return true;
}

// The three runs of the end-to-end check: the simulator prints each request as one line, `apps/garmin/scripts/run-e2e.sh`
// posts them to the mock server, which checks them against the contract (src/shared/run-contract.ts).
(:test)
function printTheRequestsForTheEndToEndCheck(logger as Logger) as Boolean {
    var base = new EndRig(new RunSim(ViewRig.body(1, [ViewRig.seg(1, 0, 0, 1, 2, 2)] as Array, null), 0, false), 280, 1500, true);
    base.confirmAll();
    logger.debug("RUNPAYLOAD grundlage-mit-hr " + RunJson.write(base.queuedBody()));
    var intervals = new EndRig(new RunSim(ViewRig.body(6, [ViewRig.seg(0, 1, 120, 0, 0, 0), ViewRig.seg(1, 1, 180, 2, 270, 285), ViewRig.seg(2, 1, 120, 0, 0, 0), ViewRig.seg(3, 1, 120, 0, 0, 0)] as Array, [[1, 2, 4]] as Array), 0, false), 360, 1500, true);
    intervals.confirmAll();
    logger.debug("RUNPAYLOAD intervalle-mit-hr " + RunJson.write(intervals.queuedBody()));
    var tread = new EndRig(new RunSim(null, PreStartModel.ENV_TREADMILL, false), 300, 1800, false);
    tread.flow.move(-1);
    tread.flow.move(-1);
    tread.flow.confirm(tread.nav);
    tread.flow.confirm(tread.nav);
    logger.debug("RUNPAYLOAD laufband-ohne-hr " + RunJson.write(tread.queuedBody()));
    Expect.equal(PayloadCheck.problem(base.queuedBody(), true), null);
    Expect.equal(PayloadCheck.problem(intervals.queuedBody(), true), null);
    Expect.equal(PayloadCheck.problem(tread.queuedBody(), false), null);
    return true;
}
