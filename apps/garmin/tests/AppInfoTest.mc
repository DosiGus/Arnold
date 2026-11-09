import Toybox.Lang;
import Toybox.Test;

(:test)
function appVersionIsSemver(logger as Logger) as Boolean {
    return AppInfo.isSemver(AppInfo.VERSION);
}

(:test)
function semverRejectsMalformedText(logger as Logger) as Boolean {
    Test.assert(!AppInfo.isSemver(""));
    Test.assert(!AppInfo.isSemver("1.0"));
    Test.assert(!AppInfo.isSemver("1..0"));
    Test.assert(!AppInfo.isSemver("1.0.0-beta"));
    Test.assert(!AppInfo.isSemver("1.0.0."));
    return AppInfo.isSemver("10.2.33");
}
