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
        return 8;
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
