import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

module BackgroundProbe {
    function schedule() as Void {
        Log.start("15 Hintergrund");
        Background.registerForTemporalEvent(Time.now().add(new Time.Duration(300)));
        Log.line("In fruehestens 5 Minuten");
        Log.line("App verlassen, iPhone verbunden");
        Log.line("Ergebnis nach Neustart anzeigen");
    }
    function onResult(data as Application.PersistableType) as Void {
        if (data instanceof Dictionary && data["rc"] instanceof Number && data["ms"] instanceof Number) {
            Application.Storage.setValue("background-result", {"rc" => data["rc"] as Number, "ms" => data["ms"] as Number});
        }
    }
    function showResult() as Void {
        Log.start("15 Ergebnis");
        var data = Application.Storage.getValue("background-result");
        if (data instanceof Dictionary) {
            Log.line("rc=" + data["rc"] + " ms=" + data["ms"]);
        } else { Log.line("Noch kein Ergebnis"); }
    }
}
(:background)
class ProbeService extends System.ServiceDelegate {
    var started as Number = 0;
    function initialize() { ServiceDelegate.initialize(); }
    function onTemporalEvent() as Void {
        started = System.getTimer();
        if (ProbeConfig.URL.find("https://") != 0) { Background.exit({"rc" => -999, "ms" => 0}); return; }
        Communications.makeWebRequest(ProbeConfig.URL + "/upload", {"probe" => "synthetic-bg-v1"},
            {:method => Communications.HTTP_REQUEST_METHOD_POST,
             :headers => {"Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON},
             :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON}, method(:onResponse));
    }
    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        Background.exit({"rc" => code, "ms" => System.getTimer() - started});
    }
}
