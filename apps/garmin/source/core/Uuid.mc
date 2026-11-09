import Toybox.Cryptography;
import Toybox.Lang;
import Toybox.Math;

// Random UUID version 4, lower case, e.g. "3b241101-e2bb-4255-8caf-4136c566a962".
(:background)
module Uuid {

    function v4() as String {
        var bytes = randomBytes();
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        var out = "";
        for (var i = 0; i < 16; i++) {
            if (i == 4 || i == 6 || i == 8 || i == 10) {
                out += "-";
            }
            out += (bytes[i] as Number).format("%02x");
        }
        return out;
    }

    function isV4(text as String) as Boolean {
        if (text.length() != 36) {
            return false;
        }
        var chars = text.toCharArray();
        for (var i = 0; i < 36; i++) {
            var c = chars[i];
            if (i == 8 || i == 13 || i == 18 || i == 23) {
                if (c != '-') {
                    return false;
                }
            } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
                return false;
            }
        }
        var variant = chars[19];
        return chars[14] == '4' && (variant == '8' || variant == '9' || variant == 'a' || variant == 'b');
    }

    function randomBytes() as ByteArray {
        if (Toybox has :Cryptography && Cryptography has :randomBytes) {
            return Cryptography.randomBytes(16);
        }
        var bytes = new [16]b;
        for (var i = 0; i < 16; i++) {
            bytes[i] = Math.rand() & 0xff;
        }
        return bytes;
    }
}
