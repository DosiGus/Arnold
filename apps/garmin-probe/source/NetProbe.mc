import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

module NetProbe {
    var index as Number = 0;
    var busy as Boolean = false;
    var sizesList as Array<Number> = [2048, 4096, 8192, 16384, 32768];
    var started as Number = 0;
    var nextTimer as Timer.Timer?;
    function sizes() as Void {
        if (busy) { Log.line("Anfrage laeuft"); return; }
        Log.start("2 Antwortgroessen");
        index = 0;
        nextSize();
    }
    function nextSize() as Void {
        if (index >= sizesList.size()) { busy = false; Log.line("2 Messreihe beendet"); WatchUi.requestUpdate(); return; }
        if (ProbeConfig.URL.find("https://") != 0) { Log.line("HTTPS-URL fehlt: konfigurieren"); return; }
        busy = true;
        var n = sizesList[index];
        Log.line("Anfrage " + n + " Byte");
        Communications.makeWebRequest(ProbeConfig.URL + "/size", {"bytes" => n},
            {:method => Communications.HTTP_REQUEST_METHOD_GET, :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON},
            new NetResponder().method(:onSize));
    }
    function onSize(code as Number, data as Dictionary or String or Null) as Void {
        var n = sizesList[index];
        var valid = code == 200 && data instanceof Dictionary && data["bytes"] == n;
        Log.line(n + " Byte rc=" + code + (valid ? " OK" : " FEHLER"));
        index++;
        WatchUi.requestUpdate();
        nextTimer = new Timer.Timer();
        (nextTimer as Timer.Timer).start(new NetResponder().method(:nextSize), 250, false);
    }
    function once() as Void {
        if (busy) { Log.line("Anfrage laeuft"); return; }
        Log.start("16 iPhone-Anfrage");
        if (ProbeConfig.URL.find("https://") != 0) { Log.line("HTTPS-URL fehlt"); return; }
        busy = true;
        started = System.getTimer();
        Communications.makeWebRequest(ProbeConfig.URL + "/upload", {"probe" => "synthetic-v1"},
            {:method => Communications.HTTP_REQUEST_METHOD_POST,
             :headers => {"Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON},
             :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON}, new NetResponder().method(:onOnce));
    }
    function onOnce(code as Number, data as Dictionary or String or Null) as Void {
        busy = false;
        Log.line("rc=" + code + " ms=" + (System.getTimer() - started));
        Log.line("Telefonzustand manuell notieren");
        WatchUi.requestUpdate();
    }
}

class NetResponder {
    function initialize() {}
    function onSize(code as Number, data as Dictionary or String or Null) as Void { NetProbe.onSize(code, data); }
    function onOnce(code as Number, data as Dictionary or String or Null) as Void { NetProbe.onOnce(code, data); }
    function nextSize() as Void { NetProbe.nextSize(); }
}
