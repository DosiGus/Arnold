import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// The design probe: shows the Instrument screens with made-up values, one after the other, so the look can be
// judged in the simulator and on a watch. Built only with design.jungle; never part of the product.
(:designGallery)
module DesignFaces {
    const OK as Number = 0x55FF55;
    const WARN as Number = 0xFFAA00;

    const FACES as Number = 17;   // 0..7 made up, 8..12 real set and rest faces, 13..16 real run page 1; then the line screens (UHR-05)

    function count() as Number {
        return FACES + DesignLines.count();
    }

    function at(index as Number) as InstrumentFace {
        if (index >= 13) {
            return RunGalleryFaces.at(index - 13);     // UHR-03: the real RunFaces.first on made-up runs
        }
        var f = new InstrumentFace();
        if (index == 0) {
            f.top = ["Überzüge am", "Kabelzug"] as Array<String>;
            pair(f, "62,5", "kg", "8", "Wdh.");
            f.bottom = "Satz 2 von 4";
            sets(f, 4, 1, 0);
        } else if (index == 1) {
            f.top = ["Pause"] as Array<String>;
            f.hero = "1:28";
            f.sub = "62,5 kg × 8";
            f.bottom = "Dann Satz 3";
            time(f, 97, 263);
        } else if (index == 2) {
            f.top = ["Zone 2"] as Array<String>;
            f.status = "Im Ziel";
            f.statusColor = OK;
            pair(f, "150", "bpm", "6:05", "/km");
            f.bottom = "12:18 von 45:00";
            time(f, 0, 98);
        } else if (index == 3) {
            f.top = ["Belastung 3 von 6"] as Array<String>;
            pair(f, "1:42", "Rest", "4:35", "/km");
            f.rightColor = OK;
            f.bottom = "Ziel 4:30–4:45";
            sets(f, 6, 2, 575);
        } else if (index == 4) {
            f.top = ["Bulgarische", "Kniebeuge"] as Array<String>;
            pair(f, "102,5", "kg", "12", "Wdh.");
            f.bottom = "Links · 3 von 5";
            sets(f, 5, 2, 0);
        } else if (index == 5) {
            f.top = ["Zone 2"] as Array<String>;
            f.status = "Zu hoch";
            f.statusColor = WARN;
            pair(f, "162", "bpm", "5:48", "/km");
            f.leftColor = WARN;
            f.bottom = "Langsamer";
            f.bottomColor = WARN;
            time(f, 0, 98);
        } else if (index == 6) {
            f.top = ["Überzüge am", "Kabelzug"] as Array<String>;
            pair(f, "–", "kg", "8", "Wdh.");
            f.bottom = "Gewicht offen";
            f.bottomColor = WARN;
            sets(f, 4, 1, 0);
        } else if (index == 7) {
            f.top = ["Pause"] as Array<String>;
            f.hero = "0:08";
            f.heroColor = WARN;
            f.sub = "62,5 kg × 8";
            f.bottom = "Dann Satz 3";
            time(f, 336, 24);
            f.ringColor = WARN;
        } else {
            return GalleryRig.face(index);   // 8..12: the real set and rest faces of the training screen (UHR-01/02)
        }
        return f;
    }

    function pair(f as InstrumentFace, left as String, leftUnit as String, right as String, rightUnit as String) as Void {
        f.left = left;
        f.leftUnit = leftUnit;
        f.right = right;
        f.rightUnit = rightUnit;
    }

    function sets(f as InstrumentFace, count as Number, done as Number, part as Number) as Void {
        f.ring = InstrumentFace.RING_SEGMENTS;
        f.segments = count;
        f.done = done;
        f.part = part;
    }

    function time(f as InstrumentFace, from as Number, length as Number) as Void {
        f.ring = InstrumentFace.RING_TIME;
        f.timeFrom = from;
        f.timeLength = length;
    }
}

(:designGallery)
class DesignGalleryView extends WatchUi.View {
    const SECONDS_PER_FACE as Number = 4;
    private var _index as Number = 0;
    private var _timer as Timer.Timer or Null = null;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        var timer = new Timer.Timer();
        timer.start(method(:next), SECONDS_PER_FACE * 1000, true);
        _timer = timer;
    }

    function onHide() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
    }

    function next() as Void {
        move(1);
    }

    function move(delta as Number) as Void {
        var count = DesignFaces.count();
        _index = ((_index + delta) % count + count) % count;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        if (_index >= DesignFaces.FACES) {
            PairingLayout.draw(dc, DesignLines.at(dc, _index - DesignFaces.FACES));
            return;
        }
        Instrument.draw(dc, DesignFaces.at(_index));
    }
}

// UP and DOWN step through the screens by hand.
(:designGallery)
class DesignGalleryDelegate extends WatchUi.BehaviorDelegate {
    private var _view as DesignGalleryView;

    function initialize(view as DesignGalleryView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage() as Boolean {
        _view.move(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.move(-1);
        return true;
    }
}

// UHR-05: the screens built from lines (preview, summaries, home, pre-start, run end) with made-up values,
// using the same fonts and colours as the real screens.
(:designGallery)
module DesignLines {
    function count() as Number {
        return 5;
    }

    function line(text as String, font as Graphics.FontType, color as Graphics.ColorType) as PairingLine {
        return new PairingLine(text, font, color);
    }

    function at(dc as Dc, index as Number) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var white = Graphics.COLOR_WHITE;
        if (index == 0) {          // start screen
            out.add(line("Plan: vor 5 Min.", Graphics.FONT_XTINY, Instrument.LABEL).skippable());
            out.add(line("Heute", Graphics.FONT_XTINY, Instrument.LABEL).skippable());
            out.add(line("> Push · 52 Min.", Graphics.FONT_TINY, white));
            out.add(line("Freier Lauf", Graphics.FONT_XTINY, Instrument.LABEL).skippable());
            out.add(line("Zone 2", Graphics.FONT_TINY, Instrument.LABEL));
            out.add(line("1 Training wartet", Graphics.FONT_XTINY, Instrument.WARN));
        } else if (index == 1) {   // exercise preview
            out.add(line("Übung 2 von 6", Graphics.FONT_XTINY, Instrument.LABEL));
            out.add(line("Überzüge am Kabelzug", Graphics.FONT_MEDIUM, white));
            out.add(line("4 Sätze · 8 × 62,5 kg", Graphics.FONT_SMALL, white));
            out.add(line("Pause 1:30", Graphics.FONT_XTINY, Instrument.LABEL));
            out.add(line("Heute 65 kg versuchen", Graphics.FONT_XTINY, white));
        } else if (index == 2) {   // strength summary
            out.add(line("Training fertig", Graphics.FONT_MEDIUM, white));
            out.add(line("52 min", Graphics.FONT_SMALL, white));
            out.add(line("18 von 20 Sätzen", Graphics.FONT_XTINY, Instrument.LABEL));
            out.add(line("6 Übungen", Graphics.FONT_XTINY, Instrument.LABEL));
            out.add(line("START: speichern", Graphics.FONT_XTINY, white));
        } else if (index == 3) {   // pre-start of a run
            out.add(line("Grundlage", Graphics.FONT_TINY, Instrument.LABEL).skippable());
            out.add(line("Zone 2 Lauf", Graphics.FONT_SMALL, white));
            out.add(line("45 min · 3 Abschnitte", Graphics.FONT_TINY, Instrument.LABEL).skippable());
            out.add(line("Draußen", Graphics.FONT_MEDIUM, white));
            out.add(line("GPS gut", Graphics.FONT_TINY, Instrument.OK));
            out.add(line("Puls 58", Graphics.FONT_TINY, Instrument.LABEL));
            out.add(line("START drücken", Graphics.FONT_TINY, Instrument.TRACK).skippable());
        } else {                   // run summary, page 1
            RunEndScreens.distanceLines(dc, out, 842000, false);
            out.add(line("Zeit 52:41", Graphics.FONT_MEDIUM, white));
            out.add(line("Ø 6:15 /km", Graphics.FONT_SMALL, white));
            out.add(line("An Arnold gesendet", Graphics.FONT_XTINY, Instrument.OK).skippable());
            out.add(line("Seite 1 von 3", Graphics.FONT_XTINY, Instrument.TRACK).skippable());
        }
        return out;
    }
}

// In-memory pieces so the gallery can run a real TrainingSession (the test doubles are not part of this build).
(:designGallery)
class GalleryStore extends KeyValueStore {
    private var _values as Dictionary = {} as Dictionary;

    function initialize() {
        KeyValueStore.initialize();
    }

    function getValue(key as String) as Application.Storage.ValueType {
        return _values[key] as Application.Storage.ValueType;
    }

    function setValue(key as String, value as Application.Storage.ValueType) as Void {
        _values[key] = value;
    }

    function deleteValue(key as String) as Void {
        _values.remove(key);
    }
}

(:designGallery)
class GalleryClock extends PairingClock {
    var now as Number = 1000000;

    function initialize() {
        PairingClock.initialize();
    }

    function nowSeconds() as Number {
        return now;
    }

    function utcOffsetMinutes() as Number {
        return 0;
    }
}

(:designGallery)
class GallerySignals extends Signals {
    function initialize() {
        Signals.initialize(null);
    }

    function warn() as Void {
    }

    function restOver() as Void {
    }
}

// Faces 8..12: set with weight, set with "Weight open", rest above and below ten seconds, second page of the set.
(:designGallery)
module GalleryRig {
    function day(load as Number or Null) as Dictionary {
        var cat = [{ "id" => "ex_a", "n" => "Überzüge am Kabelzug", "g" => 2500, "l" => { "b" => "total" }, "s" => [[4, 8, load]] }] as Array;
        var items = [{ "id" => "it_a", "c" => 0, "r" => 120, "rr" => null, "l" => "Letztes Mal 8 · 8 · 7" }] as Array;
        return { "api_version" => 1, "min_app_version" => "1.0.0", "p" => "plv_1", "id" => "d1", "n" => "Oberkörper A", "cat" => cat, "items" => items };
    }

    function face(index as Number) as InstrumentFace {
        var clock = new GalleryClock();
        var session = TrainingSession.start(day(index == 9 ? null : 62500), new Journal(new GalleryStore()), clock, new GallerySignals());
        session.confirmPreview();
        if (index == 10 || index == 11) {
            session.confirmSet();
            clock.now += index == 10 ? 32 : 112;
            return RestScreen.face(session, 98, 0);
        }
        if (index != 9) {
            session.confirmSet();     // set 1 is done, the screen shows set 2
            session.endRest();
        }
        return SetScreen.face(session, 132, index == 12 ? 1 : 0);
    }
}

// UHR-03: page 1 of the run display, made by the real RunFaces.first from a run session on made-up readings
// (no recording, no storage). Uses GalleryStore above.
(:designGallery)
class GalleryBackend extends RunBackend {
    function initialize() {
        RunBackend.initialize();
    }

    function open(environment as Number) as Boolean {
        return true;
    }

    function lap(segment as Number) as Boolean {
        return true;
    }

    function start() as Boolean {
        return true;
    }

    function stop() as Boolean {
        return true;
    }
}

(:designGallery)
class GallerySource extends RunSource {
    var timer as Number = 0;
    var distance as Number = 0;
    var speed as Number = 300;
    var hr as Number = 140;

    function initialize() {
        RunSource.initialize();
    }

    function read(into as RunReading) as Void {
        timer++;
        distance += speed;
        into.timerS = timer;
        into.distanceCm = distance;
        into.speedCmS = speed;
        into.heartRate = hr;
        into.cadence = 170;
        into.ascentM = 0;
    }
}

(:designGallery)
module RunGalleryFaces {
    const TICKS_PER_FRAME as Number = 4;     // more in one frame trips the watchdog of the simulator
    var _index as Number = -1;
    var _session as RunSession or Null = null;
    var _target as Number = 0;
    var _ticked as Number = 0;

    function count() as Number {
        return 4;
    }

    function at(index as Number) as InstrumentFace {
        if (index != _index || _session == null) {
            build(index);
        }
        var session = _session as RunSession;
        var n = 0;
        while (_ticked < _target && n < TICKS_PER_FRAME) {
            session.tick();
            _ticked++;
            n++;
        }
        if (_ticked < _target) {
            WatchUi.requestUpdate();           // the run of the picture is still being made up
        } else if (index == 3 && !session.isPaused()) {
            session.pause();
        }
        return RunFaces.first(session);
    }

    function build(index as Number) as Void {
        var source = new GallerySource();
        var store = new GalleryStore();
        var parts = new RunParts(new RunJournal(store), new PairingClock(), new Settings(store), source, new GalleryBackend(), null,
            [100, 120, 140, 160, 180, 200] as Array<Number>);
        var body = { "k" => 1, "n" => "Zone 2", "e" => 0, "s" => [[1, 1, 150, 1, 2, 2]] as Array } as Dictionary;
        var seconds = 41;
        if (index == 0) {
            source.hr = 130;
            source.speed = 274;                  // 6:05 /km
        } else if (index == 1) {
            source.hr = 162;
            source.speed = 287;                  // 5:48 /km
        } else {
            body = { "k" => 6, "n" => "Intervalle", "e" => 0, "s" => [[1, 1, 20, 2, 270, 285], [2, 1, 15, 0, 0, 0]] as Array, "rp" => [[0, 1, 6]] as Array } as Dictionary;
            source.speed = 363;                  // 4:35 /km
            seconds = index == 2 ? 2 * 35 + 8 : 35 + 5;
        }
        var model = new PreStartModel(new PreStartRequest(PreStartRequest.MODE_PLANNED, "gallery", body));
        _session = RunSession.start(model, parts);
        _index = index;
        _target = seconds;
        _ticked = 0;
    }
}
