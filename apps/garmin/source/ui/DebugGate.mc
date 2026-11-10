import Toybox.Application;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Entire file is excluded from the product build through :garminGate annotations.
(:garminGate)
module DebugState {
    var runner as DebugRunner?;
    function get() as DebugRunner {
        if (runner == null) { runner = new DebugRunner(new KeyValueStore()); }
        return runner as DebugRunner;
    }
}

(:garminGate)
class DebugClient extends ApiClient {
    var observer as DebugRunner;
    function initialize(owner as DebugRunner) {
        observer = owner;
        ApiClient.initialize(DebugConfig.URL + "/api/watch/v1", new Transport(), new Scheduler());
    }
    function onResponse(ticket as Number, code as Number, data as Dictionary or String or Null) as Void {
        observer.wire(code);
        ApiClient.onResponse(ticket, code, data);
    }
    function onTimeout() as Void {
        observer.note("Timeout nach 35s");
        ApiClient.onTimeout();
    }
}

(:garminGate)
class DebugRunner {
    var lines as Array<String> = [] as Array<String>;
    var store as KeyValueStore;
    var client as DebugClient;
    var pairing as Boolean = false;
    var deviceCode as String = "";
    var pollTimer as Timer.Timer?;
    var uploadQueued as Boolean = false;
    var ready as Boolean = false;
    const AUTH = "debug:auth";
    const PLAN = "debug:plan";
    const OUTBOX = "debug:outbox";

    function initialize(injectedStore as KeyValueStore) {
        store = injectedStore;
        client = new DebugClient(self);
        var schema = StoreSchema.migrate(store);
        ready = schema != StoreSchema.RESULT_NEWER && schema != StoreSchema.RESULT_INVALID;
        var token = store.getValue(AUTH);
        if (token instanceof String) { client.setToken(token); }
        client.setClientInfo(Capabilities.partNumber(), Capabilities.languageCode());
        status();
    }
    function note(text as String) as Void {
        System.println("GATE " + text);
        var rest = text;
        while (rest.length() > 24) {
            lines.add(rest.substring(0, 24) as String);
            rest = rest.substring(24, rest.length()) as String;
        }
        lines.add(rest);
        while (lines.size() > 80) { lines.remove(lines[0]); }
        WatchUi.requestUpdate();
    }
    function fresh(title as String) as Void { lines = [] as Array<String>; note(title); }
    function status() as Void {
        fresh("GAR-B3-00 / TEST");
        note("Nur synthetischer Mock");
        note("Schema=" + ready);
        note("Kopplung=" + (store.getValue(AUTH) != null));
        note("Plan gespeichert=" + (store.getValue(PLAN) != null));
        var out = store.getValue(OUTBOX);
        note("Outbox=" + (out != null));
        if (out instanceof Dictionary) { note("request_id=" + out["request_id"]); }
    }
    function canSend() as Boolean {
        if (!ready) { note("BLOCKIERT: Storage-Schema"); return false; }
        if (DebugConfig.URL.find("https://") != 0) { note("BLOCKIERT: HTTPS-URL fehlt"); return false; }
        return true;
    }
    function wire(code as Number) as Void {
        note("Netz rc=" + code);
        store.setValue("debug:last-code", code);
        if (code < 0 && store.getValue(OUTBOX) != null) { note("Outbox bleibt gespeichert"); }
    }
    function pair() as Void {
        fresh("1 Mock koppeln");
        if (!canSend() || pairing || client.isBusy()) { return; }
        pairing = true;
        client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/pair/start",
            {"device_label" => "Synthetic FR255 gate", "part_number" => Capabilities.partNumber(),
             "app_version" => AppInfo.VERSION}, method(:onPairStart)));
    }
    function onPairStart(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (outcome == ApiClient.DONE_OK && data instanceof Dictionary && data["device_code"] instanceof String) {
            deviceCode = data["device_code"] as String;
            pollTimer = new Timer.Timer();
            (pollTimer as Timer.Timer).start(method(:poll), 5000, false);
            note("Mock bestaetigt automatisch");
        } else { pairing = false; note("Kopplung fehlgeschlagen"); }
    }
    function poll() as Void {
        client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/pair/token",
            {"device_code" => deviceCode}, method(:onPairToken)));
    }
    function onPairToken(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (outcome == ApiClient.DONE_OK && data instanceof Dictionary) {
            if (data["access_token"] instanceof String) {
                var token = data["access_token"] as String;
                client.setToken(token);
                store.setValue(AUTH, token);
                pairing = false;
                deviceCode = "";
                note("Mock gekoppelt / Token privat");
                return;
            }
            if (data["status"] instanceof String && (data["status"] as String).equals("pending")) {
                (pollTimer as Timer.Timer).start(method(:poll), 5000, false);
                return;
            }
        }
        pairing = false;
        note("Mock-Kopplung nicht beendet");
    }
    function loadPlan() as Void {
        fresh("2 8KiB-Plan laden");
        if (!canSend()) { return; }
        client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET, "/plan", null, method(:onDirectory)));
    }
    function onDirectory(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (outcome != ApiClient.DONE_OK || !(data instanceof Dictionary) || !(data["next"] instanceof String)) {
            note("Verzeichnis fehlgeschlagen"); return;
        }
        client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_GET,
            "/plan/sessions/" + (data["next"] as String), null, method(:onPlan)));
    }
    function onPlan(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        if (outcome != ApiClient.DONE_OK || !(data instanceof Dictionary) || !(data["cat"] instanceof Array) || !(data["items"] instanceof Array)) {
            note("Plan fehlgeschlagen"); return;
        }
        store.setValue(PLAN, data as Application.Storage.ValueType);
        var saved = store.getValue(PLAN);
        if (saved instanceof Dictionary && saved["id"] instanceof String) {
            note("Plan gelesen + gespeichert");
            note("Katalog=" + (saved["cat"] as Array).size());
            note("Uebungen=" + (saved["items"] as Array).size());
            note("Nach Neustart: Status pruefen");
        } else { note("FEHLER: Storage read-back"); }
    }
    function freeze() as Void {
        fresh("3 Test-Training vorbereiten");
        if (!ready) { note("Schema blockiert"); return; }
        if (store.getValue(OUTBOX) != null) { note("Vorhandene Outbox erhalten"); status(); return; }
        var plan = store.getValue(PLAN);
        if (!(plan instanceof Dictionary)) { note("Erst Plan laden"); return; }
        var cat = plan["cat"] as Array;
        var items = plan["items"] as Array;
        if (cat.size() == 0 || items.size() == 0 || !(cat[0] instanceof Dictionary) || !(items[0] instanceof Dictionary)) {
            note("Plan unvollstaendig"); return;
        }
        var first = cat[0] as Dictionary;
        var item = items[0] as Dictionary;
        var now = Clock.nowUtcSeconds();
        var offset = Clock.utcOffsetMinutes();
        var body = {
            "request_id" => Uuid.v4(), "session_uuid" => Uuid.v4(),
            "plan_version_id" => plan["p"], "session_id" => plan["id"],
            "workout_date_local" => Clock.localDate(now, offset), "utc_offset_min" => offset,
            "started_at_utc" => Clock.isoUtc(now - 60), "ended_at_utc" => Clock.isoUtc(now),
            "exercises" => [{"plan_item_id" => item["id"], "exercise_id" => first["id"],
                "sets" => [{"reps" => 8, "load_g" => 20000, "side" => "both", "t0" => now - 60, "t1" => now - 30}]}]
        };
        store.setValue(OUTBOX, body as Application.Storage.ValueType);
        note("Outbox gespeichert");
        note("request_id=" + body["request_id"]);
        note("Nur Mock / keine FIT-Aktivitaet");
    }
    function send() as Void {
        fresh("4 Senden / Wiederholen");
        if (!canSend()) { return; }
        var body = store.getValue(OUTBOX);
        if (!(body instanceof Dictionary)) { note("Keine offene Outbox"); return; }
        note("request_id=" + body["request_id"]);
        if (uploadQueued) { client.kick(); return; }
        uploadQueued = true;
        client.enqueue(new ApiRequest(Communications.HTTP_REQUEST_METHOD_POST, "/workouts", body as Dictionary, method(:onUpload)));
    }
    function onUpload(code as Number, data as Dictionary or String or Null, outcome as Number) as Void {
        uploadQueued = outcome == ApiClient.WAITING;
        if (outcome == ApiClient.DONE_OK && data instanceof Dictionary && data["workout_id"] instanceof String && data["replayed"] instanceof Boolean) {
            store.deleteValue(OUTBOX);
            note("Bestaetigt / Outbox entfernt");
            note("replayed=" + (data["replayed"] as Boolean));
        } else { note("Nicht bestaetigt / Outbox bleibt"); }
    }
}

(:garminGate)
module DebugMenu {
    function build() as WatchUi.Menu2 {
        DebugState.get();
        var menu = new WatchUi.Menu2({:title => "Arnold TEST"});
        menu.addItem(new WatchUi.MenuItem("1 Mock koppeln", "Nur Testserver", :pair, null));
        menu.addItem(new WatchUi.MenuItem("2 Plan laden", "8KiB Fixture", :plan, null));
        menu.addItem(new WatchUi.MenuItem("3 Vorbereiten", "Test-Training speichern", :freeze, null));
        menu.addItem(new WatchUi.MenuItem("4 Senden", "Gleiche Anfrage wiederholen", :send, null));
        menu.addItem(new WatchUi.MenuItem("5 Status", "Speicher kontrollieren", :status, null));
        menu.addItem(new WatchUi.MenuItem("6 Arnold-App", "Echte Kopplung", :app, null));
        return menu;
    }
}
(:garminGate)
class DebugDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }
    function onSelect(item as WatchUi.MenuItem) as Void {
        var runner = DebugState.get();
        var id = item.getId();
        if (id == :app) {
            WatchUi.pushView(new PairingView(Session.pairing()), new PairingDelegate(Session.pairing()), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id == :pair) { runner.pair(); }
        else if (id == :plan) { runner.loadPlan(); }
        else if (id == :freeze) { runner.freeze(); }
        else if (id == :send) { runner.send(); }
        else if (id == :status) { runner.status(); }
        WatchUi.pushView(new DebugView(), new DebugViewDelegate(), WatchUi.SLIDE_LEFT);
    }
}
(:garminGate)
class DebugView extends WatchUi.View {
    var first as Number = 0;
    function initialize() { View.initialize(); }
    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var lines = DebugState.get().lines;
        var y = dc.getHeight() / 6;
        var height = dc.getFontHeight(Graphics.FONT_XTINY);
        for (var i = first; i < lines.size() && y < dc.getHeight() * 5 / 6; i++) {
            dc.drawText(dc.getWidth() / 2, y, Graphics.FONT_XTINY, lines[i], Graphics.TEXT_JUSTIFY_CENTER);
            y += height;
        }
    }
    function scroll(delta as Number) as Void {
        first += delta;
        var count = DebugState.get().lines.size();
        if (first >= count) { first = count > 0 ? count - 1 : 0; }
        if (first < 0) { first = 0; }
        WatchUi.requestUpdate();
    }
}
(:garminGate)
class DebugViewDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }
    function move(delta as Number) as Boolean {
        var view = WatchUi.getCurrentView()[0];
        if (view instanceof DebugView) { view.scroll(delta); }
        return true;
    }
    function onNextPage() as Boolean { return move(3); }
    function onPreviousPage() as Boolean { return move(-3); }
}
