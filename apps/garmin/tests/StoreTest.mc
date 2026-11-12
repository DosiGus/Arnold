import Toybox.Lang;
import Toybox.Test;

(:test)
function storeKeysFollowTheSchema(logger as Logger) as Boolean {
    var id = "3b241101-e2bb-4255-8caf-4136c566a962";
    Expect.equal(StoreKeys.SCHEMA, "schema");
    Expect.equal(StoreKeys.AUTH, "auth");
    Expect.equal(StoreKeys.PLAN, "plan");
    Expect.equal(StoreKeys.planDay("s_1"), "plan:day:s_1");
    Expect.equal(StoreKeys.sessionHead(id), "sess:" + id + ":head");
    Expect.equal(StoreKeys.sessionEvent(id, 7), "sess:" + id + ":7");
    Expect.equal(StoreKeys.outbox("r1"), "out:r1");
    Expect.equal(StoreKeys.heartRateBlock(id, 0), "hr:" + id + ":0");
    return true;
}

(:test)
function schemaFreshInstallWritesVersion(logger as Logger) as Boolean {
    var store = new MemoryStore();
    Expect.equal(StoreSchema.migrate(store), StoreSchema.RESULT_FRESH);
    Expect.equal(store.getValue(StoreKeys.SCHEMA), StoreSchema.VERSION);
    Expect.equal(StoreSchema.migrate(store), StoreSchema.RESULT_CURRENT);
    return true;
}

(:test)
function schemaMigratesStepByStep(logger as Logger) as Boolean {
    var store = new MemoryStore();
    store.setValue(StoreKeys.SCHEMA, 1);
    var steps = new RecordingSteps(-1);
    Expect.equal(StoreSchema.migrateTo(store, 3, steps), StoreSchema.RESULT_MIGRATED);
    Expect.equal(steps.ran.size(), 2);
    Expect.equal(steps.ran[0], 1);
    Expect.equal(steps.ran[1], 2);
    Expect.equal(store.getValue(StoreKeys.SCHEMA), 3);
    return true;
}

(:test)
function schemaResumesAfterAnInterruptedStep(logger as Logger) as Boolean {
    var store = new MemoryStore();
    store.setValue(StoreKeys.SCHEMA, 1);
    try {
        StoreSchema.migrateTo(store, 3, new RecordingSteps(2));
        Test.assert(false);
    } catch (e instanceof StepFailed) {
        // expected
    }
    Expect.equal(store.getValue(StoreKeys.SCHEMA), 2);
    var steps = new RecordingSteps(-1);
    Expect.equal(StoreSchema.migrateTo(store, 3, steps), StoreSchema.RESULT_MIGRATED);
    Expect.equal(steps.ran.size(), 1);
    Expect.equal(steps.ran[0], 2);
    return true;
}

(:test)
function schemaLeavesNewerOrUnreadableDataAlone(logger as Logger) as Boolean {
    var store = new MemoryStore();
    store.setValue(StoreKeys.SCHEMA, StoreSchema.VERSION + 1);
    store.setValue(StoreKeys.AUTH, "kept");
    Expect.equal(StoreSchema.migrate(store), StoreSchema.RESULT_NEWER);
    Expect.equal(store.getValue(StoreKeys.SCHEMA), StoreSchema.VERSION + 1);
    Expect.equal(store.getValue(StoreKeys.AUTH), "kept");
    store.setValue(StoreKeys.SCHEMA, "1");
    Expect.equal(StoreSchema.migrate(store), StoreSchema.RESULT_INVALID);
    Expect.equal(store.getValue(StoreKeys.SCHEMA), "1");
    return true;
}
