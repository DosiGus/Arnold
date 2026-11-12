import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Test;
(:test)
function storageDetectsInterruptedOrMalformedValues(logger as Logger) as Boolean {
    Test.assert(StorageProbe.valid({"seq" => 42, "mirror" => -42, "marker" => "probe-v1"}));
    Test.assert(!StorageProbe.valid(null));
    Test.assert(!StorageProbe.valid({"seq" => 42, "mirror" => -41, "marker" => "probe-v1"}));
    Test.assert(!StorageProbe.valid({"seq" => 42}));
    Test.assert(!StorageProbe.valid({"seq" => "42", "mirror" => -42, "marker" => "probe-v1"}));
    return true;
}
(:test)
function emptyResultCannotScrollBeforeFirstLine(logger as Logger) as Boolean {
    Log.start("Empty view test");
    var view = new ResultView();
    view.scroll(3);
    Test.assert(view.first == 0);
    view.scroll(-3);
    Test.assert(view.first == 0);
    return true;
}
(:test)
function resultViewDrawsAndScrollsOnFr255(logger as Logger) as Boolean {
    Log.start("Rendering");
    for (var i = 0; i < 30; i++) { Log.line("Synthetic line " + i); }
    var bitmap = Graphics.createBufferedBitmap({:width => 260, :height => 260});
    var view = new ResultView();
    view.onUpdate((bitmap.get() as Graphics.BufferedBitmap).getDc());
    view.scroll(3);
    Test.assert(view.first == 3);
    view.onUpdate((bitmap.get() as Graphics.BufferedBitmap).getDc());
    return true;
}
