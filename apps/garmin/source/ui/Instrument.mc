import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// What one "Instrument" screen shows: a task at the top, one value or a pair of values in the middle,
// the state below, and progress as a fine ring at the edge. Plain data, so screens build it and tests read it.
class InstrumentFace {
    enum Ring {
        RING_NONE,
        RING_SEGMENTS,   // counts units: sets, repetitions
        RING_TIME        // a continuous line: time
    }

    var top as Array<String> = [] as Array<String>;      // one or two lines
    var status as String or Null = null;                 // shown after the first top line: "Zone 2 · Im Ziel"
    var statusColor as Graphics.ColorType = Graphics.COLOR_WHITE;

    var left as String or Null = null;                   // the pair: two values with a line between them
    var right as String or Null = null;
    var leftUnit as String = "";
    var rightUnit as String = "";
    var leftColor as Graphics.ColorType = Graphics.COLOR_WHITE;
    var rightColor as Graphics.ColorType = Graphics.COLOR_WHITE;

    var hero as String or Null = null;                   // one value alone (the rest countdown)
    var heroColor as Graphics.ColorType = Graphics.COLOR_WHITE;
    var sub as String or Null = null;

    var bottom as String or Null = null;
    var bottomColor as Graphics.ColorType = Graphics.COLOR_LT_GRAY;

    var ring as Ring = RING_NONE;
    var segments as Number = 0;       // RING_SEGMENTS: how many, how many are done, how far the current one is (0..1000)
    var done as Number = 0;
    var part as Number = 0;
    var timeFrom as Number = 0;       // RING_TIME: degrees clockwise from twelve o'clock
    var timeLength as Number = 0;
    var ringColor as Graphics.ColorType = Graphics.COLOR_WHITE;

    function initialize() {
    }
}

// Draws an InstrumentFace. Every measure is given in the 260 px grid of the design and scaled to the display.
module Instrument {
    const TRACK as Number = 0x555555;     // the darkest neutral of the 64 colour palette that still shows on black
    const LABEL as Number = 0xAAAAAA;
    const OK as Number = 0x55FF55;        // only for "in target" / "done"
    const WARN as Number = 0xFFAA00;      // only for "attention", always with a word
    const PAIR_WIDTH as Number = 212;
    const PAIR_GAP as Number = 14;

    var _hero as Graphics.FontType or Null = null;
    var _big as Graphics.FontType or Null = null;
    var _mid as Graphics.FontType or Null = null;
    var _small as Graphics.FontType or Null = null;

    function heroFont() as Graphics.FontType {
        if (_hero == null) {
            _hero = WatchUi.loadResource(Rez.Fonts.NumHero) as Graphics.FontType;
        }
        return _hero as Graphics.FontType;
    }

    function bigFont() as Graphics.FontType {
        if (_big == null) {
            _big = WatchUi.loadResource(Rez.Fonts.NumBig) as Graphics.FontType;
        }
        return _big as Graphics.FontType;
    }

    function midFont() as Graphics.FontType {
        if (_mid == null) {
            _mid = WatchUi.loadResource(Rez.Fonts.NumMid) as Graphics.FontType;
        }
        return _mid as Graphics.FontType;
    }

    function smallFont() as Graphics.FontType {
        if (_small == null) {
            _small = WatchUi.loadResource(Rez.Fonts.NumSmall) as Graphics.FontType;
        }
        return _small as Graphics.FontType;
    }

    // True if both values and the line between them fit inside the ring in this font.
    function pairFits(dc as Dc, left as String, right as String, font as Graphics.FontType) as Boolean {
        return dc.getTextWidthInPixels(left, font) + dc.getTextWidthInPixels(right, font) + 2 * scale(dc, PAIR_GAP) <= scale(dc, PAIR_WIDTH);
    }

    // A measure of the 260 px grid on this display.
    function scale(dc as Dc, value as Number) as Number {
        return (value * dc.getWidth() + 130) / 260;
    }

    function draw(dc as Dc, face as InstrumentFace) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        if (dc has :setAntiAlias) {
            dc.setAntiAlias(true);
        }
        drawRing(dc, face);
        drawTop(dc, face);
        if (face.hero != null) {
            drawHero(dc, face);
        } else if (face.left != null && face.right != null) {
            drawPair(dc, face);
        }
        if (face.bottom != null) {
            text(dc, dc.getWidth() / 2, scale(dc, 206), Graphics.FONT_TINY, face.bottomColor, face.bottom as String);
        }
    }

    // Centred text (both ways) in a system font.
    function text(dc as Dc, x as Number, y as Number, font as Graphics.FontType, color as Graphics.ColorType, value as String) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawTop(dc as Dc, face as InstrumentFace) as Void {
        var cx = dc.getWidth() / 2;
        var font = Graphics.FONT_TINY;
        if (face.top.size() >= 2) {
            text(dc, cx, scale(dc, 52), font, LABEL, face.top[0]);
            text(dc, cx, scale(dc, 76), font, LABEL, face.top[1]);
            return;
        }
        if (face.top.size() == 0) {
            return;
        }
        var y = scale(dc, 68);
        var status = face.status;
        if (status == null) {
            text(dc, cx, y, font, LABEL, face.top[0]);
            return;
        }
        // "Zone 2 · Im Ziel": the name grey, the state in its colour, together centred.
        var head = face.top[0] + " · ";
        var headWidth = dc.getTextWidthInPixels(head, font);
        var x = cx - (headWidth + dc.getTextWidthInPixels(status, font)) / 2;
        dc.setColor(LABEL, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, head, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(face.statusColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + headWidth, y, font, status, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // Two values, the line between them, a unit under each. The pair is centred as a whole;
    // values too long for the big digits use the smaller ones.
    function drawPair(dc as Dc, face as InstrumentFace) as Void {
        var left = face.left as String;
        var right = face.right as String;
        var gap = scale(dc, PAIR_GAP);
        var font = bigFont();
        if (!pairFits(dc, left, right, font)) {
            font = midFont();
            if (!pairFits(dc, left, right, font)) {
                font = smallFont();
            }
        }
        var leftWidth = dc.getTextWidthInPixels(left, font);
        var rightWidth = dc.getTextWidthInPixels(right, font);
        var ascent = Graphics.getFontAscent(font);
        var top = scale(dc, 158) - ascent;
        var x = dc.getWidth() / 2 - (leftWidth + rightWidth + 2 * gap) / 2;
        var line = x + leftWidth + gap;
        dc.setColor(face.leftColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, top, font, left, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(face.rightColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(line + gap, top, font, right, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(TRACK, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(line - 1, top + 2, 2, scale(dc, 188) - top - 2);
        var unitY = scale(dc, 178);
        text(dc, x + leftWidth / 2, unitY, Graphics.FONT_TINY, LABEL, face.leftUnit);
        text(dc, line + gap + rightWidth / 2, unitY, Graphics.FONT_TINY, LABEL, face.rightUnit);
    }

    function drawHero(dc as Dc, face as InstrumentFace) as Void {
        var cx = dc.getWidth() / 2;
        var font = heroFont();
        dc.setColor(face.heroColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, scale(dc, 160) - Graphics.getFontAscent(font), font, face.hero as String, Graphics.TEXT_JUSTIFY_CENTER);
        if (face.sub != null) {
            text(dc, cx, scale(dc, 181), Graphics.FONT_SMALL, Graphics.COLOR_WHITE, face.sub as String);
        }
    }

    function drawRing(dc as Dc, face as InstrumentFace) as Void {
        if (face.ring == InstrumentFace.RING_NONE) {
            return;
        }
        var thin = scale(dc, 2);
        var thick = scale(dc, 6);
        if (face.ring == InstrumentFace.RING_TIME) {
            arc(dc, 0, 360, TRACK, thin);
            if (face.timeLength > 0) {
                arc(dc, face.timeFrom, face.timeLength, face.ringColor, thick);
            }
            return;
        }
        var count = face.segments;
        if (count <= 0) {
            return;
        }
        // Thick = done, thin and bright = now, thin and dark = still to come.
        var gap = count > 1 ? 5 : 0;
        for (var i = 0; i < count; i++) {
            var from = i * 360 / count + gap / 2;
            var length = (i + 1) * 360 / count - i * 360 / count - gap;
            if (i < face.done) {
                arc(dc, from, length, Graphics.COLOR_WHITE, thick);
            } else if (i == face.done) {
                arc(dc, from, length, Graphics.COLOR_WHITE, thin);
                if (face.part > 0) {
                    arc(dc, from, length * face.part / 1000, Graphics.COLOR_WHITE, thick);
                }
            } else {
                arc(dc, from, length, TRACK, thin);
            }
        }
        dc.setPenWidth(1);
    }

    // An arc of the ring: `from` and `length` in degrees, clockwise from twelve o'clock.
    function arc(dc as Dc, from as Number, length as Number, color as Graphics.ColorType, pen as Number) as Void {
        if (length <= 0) {
            return;
        }
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var radius = scale(dc, 122);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(pen < 1 ? 1 : pen);
        if (length >= 360) {
            dc.drawCircle(cx, cy, radius);
        } else {
            // drawArc counts degrees counter-clockwise from three o'clock.
            var start = ((90 - from) % 360 + 360) % 360;
            var end = ((90 - from - length) % 360 + 360) % 360;
            dc.drawArc(cx, cy, radius, Graphics.ARC_CLOCKWISE, start, end);
        }
        dc.setPenWidth(1);
    }
}
