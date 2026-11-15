import Toybox.Graphics;
import Toybox.Lang;

// One line of text on a screen: its font and colour.
class PairingLine {
    var text as String;
    var font as Graphics.FontType;
    var color as Graphics.ColorType;
    var wide as Boolean = false;      // the main number: may use more of the width (it sits in the middle)
    var optional as Boolean = false;  // dropped, last first, when the lines do not fit the display

    function initialize(lineText as String, lineFont as Graphics.FontType, lineColor as Graphics.ColorType) {
        text = lineText;
        font = lineFont;
        color = lineColor;
    }

    function big() as PairingLine {
        wide = true;
        return self;
    }

    function skippable() as PairingLine {
        optional = true;
        return self;
    }
}

// Centres blocks of text on a round display. All sizes are relative to the
// display; long texts wrap, and the code shrinks to the largest font that fits.
module PairingLayout {

    // Width of the text area: the display is round, so the middle is narrower than the display.
    function textWidth(dc as Dc) as Number {
        return dc.getWidth() * 78 / 100;
    }

    // Breaks a text into lines no wider than maxWidth. A single word wider than
    // maxWidth stays on its own line.
    function wrap(dc as Dc, text as String, font as Graphics.FontType, maxWidth as Number) as Array<String> {
        var lines = [] as Array<String>;
        var current = "";
        var rest = text;
        while (rest.length() > 0) {
            var space = rest.find(" ");
            var word = space == null ? rest : rest.substring(0, space as Number) as String;
            rest = space == null ? "" : rest.substring((space as Number) + 1, rest.length()) as String;
            var candidate = current.length() == 0 ? word : current + " " + word;
            if (current.length() > 0 && dc.getTextWidthInPixels(candidate, font) > maxWidth) {
                lines.add(current);
                current = word;
            } else {
                current = candidate;
            }
        }
        if (current.length() > 0) {
            lines.add(current);
        }
        return lines;
    }

    // Width for the exercise name at the top of the display (the round edge is narrow there).
    function nameWidth(dc as Dc) as Number {
        return dc.getWidth() * 68 / 100;
    }

    // The text cut to fit maxWidth on one line: the end becomes "..." (plain dots, every font has them).
    // Counts characters, not bytes, so umlauts are never cut in half.
    function ellipsize(dc as Dc, text as String, font as Graphics.FontType, maxWidth as Number) as String {
        if (dc.getTextWidthInPixels(text, font) <= maxWidth) {
            return text;
        }
        var n = text.length();
        while (n > 1) {
            n--;
            var cut = (text.substring(0, n) as String) + "...";
            if (dc.getTextWidthInPixels(cut, font) <= maxWidth) {
                return cut;
            }
        }
        return "...";
    }

    // A line with an exercise name (or text with one in it): one line, long names cut with "...".
    function nameLine(dc as Dc, text as String, color as Graphics.ColorType) as PairingLine {
        var font = Graphics.FONT_TINY;
        return new PairingLine(ellipsize(dc, text, font, nameWidth(dc)), font, color);
    }

    // The same further down the display, where the round edge leaves more width.
    function lowerNameLine(dc as Dc, text as String, color as Graphics.ColorType) as PairingLine {
        var font = Graphics.FONT_TINY;
        return new PairingLine(ellipsize(dc, text, font, textWidth(dc)), font, color);
    }

    // The first font (largest first) in which the text fits on one line; the last one otherwise.
    function fitFont(dc as Dc, text as String, maxWidth as Number, fonts as Array<Graphics.FontType>) as Graphics.FontType {
        for (var i = 0; i < fonts.size(); i++) {
            if (dc.getTextWidthInPixels(text, fonts[i]) <= maxWidth) {
                return fonts[i];
            }
        }
        return fonts[fonts.size() - 1];
    }

    // The main number (weight, repetitions, rest time) takes at least a third of the display height
    // (PRD 7). The smallest number font that is tall enough and fits the width (the bigger one only
    // where the first is too small, e.g. fr955); for very long values the biggest that fits.
    function bigFont(dc as Dc, text as String) as Graphics.FontType {
        var tall = [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_THAI_HOT] as Array<Graphics.FontType>;
        for (var i = 0; i < tall.size(); i++) {
            if (isBig(dc, tall[i]) && dc.getTextWidthInPixels(text, tall[i]) <= bigWidth(dc)) {
                return tall[i];
            }
        }
        var fonts = [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE] as Array<Graphics.FontType>;
        return fitFont(dc, text, bigWidth(dc), fonts);
    }

    function bigLine(dc as Dc, text as String, color as Graphics.ColorType) as PairingLine {
        return new PairingLine(text, bigFont(dc, text), color).big();
    }

    function bigWidth(dc as Dc) as Number {
        return dc.getWidth() * 90 / 100;
    }

    // True if a font is at least a third of the display height.
    function isBig(dc as Dc, font as Graphics.FontType) as Boolean {
        return dc.getFontHeight(font) * 3 >= dc.getHeight();
    }

    // The part of the display height the lines may fill (the rest is the round edge).
    function maxBlockHeight(dc as Dc) as Number {
        return dc.getHeight() * 86 / 100;
    }

    // Wraps every line; drops optional lines (last first) until the block fits.
    // Returns the lines as drawn (wrapped), in order.
    function arrange(dc as Dc, lines as Array<PairingLine>) as Array<PairingLine> {
        var keep = [] as Array<PairingLine>;
        for (var i = 0; i < lines.size(); i++) {
            keep.add(lines[i]);
        }
        var drawn = wrapAll(dc, keep);
        while (blockHeight(dc, drawn) > maxBlockHeight(dc)) {
            var last = -1;
            for (var j = 0; j < keep.size(); j++) {
                if (keep[j].optional) {
                    last = j;
                }
            }
            if (last < 0) {
                break;
            }
            keep.remove(keep[last]);
            drawn = wrapAll(dc, keep);
        }
        return drawn;
    }

    function wrapAll(dc as Dc, lines as Array<PairingLine>) as Array<PairingLine> {
        var drawn = [] as Array<PairingLine>;
        for (var i = 0; i < lines.size(); i++) {
            var width = lines[i].wide ? bigWidth(dc) : textWidth(dc);
            var parts = wrap(dc, lines[i].text, lines[i].font, width);
            for (var j = 0; j < parts.size(); j++) {
                drawn.add(new PairingLine(parts[j], lines[i].font, lines[i].color));
            }
        }
        return drawn;
    }

    function blockHeight(dc as Dc, drawn as Array<PairingLine>) as Number {
        var total = 0;
        for (var i = 0; i < drawn.size(); i++) {
            total += dc.getFontHeight(drawn[i].font);
        }
        return total;
    }

    // A long screen that the user scrolls with UP and DOWN (the summary after a workout): every line is kept,
    // the block starts at line `first` (after wrapping) and shows as many lines as fit between the margins of a
    // round display. When everything fits it looks exactly like draw(). Returns `first`, held within the lines,
    // so the caller keeps a valid position.
    function drawFrom(dc as Dc, lines as Array<PairingLine>, first as Number) as Number {
        var h = dc.getHeight();
        var all = wrapAll(dc, lines);
        var margin = h / 8;
        if (blockHeight(dc, all) <= h - 2 * margin) {
            draw(dc, lines);
            return 0;
        }
        var lastFirst = all.size() - 1;
        var tail = 0;
        for (var i = all.size() - 1; i >= 0; i--) {
            tail += dc.getFontHeight(all[i].font);
            if (tail > h - 2 * margin) {
                break;
            }
            lastFirst = i;
        }
        var start = first < 0 ? 0 : (first > lastFirst ? lastFirst : first);
        var w = dc.getWidth();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var y = margin;
        for (var k = start; k < all.size(); k++) {
            var lineHeight = dc.getFontHeight(all[k].font);
            if (y + lineHeight > h - margin) {
                break;
            }
            dc.setColor(all[k].color, Graphics.COLOR_BLACK);
            dc.drawText(w / 2, y, all[k].font, all[k].text, Graphics.TEXT_JUSTIFY_CENTER);
            y += lineHeight;
        }
        return start;
    }

    // Draws the lines as one block, centred on the display, on black (AMOLED: no lit areas).
    function draw(dc as Dc, lines as Array<PairingLine>) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var drawn = arrange(dc, lines);
        var y = (h - blockHeight(dc, drawn)) / 2;
        for (var k = 0; k < drawn.size(); k++) {
            dc.setColor(drawn[k].color, Graphics.COLOR_BLACK);
            dc.drawText(w / 2, y, drawn[k].font, drawn[k].text, Graphics.TEXT_JUSTIFY_CENTER);
            y += dc.getFontHeight(drawn[k].font);
        }
    }
}
