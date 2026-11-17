import Toybox.Lang;

// Static facts about this build. The version is sent to the server later (X-Arnold-Watch).
(:background)
module AppInfo {
    const VERSION as String = "0.2.0";

    // True when text looks like MAJOR.MINOR.PATCH with digits only.
    function isSemver(text as String) as Boolean {
        var parts = 0;
        var digits = 0;
        var chars = text.toCharArray();
        for (var i = 0; i < chars.size(); i++) {
            var c = chars[i];
            if (c == '.') {
                if (digits == 0) {
                    return false;
                }
                parts++;
                digits = 0;
            } else if (c >= '0' && c <= '9') {
                digits++;
            } else {
                return false;
            }
        }
        return parts == 2 && digits > 0;
    }
}
