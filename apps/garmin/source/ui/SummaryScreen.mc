import Toybox.Graphics;
import Toybox.Lang;

// The end of a workout (PRD 4.4): the summary with START to save; then the status
// of the sending; then the second page with the server's answer (new records and
// the suggestion for next time). All figures come from the journal and the server;
// nothing is calculated here beyond counting.
module SummaryScreen {
    const MAX_ANSWER_LINES as Number = 3;

    function lines(dc as Dc, session as TrainingSession, sender as OutboxSender or Null) as Array<PairingLine> {
        var phase = sender == null ? OutboxSender.PHASE_NONE : (sender as OutboxSender).phaseOf(session.uuid);
        var white = Graphics.COLOR_WHITE;
        var gray = Graphics.COLOR_LT_GRAY;
        var alert = Graphics.COLOR_YELLOW;
        var out = [] as Array<PairingLine>;
        if (phase == OutboxSender.PHASE_SENT) {
            return sentLines((sender as OutboxSender).lastResult);
        }
        if (phase == OutboxSender.PHASE_REJECTED) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumRejected), Graphics.FONT_MEDIUM, alert));
            var reason = (sender as OutboxSender).errorTextOf(session.uuid);
            if (reason != null) {
                out.add(new PairingLine(reason as String, Graphics.FONT_XTINY, gray));
            }
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumRetryHint), Graphics.FONT_XTINY, white));
            return out;
        }
        if (phase == OutboxSender.PHASE_ASKING) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumAsking), Graphics.FONT_MEDIUM, alert));
            return out;
        }
        if (phase == OutboxSender.PHASE_QUEUED || phase == OutboxSender.PHASE_SENDING) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumSaved), Graphics.FONT_MEDIUM, white));
            var sending = phase == OutboxSender.PHASE_SENDING && !phoneMissing(sender);
            out.add(new PairingLine(TrainingText.text(sending ? Rez.Strings.SumSending : Rez.Strings.SumWaiting), Graphics.FONT_XTINY, gray));
            return out;
        }
        if (session.setsDone() == 0) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumNothing), Graphics.FONT_MEDIUM, white));
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumDiscardHint), Graphics.FONT_XTINY, gray));
            return out;
        }
        out.add(new PairingLine(TrainingText.text(Rez.Strings.TrFinished), Graphics.FONT_MEDIUM, white));
        out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.HomeMinutes), [session.elapsedSeconds() / 60]), Graphics.FONT_SMALL, white));
        out.add(new PairingLine(Lang.format(TrainingText.text(Rez.Strings.SumSets), [session.setsDone(), session.plan.setCount()]), Graphics.FONT_XTINY, gray));
        var trained = session.exercisesTrained();
        out.add(new PairingLine(Lang.format(TrainingText.text(trained == 1 ? Rez.Strings.HomeExerciseOne : Rez.Strings.HomeExercises), [trained]), Graphics.FONT_XTINY, gray));
        out.add(new PairingLine(TrainingText.text(Rez.Strings.SumSave), Graphics.FONT_XTINY, white));
        return out;
    }

    // "All sent", the records and the suggestion for next time (at most three lines each).
    function sentLines(result as Dictionary or Null) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        out.add(new PairingLine(TrainingText.text(Rez.Strings.SumSent), Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
        if (result == null) {
            return out;
        }
        var records = (result as Dictionary)["records"] as Array;
        if (records.size() > 0) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumRecords), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW));
            for (var i = 0; i < records.size() && i < MAX_ANSWER_LINES; i++) {
                if (records[i] instanceof String) {
                    out.add(new PairingLine(records[i] as String, Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
                }
            }
        }
        var next = (result as Dictionary)["next"] as Array;
        if (next.size() > 0) {
            out.add(new PairingLine(TrainingText.text(Rez.Strings.SumNext), Graphics.FONT_XTINY, Graphics.COLOR_YELLOW));
            for (var j = 0; j < next.size() && j < MAX_ANSWER_LINES; j++) {
                if (next[j] instanceof Dictionary && (next[j] as Dictionary)["message"] instanceof String) {
                    out.add(new PairingLine((next[j] as Dictionary)["message"] as String, Graphics.FONT_XTINY, Graphics.COLOR_WHITE));
                }
            }
        }
        return out;
    }

    function phoneMissing(sender as OutboxSender or Null) as Boolean {
        return sender != null && (sender as OutboxSender).isPhoneMissing();
    }
}
