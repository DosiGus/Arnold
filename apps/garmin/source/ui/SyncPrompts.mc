import Toybox.Lang;
import Toybox.WatchUi;

// The questions the sending can ask the user (UMSETZUNG 3.1, PRD S-04): the same
// workout is in the history already; unusual values; a workout that was never sent
// for 14 days. Each question is asked once per run of the app and entry.
module SyncPrompts {
    var asked as Dictionary = {};

    // Asks what the outbox needs answered. Called when a screen shows or the sending changes.
    function check(sender as OutboxSender) as Void {
        var outbox = sender.outbox();
        var ids = outbox.ids();
        for (var i = 0; i < ids.size(); i++) {
            var entry = outbox.get(ids[i]) as Dictionary;
            var status = entry["s"] as Number;
            var key = ids[i] + ":" + status.toString();
            if (asked.hasKey(key)) {
                continue;
            }
            if (status == Outbox.STATUS_DUPLICATE) {
                asked[key] = true;
                ask(Rez.Strings.PromptDuplicate, new SyncAnswerDelegate(sender, ids[i], SyncAnswerDelegate.KIND_DUPLICATE));
                return;
            }
            if (status == Outbox.STATUS_UNUSUAL) {
                asked[key] = true;
                ask(Rez.Strings.PromptUnusual, new SyncAnswerDelegate(sender, ids[i], SyncAnswerDelegate.KIND_UNUSUAL));
                return;
            }
        }
    }

    // A workout that waited 14 days without being sent: keep or discard.
    function checkStale(sender as OutboxSender, now as Number) as Void {
        var stale = sender.outbox().stale(now);
        for (var i = 0; i < stale.size(); i++) {
            var key = "stale:" + stale[i];
            if (asked.hasKey(key)) {
                continue;
            }
            asked[key] = true;
            ask(Rez.Strings.PromptStale, new SyncAnswerDelegate(sender, stale[i], SyncAnswerDelegate.KIND_STALE));
            return;
        }
    }

    function ask(message as ResourceId, delegate as SyncAnswerDelegate) as Void {
        WatchUi.pushView(new WatchUi.Confirmation(WatchUi.loadResource(message) as String), delegate, WatchUi.SLIDE_UP);
    }
}

class SyncAnswerDelegate extends WatchUi.ConfirmationDelegate {
    enum Kind {
        KIND_DUPLICATE,
        KIND_UNUSUAL,
        KIND_STALE
    }

    private var _sender as OutboxSender;
    private var _uuid as String;
    private var _kind as Number;

    function initialize(sender as OutboxSender, uuid as String, kind as Number) {
        ConfirmationDelegate.initialize();
        _sender = sender;
        _uuid = uuid;
        _kind = kind;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        answer(response == WatchUi.CONFIRM_YES);
        return true;
    }

    // yes: save anyway / the values are right / discard the old workout.
    function answer(yes as Boolean) as Void {
        if (_kind == KIND_DUPLICATE) {
            if (yes) {
                _sender.confirmDuplicate(_uuid);
            } else {
                _sender.discard(_uuid);
            }
        } else if (_kind == KIND_UNUSUAL) {
            if (yes) {
                _sender.confirmUnusual(_uuid);
            } else {
                _sender.backToSummary(_uuid);
            }
        } else if (yes) {
            _sender.discard(_uuid);
        } else {
            _sender.keep(_uuid);
        }
    }
}
