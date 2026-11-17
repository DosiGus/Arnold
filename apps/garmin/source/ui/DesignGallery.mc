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
        return 13;
    }

    function at(index as Number) as InstrumentFace {
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
