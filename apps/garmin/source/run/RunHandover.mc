import Toybox.Lang;

// Whether the heart rate of the run may go to Arnold: what the server said last with the list of planned runs, else
// what the health path knows. Unknown counts as "no" (fail closed).
module RunConsent {
    function isOn(store as KeyValueStore) as Boolean {
        var said = new RunCache(store).healthConsent();
        if (said != null) {
            return said as Boolean;
        }
        return new HealthConsent(store).isOn();
    }
}

// Where a saved run goes on its way to Arnold (RUN-018): its result is built once from the run, frozen in the run outbox
// and sent. Done after the effort was asked for, and also when the app opens and finds a run that was saved but never
// reached the outbox (the watch stopped in between). The result carries the uuid of the run and a request_id made from
// it, so however often this runs, Arnold gets exactly one run.
module RunHandover {
    // Builds and queues the result of `session`. False when nothing was queued (it was queued before).
    function queue(session as RunSession, sender as RunSender, parts as RunParts, consent as Boolean) as Boolean {
        if (sender.outbox().contains(session.uuid)) {
            sender.sendAll();
            return false;
        }
        sender.enqueue(session.uuid, RunUpload.build(session, consent, parts.zones, parts.clock.utcOffsetMinutes()));
        return true;
    }

    // The app opens: a saved run that never reached the outbox is queued now; whatever waits is sent.
    function recover(sender as RunSender, parts as RunParts, consent as Boolean) as Boolean {
        var session = RunSession.reopenSaved(parts);
        var queued = false;
        if (session != null) {
            queued = queue(session as RunSession, sender, parts, consent);
        }
        sender.sendAll();
        return queued;
    }
}
