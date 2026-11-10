import Toybox.Graphics;
import Toybox.Lang;

// One line of text on a screen: its font and colour.
class PairingLine {
    var text as String;
    var font as Graphics.FontType;
    var color as Graphics.ColorType;

    function initialize(lineText as String, lineFont as Graphics.FontType, lineColor as Graphics.ColorType) {
        text = lineText;
        font = lineFont;
        color = lineColor;
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

    // The first font (largest first) in which the text fits on one line; the last one otherwise.
    function fitFont(dc as Dc, text as String, maxWidth as Number, fonts as Array<Graphics.FontType>) as Graphics.FontType {
        for (var i = 0; i < fonts.size(); i++) {
            if (dc.getTextWidthInPixels(text, fonts[i]) <= maxWidth) {
                return fonts[i];
            }
        }
        return fonts[fonts.size() - 1];
    }

    // Draws the lines as one block, centred on the display.
    function draw(dc as Dc, lines as Array<PairingLine>) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var drawn = [] as Array<PairingLine>;
        var total = 0;
        for (var i = 0; i < lines.size(); i++) {
            var parts = wrap(dc, lines[i].text, lines[i].font, textWidth(dc));
            for (var j = 0; j < parts.size(); j++) {
                drawn.add(new PairingLine(parts[j], lines[i].font, lines[i].color));
                total += dc.getFontHeight(lines[i].font);
            }
        }
        var y = (h - total) / 2;
        for (var k = 0; k < drawn.size(); k++) {
            dc.setColor(drawn[k].color, Graphics.COLOR_BLACK);
            dc.drawText(w / 2, y, drawn[k].font, drawn[k].text, Graphics.TEXT_JUSTIFY_CENTER);
            y += dc.getFontHeight(drawn[k].font);
        }
    }
}
