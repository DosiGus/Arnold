import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Timer;
import Toybox.WatchUi;

// The pre-start screen (RUN-025): the run, where it happens, the quality of the GPS as a ring
// around the display, the heart rate sensor, a warning when the battery will not last. UP and
// DOWN change the environment, START starts (before a GPS signal only after a question), BACK leaves.
class PreStartView extends WatchUi.View {
    private var _model as PreStartModel;
    private var _sensors as RunSensors;
    private var _timer as Timer.Timer or Null;

    function initialize(model as PreStartModel, sensors as RunSensors) {
        View.initialize();
        _model = model;
        _sensors = sensors;
        _timer = null;
    }

    // The sensors run while the screen is there; they stay on while a question or the recording covers it.
    function onShow() as Void {
        _sensors.keep = false;
        _sensors.start(_model.usesGps());
        if (_timer == null) {
            _timer = new Timer.Timer();
            (_timer as Timer.Timer).start(method(:onTick), 1000, true);   // the heart rate has no callback
        }
    }

    function onHide() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
        if (!_sensors.keep) {
            _sensors.stop();
        }
    }

    function onTick() as Void {
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        var quality = _sensors.quality;
        PairingLayout.draw(dc, PreStartScreen.lines(dc, _model, quality, _sensors.heartRate(), _sensors.batteryPercent()));
        if (_model.usesGps()) {
            PreStartScreen.drawRing(dc, quality);
        }
    }
}

class PreStartDelegate extends WatchUi.BehaviorDelegate {
    private var _model as PreStartModel;
    private var _sensors as RunSensors;
    private var _starter as RunStarter;

    function initialize(model as PreStartModel, sensors as RunSensors, starter as RunStarter) {
        BehaviorDelegate.initialize();
        _model = model;
        _sensors = sensors;
        _starter = starter;
    }

    function onNextPage() as Boolean {
        return change(1);
    }

    function onPreviousPage() as Boolean {
        return change(-1);
    }

    hidden function change(delta as Number) as Boolean {
        _model.cycle(delta);
        _sensors.start(_model.usesGps());   // the treadmill switches the position off, the others on
        WatchUi.requestUpdate();
        return true;
    }

    function onSelect() as Boolean {
        if (_model.needsGpsQuestion(_sensors.quality)) {
            _sensors.keep = true;
            askToStart();
        } else {
            begin();
        }
        return true;
    }

    // Asks whether to start without a GPS signal. YES calls `confirmed`.
    function askToStart() as Void {
        WatchUi.pushView(new WatchUi.Confirmation(HomeScreen.text(Rez.Strings.PreNoGpsAsk)), new PreStartQuestion(self), WatchUi.SLIDE_UP);
    }

    function confirmed() as Void {
        begin();
    }

    hidden function begin() as Void {
        _sensors.keep = true;
        _starter.start(_model);
    }
}

// The answer to "Start anyway?": YES starts, NO (or BACK) leaves the screen as it was.
class PreStartQuestion extends WatchUi.ConfirmationDelegate {
    private var _delegate as PreStartDelegate;

    function initialize(delegate as PreStartDelegate) {
        ConfirmationDelegate.initialize();
        _delegate = delegate;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _delegate.confirmed();
        }
        return true;
    }
}

// Where START leads. Until the recording exists (RUN-015) it is a placeholder screen.
class RunStarter {
    function initialize() {
    }

    function start(model as PreStartModel) as Void {
        WatchUi.pushView(new RecordingPlaceholderView(), new WatchUi.BehaviorDelegate(), WatchUi.SLIDE_LEFT);
    }
}

// "Recording follows": the stand-in for the recording (RUN-015 replaces it). BACK returns to the pre-start screen.
class RecordingPlaceholderView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, [new PairingLine(HomeScreen.text(Rez.Strings.RecPlaceholder), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE)] as Array<PairingLine>);
    }
}

// Texts, colours and the ring of the pre-start screen. No state: everything comes in as parameters.
module PreStartScreen {
    const RING_GRAY as Number = Graphics.COLOR_DK_GRAY;

    function lines(dc as Dc, model as PreStartModel, quality as Number, heartRate as Number or Null, battery as Number) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var request = model.request;
        out.add(new PairingLine(kindText(request), Graphics.FONT_TINY, Graphics.COLOR_LT_GRAY).skippable());
        out.add(new PairingLine(nameText(request), Graphics.FONT_SMALL, Graphics.COLOR_WHITE));
        var summary = summaryText(model);
        if (summary.length() > 0) {
            out.add(new PairingLine(summary, Graphics.FONT_TINY, Graphics.COLOR_LT_GRAY).skippable());
        }
        out.add(new PairingLine(environmentText(model.environment), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        out.add(new PairingLine(gpsText(model, quality), Graphics.FONT_TINY, gpsColor(model, quality)));
        out.add(new PairingLine(heartText(request, heartRate), Graphics.FONT_TINY, Graphics.COLOR_LT_GRAY));
        var minutes = model.minutes();
        if (RunBattery.isShort(minutes, battery, model.usesGps())) {
            out.add(new PairingLine(Lang.format(HomeScreen.text(Rez.Strings.PreBattery), [minutes as Number]), Graphics.FONT_TINY, Graphics.COLOR_ORANGE));
        }
        out.add(new PairingLine(HomeScreen.text(Rez.Strings.PreStartHint), Graphics.FONT_TINY, Graphics.COLOR_DK_GRAY).skippable());
        return out;
    }

    // The type of run: "Grundlage", "Intervalle", ...; a free run is "Freier Lauf".
    function kindText(request as PreStartRequest) as String {
        var kind = 13;
        if (request.mode == PreStartRequest.MODE_PLANNED && request.prescription != null) {
            var code = (request.prescription as Dictionary)["k"] as Object or Null;
            if (code instanceof Number && (code as Number) >= 0 && (code as Number) < 14) {
                kind = code as Number;
            }
        }
        var ids = [
            Rez.Strings.RunType0, Rez.Strings.RunType1, Rez.Strings.RunType2, Rez.Strings.RunType3,
            Rez.Strings.RunType4, Rez.Strings.RunType5, Rez.Strings.RunType6, Rez.Strings.RunType7,
            Rez.Strings.RunType8, Rez.Strings.RunType9, Rez.Strings.RunType10, Rez.Strings.RunType11,
            Rez.Strings.RunType12, Rez.Strings.RunType13
        ] as Array<ResourceId>;
        return HomeScreen.text(ids[kind]);
    }

    // The name of the prescription, or "Open" / "Zone 2" for a free run.
    function nameText(request as PreStartRequest) as String {
        if (request.mode == PreStartRequest.MODE_PLANNED) {
            var body = request.prescription;
            return body == null ? "" : (body as Dictionary)["n"] as String;
        }
        return HomeScreen.text(request.mode == PreStartRequest.MODE_ZONE2 ? Rez.Strings.HomeFreeZone2 : Rez.Strings.HomeFreeOpen);
    }

    // "45 min · 3 Abschnitte"; unknown parts are left out, nothing for a free run.
    function summaryText(model as PreStartModel) as String {
        var text = "";
        var minutes = model.minutes();
        if (minutes != null) {
            text = Lang.format(HomeScreen.text(Rez.Strings.HomeMinutes), [minutes as Number]);
        }
        var count = model.segmentCount();
        if (count > 0) {
            var parts = count == 1 ? HomeScreen.text(Rez.Strings.PreSegmentOne) : Lang.format(HomeScreen.text(Rez.Strings.PreSegments), [count]);
            text = text.length() > 0 ? text + " · " + parts : parts;
        }
        return text;
    }

    function environmentText(environment as Number) as String {
        if (environment == PreStartModel.ENV_TREADMILL) {
            return HomeScreen.text(Rez.Strings.PreEnvTreadmill);
        }
        return HomeScreen.text(environment == PreStartModel.ENV_TRACK ? Rez.Strings.PreEnvTrack : Rez.Strings.PreEnvOutdoor);
    }

    function gpsText(model as PreStartModel, quality as Number) as String {
        if (!model.usesGps()) {
            return HomeScreen.text(Rez.Strings.PreGpsOff);
        }
        if (quality >= Position.QUALITY_GOOD) {
            return HomeScreen.text(Rez.Strings.PreGpsGood);
        }
        if (quality >= Position.QUALITY_USABLE) {
            return HomeScreen.text(Rez.Strings.PreGpsUsable);
        }
        if (quality >= Position.QUALITY_LAST_KNOWN) {
            return HomeScreen.text(Rez.Strings.PreGpsPoor);
        }
        return HomeScreen.text(Rez.Strings.PreGpsSearching);
    }

    function gpsColor(model as PreStartModel, quality as Number) as Number {
        return model.usesGps() ? ringColor(quality) : Graphics.COLOR_LT_GRAY;
    }

    // Heart rate line: off without the consent, the value, or "searching" until the sensor has one.
    function heartText(request as PreStartRequest, heartRate as Number or Null) as String {
        if (request.consent != null && !(request.consent as Boolean)) {
            return HomeScreen.text(Rez.Strings.PreHrOff);
        }
        if (heartRate == null) {
            return HomeScreen.text(Rez.Strings.PreHrSearching);
        }
        return Lang.format(HomeScreen.text(Rez.Strings.PreHrValue), [heartRate as Number]);
    }

    // How much of the ring is filled, in percent: none without a position, then a quarter per step
    // (last known, weak, usable, good), like the GPS ring of Garmin's own activities.
    function ringPercent(quality as Number) as Number {
        if (quality >= Position.QUALITY_GOOD) {
            return 100;
        }
        if (quality >= Position.QUALITY_USABLE) {
            return 75;
        }
        if (quality >= Position.QUALITY_POOR) {
            return 50;
        }
        if (quality >= Position.QUALITY_LAST_KNOWN) {
            return 25;
        }
        return 0;
    }

    function ringColor(quality as Number) as Number {
        if (quality >= Position.QUALITY_GOOD) {
            return Graphics.COLOR_GREEN;
        }
        if (quality >= Position.QUALITY_USABLE) {
            return Graphics.COLOR_YELLOW;
        }
        if (quality >= Position.QUALITY_LAST_KNOWN) {
            return Graphics.COLOR_ORANGE;
        }
        return Graphics.COLOR_LT_GRAY;
    }

    // The ring along the edge: grey track, the coloured part clockwise from the top.
    function drawRing(dc as Dc, quality as Number) as Void {
        var w = dc.getWidth();
        var pen = w / 40 < 4 ? 4 : w / 40;
        var radius = w / 2 - pen / 2;
        var x = w / 2;
        var y = dc.getHeight() / 2;
        dc.setPenWidth(pen);
        dc.setColor(RING_GRAY, Graphics.COLOR_BLACK);
        dc.drawCircle(x, y, radius);
        var percent = ringPercent(quality);
        if (percent >= 100) {
            dc.setColor(ringColor(quality), Graphics.COLOR_BLACK);
            dc.drawCircle(x, y, radius);
        } else if (percent > 0) {
            dc.setColor(ringColor(quality), Graphics.COLOR_BLACK);
            var end = ((90 - 360 * percent / 100) % 360 + 360) % 360;
            dc.drawArc(x, y, radius, Graphics.ARC_CLOCKWISE, 90, end);
        }
        dc.setPenWidth(1);
    }
}
