import Toybox.Lang;

// The one connection of the app to Arnold: storage, API client and pairing,
// created the first time the screen needs them. The storage schema is checked
// first; data of a newer app version is left alone and pairing stays blocked.
module Session {
    var _client as ApiClient or Null = null;
    var _controller as PairingController or Null = null;
    var _plan as PlanSync or Null = null;

    function client() as ApiClient {
        if (_client == null) {
            var client = new ApiClient(AuthConfig.baseUrl(), new Transport(), new Scheduler());
            client.setClientInfo(Capabilities.partNumber(), Capabilities.languageCode());
            _client = client;
        }
        return _client as ApiClient;
    }

    function pairing() as PairingController {
        if (_controller == null) {
            var store = new KeyValueStore();
            var schema = StoreSchema.migrate(store);
            var blocked = schema == StoreSchema.RESULT_NEWER || schema == StoreSchema.RESULT_INVALID;
            var part = Capabilities.partNumber();
            _controller = new PairingController(
                client(), new AuthStore(store), new Scheduler(), new PairingClock(),
                DeviceNames.label(part), part, blocked
            );
        }
        return _controller as PairingController;
    }

    // The plan on the watch and its loader. Signing out (or connecting again)
    // wipes the stored plan, so no plan outlives the account it belongs to.
    function planSync() as PlanSync {
        if (_plan == null) {
            var cache = new PlanCache(new KeyValueStore());
            var sync = new PlanSync(client(), cache, new PairingClock(), pairing().method(:onAuthRejected));
            pairing().setWipeHook(cache.method(:clear));
            sync.setMobilityMark(mobilitySync().method(:ackMark));
            _plan = sync;
        }
        return _plan as PlanSync;
    }

    var _runs as RunSync or Null = null;

    // The planned runs on the watch and their loader (RUN-012).
    function runSync() as RunSync {
        if (_runs == null) {
            _runs = new RunSync(client(), new RunCache(new KeyValueStore()), new PairingClock(), pairing().method(:onAuthRejected));
        }
        return _runs as RunSync;
    }

    var _mobility as MobilitySync or Null = null;

    // The mobility routines on the watch and their loader (MOB-008).
    function mobilitySync() as MobilitySync {
        if (_mobility == null) {
            _mobility = new MobilitySync(client(), new MobilityCache(new KeyValueStore()), new PairingClock(), pairing().method(:onAuthRejected));
        }
        return _mobility as MobilitySync;
    }

    var _mobilitySender as MobilitySender or Null = null;

    // Sends the finished mobility routines (MOB-010).
    function mobilitySender() as MobilitySender {
        if (_mobilitySender == null) {
            _mobilitySender = new MobilitySender(client(), new MobilityOutbox(new KeyValueStore()), mobilitySync().cache, new PairingClock(), pairing().method(:onAuthRejected));
        }
        return _mobilitySender as MobilitySender;
    }

    var _runSender as RunSender or Null = null;

    // Sends the finished runs (RUN-018); the heart rate series of a run follows through the health sender of the launcher.
    function runSender() as RunSender {
        if (_runSender == null) {
            var store = new KeyValueStore();
            var sender = new RunSender(client(), new RunOutbox(store), new RunJournal(store), new PairingClock(), pairing().method(:onAuthRejected));
            sender.setHealth(launcher().sender().health());
            _runSender = sender;
        }
        return _runSender as RunSender;
    }

    var _launcher as TrainingLauncher or Null = null;

    // Starts and continues workouts.
    function launcher() as TrainingLauncher {
        if (_launcher == null) {
            var store = new KeyValueStore();
            var journal = new Journal(store);
            var clock = new PairingClock();
            var outbox = new Outbox(store);
            var sender = new OutboxSender(client(), outbox, journal, clock, pairing().method(:onAuthRejected));
            var consent = new HealthConsent(store);
            var healthOutbox = new HealthOutbox(store);
            sender.setHealth(new HealthSender(client(), healthOutbox, outbox, consent, clock, pairing().method(:onAuthRejected)));
            var wipe = new AccountWipe(planSync().cache, runSync().cache, consent, healthOutbox);
            wipe.setMobility(mobilitySync().cache);
            wipe.setMobilityOutbox(mobilitySender().outbox(), new MobilityJournal(store));
            pairing().setWipeHook(wipe.method(:wipe));
            _launcher = new TrainingLauncher(journal, clock, new Signals(store), sender);
        }
        return _launcher as TrainingLauncher;
    }
}

// Signing out (or connecting again): the plan, the planned runs, the consent and the health values of
// the old account do not stay on the watch.
class AccountWipe {
    private var _plan as PlanCache;
    private var _runs as RunCache;
    private var _consent as HealthConsent;
    private var _health as HealthOutbox;
    private var _mobility as MobilityCache or Null;
    private var _mobOutbox as MobilityOutbox or Null;
    private var _mobJournal as MobilityJournal or Null;

    function initialize(plan as PlanCache, runs as RunCache, consent as HealthConsent, health as HealthOutbox) {
        _plan = plan;
        _runs = runs;
        _consent = consent;
        _health = health;
        _mobility = null;
        _mobOutbox = null;
        _mobJournal = null;
    }

    // MOB-008: the mobility routines of the old account go too.
    function setMobility(cache as MobilityCache) as Void {
        _mobility = cache;
    }

    // MOB-010: so do the results that were waiting to be sent and the routine in progress.
    function setMobilityOutbox(outbox as MobilityOutbox, journal as MobilityJournal) as Void {
        _mobOutbox = outbox;
        _mobJournal = journal;
    }

    function wipe() as Void {
        if (_mobility != null) {
            (_mobility as MobilityCache).clear();
        }
        if (_mobOutbox != null && _mobJournal != null) {
            MobilityHandover.wipe(_mobOutbox as MobilityOutbox, _mobJournal as MobilityJournal);
        }
        _plan.clear();
        _runs.clear();
        _consent.clear();
        _health.clear();
    }
}
