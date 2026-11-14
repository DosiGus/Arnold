import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Test;

// Pre-start screen (RUN-025): satellite mode, environments, battery, the question before a start
// without GPS, and the way from opening the app to the start.

// A device that supports exactly the listed satellite modes.
(:test)
class FakeCapability extends GpsCapability {
    var modes as Array<Position.Configuration>;

    function initialize(supported as Array<Position.Configuration>) {
        GpsCapability.initialize();
        modes = supported;
    }

    function supports(configuration as Position.Configuration) as Boolean {
        return modes.indexOf(configuration) >= 0;
    }
}

// Sensors with readings the test sets.
(:test)
class FakeSensors extends RunSensors {
    var hr as Number or Null;
    var battery as Number;
    var gpsStarts as Number;
    var lastUseGps as Boolean;
    var stops as Number;

    function initialize() {
        RunSensors.initialize(new GpsCapability());
        hr = null;
        battery = 100;
        gpsStarts = 0;
        lastUseGps = true;
        stops = 0;
    }

    function start(useGps as Boolean) as Void {
        lastUseGps = useGps;
        gpsStarts++;
    }

    function stop() as Void {
        stops++;
    }

    function heartRate() as Number or Null {
        return hr;
    }

    function batteryPercent() as Number {
        return battery;
    }
}

(:test)
class RecordingStarter extends RunStarter {
    var started as Array<PreStartModel>;

    function initialize() {
        RunStarter.initialize(null);
        started = [] as Array<PreStartModel>;
    }

    function start(model as PreStartModel) as Void {
        started.add(model);
    }
}

// The delegate without the question dialog: it only counts the questions.
(:test)
class ProbeDelegate extends PreStartDelegate {
    var questions as Number;

    function initialize(model as PreStartModel, sensors as RunSensors, starter as RunStarter) {
        PreStartDelegate.initialize(model, sensors, starter);
        questions = 0;
    }

    function askToStart() as Void {
        questions++;
    }
}

(:test)
class PreStartRig {
    var model as PreStartModel;
    var sensors as FakeSensors;
    var starter as RecordingStarter;
    var delegate as ProbeDelegate;

    function initialize(request as PreStartRequest) {
        model = new PreStartModel(request);
        sensors = new FakeSensors();
        starter = new RecordingStarter();
        delegate = new ProbeDelegate(model, sensors, starter);
    }

    // A planned run with the given environment code, name, minutes and segments.
    static function planned(environment as Number, name as String, minutes as Number or Null, segments as Array) as PreStartRequest {
        var body = { "k" => 1, "n" => name, "e" => environment, "s" => segments };
        return new PreStartRequest(PreStartRequest.MODE_PLANNED, "r1", body).with(minutes, true);
    }

    static function free() as PreStartRequest {
        return new PreStartRequest(PreStartRequest.MODE_FREE, "", null).with(null, true);
    }

    static function zone2() as PreStartRequest {
        return new PreStartRequest(PreStartRequest.MODE_ZONE2, "", null).with(null, true);
    }

    static function threeSegments() as Array {
        return [[0, 1, 300, 0, 0, 0], [1, 1, 1200, 1, 2, 2], [3, 1, 300, 0, 0, 0]] as Array;
    }
}

(:test)
function gpsModeIsTheMostAccurateTheDeviceCan(logger as Logger) as Boolean {
    var all = [
        Position.CONFIGURATION_GPS, Position.CONFIGURATION_GPS_GALILEO,
        Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1, Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1_L5,
        Position.CONFIGURATION_SAT_IQ
    ] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(all)), Position.CONFIGURATION_SAT_IQ);
    // without SatIQ: multi-band with all systems
    var noSatIq = [all[0], all[1], all[2], all[3]] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(noSatIq)), Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1_L5);
    // without multi-band: all systems on L1
    var noBand = [all[0], all[1], all[2]] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(noBand)), Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1);
    // GPS + Galileo, then GPS only
    var galileo = [all[0], all[1]] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(galileo)), Position.CONFIGURATION_GPS_GALILEO);
    var gpsOnly = [all[0]] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(gpsOnly)), Position.CONFIGURATION_GPS);
    // the order does not depend on the order of the device's own list
    var shuffled = [all[4], all[0], all[3]] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(shuffled)), Position.CONFIGURATION_SAT_IQ);
    var shuffledNoSat = [all[0], all[3], all[1]] as Array<Position.Configuration>;
    Expect.equal(GpsMode.choose(new FakeCapability(shuffledNoSat)), Position.CONFIGURATION_GPS_GLONASS_GALILEO_BEIDOU_L1_L5);
    return true;
}

(:test)
function aDeviceWithoutAnyModeGetsTheSystemDefault(logger as Logger) as Boolean {
    var none = [] as Array<Position.Configuration>;
    Test.assert(GpsMode.choose(new FakeCapability(none)) == null);
    var plain = GpsMode.options(null);
    Expect.equal(plain[:acquisitionType], Position.LOCATION_CONTINUOUS);
    Test.assert(!plain.hasKey(:configuration));
    var chosen = GpsMode.options(Position.CONFIGURATION_GPS_GALILEO);
    Expect.equal(chosen[:configuration], Position.CONFIGURATION_GPS_GALILEO);
    Expect.equal(chosen[:acquisitionType], Position.LOCATION_CONTINUOUS);
    // the order is the documented one and has no duplicates
    var order = GpsMode.order();
    Expect.equal(order.size(), 5);
    Expect.equal(order[0], Position.CONFIGURATION_SAT_IQ);
    Expect.equal(order[4], Position.CONFIGURATION_GPS);
    for (var i = 0; i < order.size(); i++) {
        Expect.equal(order.indexOf(order[i]), i);
    }
    return true;
}

(:test)
function theRealDeviceAnswersTheCapabilityCheck(logger as Logger) as Boolean {
    // On the simulator device: no crash; every mode is a Boolean, the choice is one of the list or null.
    var cap = new GpsCapability();
    var order = GpsMode.order();
    for (var i = 0; i < order.size(); i++) {
        var answer = cap.supports(order[i]);
        Test.assert(answer == true || answer == false);
    }
    var chosen = GpsMode.choose(cap);
    Test.assert(chosen == null || order.indexOf(chosen) >= 0);
    return true;
}

(:test)
function theEnvironmentStartsFromThePrescriptionAndFreeRunsStartOutdoors(logger as Logger) as Boolean {
    Expect.equal(new PreStartModel(PreStartRig.planned(0, "Zone 2", 45, PreStartRig.threeSegments())).environment, PreStartModel.ENV_OUTDOOR);
    Expect.equal(new PreStartModel(PreStartRig.planned(1, "Zone 2", 45, PreStartRig.threeSegments())).environment, PreStartModel.ENV_TREADMILL);
    Expect.equal(new PreStartModel(PreStartRig.planned(2, "Intervalle", 45, PreStartRig.threeSegments())).environment, PreStartModel.ENV_TRACK);
    Expect.equal(new PreStartModel(PreStartRig.planned(7, "?", 45, PreStartRig.threeSegments())).environment, PreStartModel.ENV_OUTDOOR);   // unknown code
    Expect.equal(new PreStartModel(PreStartRig.free()).environment, PreStartModel.ENV_OUTDOOR);
    Expect.equal(new PreStartModel(PreStartRig.zone2()).environment, PreStartModel.ENV_OUTDOOR);
    return true;
}

(:test)
function upAndDownChangeTheEnvironmentAndSwitchTheGps(logger as Logger) as Boolean {
    var rig = new PreStartRig(PreStartRig.free());
    Test.assert(rig.model.usesGps());
    Test.assert(rig.delegate.onNextPage());                       // outdoor -> treadmill
    Expect.equal(rig.model.environment, PreStartModel.ENV_TREADMILL);
    Test.assert(!rig.model.usesGps());
    Test.assert(!rig.sensors.lastUseGps);                         // the position is switched off
    Test.assert(rig.delegate.onNextPage());                       // -> track
    Expect.equal(rig.model.environment, PreStartModel.ENV_TRACK);
    Test.assert(rig.sensors.lastUseGps);
    Test.assert(rig.delegate.onNextPage());                       // wraps to outdoor
    Expect.equal(rig.model.environment, PreStartModel.ENV_OUTDOOR);
    Test.assert(rig.delegate.onPreviousPage());                   // wraps back to track
    Expect.equal(rig.model.environment, PreStartModel.ENV_TRACK);
    return true;
}

(:test)
function theTreadmillStartsWithoutGpsAndWithoutAQuestion(logger as Logger) as Boolean {
    var rig = new PreStartRig(PreStartRig.planned(1, "Zone 2", 45, PreStartRig.threeSegments()));
    rig.sensors.quality = Position.QUALITY_NOT_AVAILABLE;
    Test.assert(!rig.model.usesGps());
    Test.assert(!rig.model.needsGpsQuestion(Position.QUALITY_NOT_AVAILABLE));
    Test.assert(rig.delegate.onSelect());
    Expect.equal(rig.delegate.questions, 0);
    Expect.equal(rig.starter.started.size(), 1);
    Expect.equal(rig.starter.started[0].environment, PreStartModel.ENV_TREADMILL);
    Test.assert(rig.sensors.keep);                                // the sensors stay on behind the recording
    return true;
}

(:test)
function startBeforeGpsAsksFirstAndOnlyYesStarts(logger as Logger) as Boolean {
    var rig = new PreStartRig(PreStartRig.planned(0, "Zone 2", 45, PreStartRig.threeSegments()));
    var weak = [Position.QUALITY_NOT_AVAILABLE, Position.QUALITY_LAST_KNOWN, Position.QUALITY_POOR] as Array<Number>;
    for (var i = 0; i < weak.size(); i++) {
        rig.sensors.quality = weak[i];
        Test.assert(rig.delegate.onSelect());
        Expect.equal(rig.delegate.questions, i + 1);
        Expect.equal(rig.starter.started.size(), 0);          // nothing started without the answer
    }
    rig.delegate.confirmed();                                     // YES
    Expect.equal(rig.starter.started.size(), 1);
    // a usable or good position starts at once; the track needs GPS like outdoors
    var good = new PreStartRig(PreStartRig.planned(2, "Intervalle", 40, PreStartRig.threeSegments()));
    good.sensors.quality = Position.QUALITY_USABLE;
    Test.assert(good.delegate.onSelect());
    Expect.equal(good.delegate.questions, 0);
    Expect.equal(good.starter.started.size(), 1);
    var track = new PreStartRig(PreStartRig.planned(2, "Intervalle", 40, PreStartRig.threeSegments()));
    Test.assert(track.model.needsGpsQuestion(Position.QUALITY_POOR));
    Test.assert(!track.model.needsGpsQuestion(Position.QUALITY_GOOD));
    return true;
}

(:test)
function theMinutesComeFromTheListOrTheSegments(logger as Logger) as Boolean {
    // the list's figure wins
    Expect.equal(new PreStartModel(PreStartRig.planned(0, "A", 45, PreStartRig.threeSegments())).minutes(), 45);
    // else the timed segments: 5 + 20 + 5 min
    Expect.equal(new PreStartModel(PreStartRig.planned(0, "A", null, PreStartRig.threeSegments())).minutes(), 30);
    // repeats: warm-up 10 min, 4 x (3 min work + 2 min recovery), cool-down 5 min = 35 min
    var intervals = { "k" => 6, "n" => "A", "e" => 0, "rp" => [[1, 2, 4]], "s" => [[0, 1, 600, 0, 0, 0], [1, 1, 180, 0, 0, 0], [2, 1, 120, 0, 0, 0], [3, 1, 300, 0, 0, 0]] };
    Expect.equal(PreStartModel.minutesOf(intervals), 35);
    // rounded up; open and distance segments have no known time
    var mixed = { "k" => 1, "n" => "A", "e" => 0, "s" => [[1, 1, 90, 0, 0, 0], [1, 2, 5000, 0, 0, 0], [1, 0, 0, 0, 0, 0]] };
    Expect.equal(PreStartModel.minutesOf(mixed), 2);
    var open = { "k" => 1, "n" => "A", "e" => 0, "s" => [[1, 0, 0, 0, 0, 0]] };
    Test.assert(PreStartModel.minutesOf(open) == null);
    Test.assert(new PreStartModel(PreStartRig.free()).minutes() == null);
    return true;
}

(:test)
function theBatteryWarnsWhenThePlannedRunIsLongerThanTheCharge(logger as Logger) as Boolean {
    // outdoors 8 % per hour: 50 % last 375 min, 10 % last 75 min
    Expect.equal(RunBattery.minutesLeft(50, true), 375);
    Expect.equal(RunBattery.minutesLeft(10, true), 75);
    Expect.equal(RunBattery.minutesLeft(50, false), 750);     // the treadmill needs less
    Test.assert(!RunBattery.isShort(60, 50, true));
    Test.assert(!RunBattery.isShort(75, 10, true));               // exactly enough: no warning
    Test.assert(RunBattery.isShort(76, 10, true));
    Test.assert(RunBattery.isShort(100, 10, true));
    Test.assert(!RunBattery.isShort(100, 10, false));             // the same run on the treadmill still fits
    Test.assert(!RunBattery.isShort(null, 1, true));              // a free run never warns
    // the screen shows the line only when it is needed
    var dc = LayoutRig.dc();
    var long = new PreStartModel(PreStartRig.planned(0, "Langer Lauf", 120, PreStartRig.threeSegments()));
    var low = PlanScreens.joined(PreStartScreen.lines(dc, long, Position.QUALITY_GOOD, 60, 10));
    var full = PlanScreens.joined(PreStartScreen.lines(dc, long, Position.QUALITY_GOOD, 60, 100));
    var warning = HomeScreen.text(Rez.Strings.PreBattery);
    var prefix = warning.substring(0, 4) as String;
    Test.assertMessage(low.find(prefix) != null, "warning with 10 %: " + low);
    Test.assertMessage(full.find(prefix) == null, "no warning with 100 %: " + full);
    return true;
}

(:test)
function theScreenShowsRunKindContentEnvironmentGpsAndHeartRate(logger as Logger) as Boolean {
    var dc = LayoutRig.dc();
    var model = new PreStartModel(PreStartRig.planned(2, "Intervalle", 40, PreStartRig.threeSegments()));
    var text = PlanScreens.joined(PreStartScreen.lines(dc, model, Position.QUALITY_GOOD, 64, 80));
    Test.assertMessage(text.find("Intervalle") != null, text);
    Test.assertMessage(text.find("40 min") != null, text);
    Test.assertMessage(text.find(PreStartScreen.environmentText(PreStartModel.ENV_TRACK)) != null, text);
    Test.assertMessage(text.find(PreStartScreen.gpsText(model, Position.QUALITY_GOOD)) != null, text);
    Test.assertMessage(text.find("64") != null, text);
    // each environment has its own text; the treadmill says there is no GPS
    var seen = [] as Array<String>;
    for (var e = 0; e < 3; e++) {
        var name = PreStartScreen.environmentText(e);
        Test.assert(name.length() > 0 && seen.indexOf(name) < 0);
        seen.add(name);
    }
    var treadmill = new PreStartModel(PreStartRig.planned(1, "Zone 2", 45, PreStartRig.threeSegments()));
    Expect.equal(PreStartScreen.gpsText(treadmill, Position.QUALITY_GOOD), HomeScreen.text(Rez.Strings.PreGpsOff));
    // a free run: type "free run", name open / zone 2, no content line
    var free = new PreStartModel(PreStartRig.free());
    Expect.equal(PreStartScreen.nameText(free.request), HomeScreen.text(Rez.Strings.HomeFreeOpen));
    Expect.equal(PreStartScreen.kindText(free.request), HomeScreen.text(Rez.Strings.RunType13));
    Expect.equal(PreStartScreen.summaryText(free), "");
    Expect.equal(PreStartScreen.nameText(new PreStartModel(PreStartRig.zone2()).request), HomeScreen.text(Rez.Strings.HomeFreeZone2));
    // GPS wording by quality, and the ring fills in steps
    var gps = [] as Array<String>;
    var qualities = [Position.QUALITY_NOT_AVAILABLE, Position.QUALITY_POOR, Position.QUALITY_USABLE, Position.QUALITY_GOOD] as Array<Number>;
    for (var i = 0; i < qualities.size(); i++) {
        var line = PreStartScreen.gpsText(free, qualities[i]);
        Test.assert(gps.indexOf(line) < 0);
        gps.add(line);
    }
    Expect.equal(PreStartScreen.ringPercent(Position.QUALITY_NOT_AVAILABLE), 0);
    Expect.equal(PreStartScreen.ringPercent(Position.QUALITY_LAST_KNOWN), 25);
    Expect.equal(PreStartScreen.ringPercent(Position.QUALITY_POOR), 50);
    Expect.equal(PreStartScreen.ringPercent(Position.QUALITY_USABLE), 75);
    Expect.equal(PreStartScreen.ringPercent(Position.QUALITY_GOOD), 100);
    return true;
}

(:test)
function theHeartRateLineShowsSearchingValueAndNoConsent(logger as Logger) as Boolean {
    var request = PreStartRig.free();
    Expect.equal(PreStartScreen.heartText(request, null), HomeScreen.text(Rez.Strings.PreHrSearching));
    Expect.equal(PreStartScreen.heartText(request, 58), Lang.format(HomeScreen.text(Rez.Strings.PreHrValue), [58]));
    var denied = new PreStartRequest(PreStartRequest.MODE_FREE, "", null).with(null, false);
    Expect.equal(PreStartScreen.heartText(denied, 58), HomeScreen.text(Rez.Strings.PreHrOff));
    var unknown = new PreStartRequest(PreStartRequest.MODE_FREE, "", null);                // no list yet: show the sensor
    Expect.equal(PreStartScreen.heartText(unknown, 58), Lang.format(HomeScreen.text(Rez.Strings.PreHrValue), [58]));
    return true;
}

// From opening the app to START in the pre-start screen: at most three keys, planned run and free run.
(:test)
function fromOpeningTheAppToTheStartAreAtMostThreeKeys(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.loadAll();
    rig.sync.start();
    rig.plan.pairing.transport.respond(200, rig.upcoming(rig.threeRuns(1), true));
    rig.answerAll(1);
    // planned run of today: START on the start screen, START in the pre-start screen
    var planned = new RunKeys(rig);
    planned.start();
    var run = new PreStartRig(planned.last());
    run.sensors.quality = Position.QUALITY_GOOD;
    Expect.equal(run.model.minutes(), 45);                       // the figure of the list
    Expect.equal(run.model.environment, PreStartModel.ENV_OUTDOOR);
    run.delegate.onSelect();
    Expect.equal(run.starter.started.size(), 1);
    Test.assertMessage(planned.presses + 1 <= 3, "planned: " + (planned.presses + 1));
    // free run (open): DOWN, START, START
    var free = new RunKeys(rig);
    free.down();
    free.start();
    var open = new PreStartRig(free.last());
    open.sensors.quality = Position.QUALITY_GOOD;
    open.delegate.onSelect();
    Expect.equal(open.starter.started.size(), 1);
    Expect.equal(open.starter.started[0].request.mode, PreStartRequest.MODE_FREE);
    Test.assertMessage(free.presses + 1 <= 3, "free: " + (free.presses + 1));
    return true;
}

// Without a run planned today, the free zone 2 run is UP, START, START as well.
(:test)
function withoutARunTodayEveryFreeRunNeedsAtMostThreeKeysToStart(logger as Logger) as Boolean {
    var rig = new RunRig();
    rig.plan.loadAll();
    var open = new RunKeys(rig);
    open.down();
    open.start();
    var openRig = new PreStartRig(open.last());
    openRig.sensors.quality = Position.QUALITY_GOOD;
    openRig.delegate.onSelect();
    Expect.equal(openRig.starter.started.size(), 1);
    Test.assertMessage(open.presses + 1 <= 3, "open: " + (open.presses + 1));
    var zone = new RunKeys(rig);
    zone.up();
    zone.start();
    var zoneRig = new PreStartRig(zone.last());
    zoneRig.sensors.quality = Position.QUALITY_GOOD;
    zoneRig.delegate.onSelect();
    Expect.equal(zoneRig.starter.started[0].request.mode, PreStartRequest.MODE_ZONE2);
    Test.assertMessage(zone.presses + 1 <= 3, "zone 2: " + (zone.presses + 1));
    return true;
}
