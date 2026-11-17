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

    function count() as Number {
        return 8 + RunGalleryFaces.count();
    }

    function at(index as Number) as InstrumentFace {
        if (index >= 8) {
            return RunGalleryFaces.at(index - 8);      // UHR-03: the real RunFaces.first on made-up runs
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
        } else {
            f.top = ["Pause"] as Array<String>;
            f.hero = "0:08";
            f.heroColor = WARN;
            f.sub = "62,5 kg × 8";
            f.bottom = "Dann Satz 3";
            time(f, 336, 24);
            f.ringColor = WARN;
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

// UHR-03: page 1 of the run display, made by the real RunFaces.first from a run session on made-up readings
// (no recording, no storage). Gallery only.
(:designGallery)
class GalleryStore extends KeyValueStore {
    var values as Dictionary<String, Application.Storage.ValueType> = {} as Dictionary<String, Application.Storage.ValueType>;

    function initialize() {
        KeyValueStore.initialize();
    }

    function getValue(key as String) as Application.Storage.ValueType {
        return values[key];
    }

    function setValue(key as String, value as Application.Storage.ValueType) as Void {
        values[key] = value;
    }

    function deleteValue(key as String) as Void {
        values.remove(key);
    }
}

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
