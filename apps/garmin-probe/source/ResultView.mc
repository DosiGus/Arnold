import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Shows Log.lines; UP/DOWN scroll, BACK returns to the menu.
class ResultView extends WatchUi.View {
    var first as Number = 0;

    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var lineHeight = dc.getFontHeight(Graphics.FONT_XTINY);
        var y = dc.getHeight() / 6;
        var lines = Log.lines;
        for (var i = first; i < lines.size() && y < dc.getHeight() * 5 / 6; i++) {
            dc.drawText(dc.getWidth() / 2, y, Graphics.FONT_XTINY, lines[i], Graphics.TEXT_JUSTIFY_CENTER);
            y += lineHeight;
        }
        if (lines.size() == 0) {
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL, "laeuft ...", Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    function scroll(delta as Number) as Void {
        first += delta;
        if (first < 0) {
            first = 0;
        }
        if (first >= Log.lines.size()) {
            first = Log.lines.size() > 0 ? Log.lines.size() - 1 : 0;
        }
        WatchUi.requestUpdate();
    }
}

class ResultDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onKey(keyEvent as WatchUi.KeyEvent) as Boolean {
        System.println("11 Taste=" + keyEvent.getKey() + " Art=" + keyEvent.getType());
        return false;
    }

    function onNextPage() as Boolean {
        var view = WatchUi.getCurrentView()[0];
        if (view instanceof ResultView) {
            (view as ResultView).scroll(3);
        }
        return true;
    }

    function onPreviousPage() as Boolean {
        var view = WatchUi.getCurrentView()[0];
        if (view instanceof ResultView) {
            (view as ResultView).scroll(-3);
        }
        return true;
    }
}
