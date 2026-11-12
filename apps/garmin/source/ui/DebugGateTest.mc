import Toybox.Application;
import Toybox.Lang;
import Toybox.Test;
(:garminGate, :test)
function debugFreezeRetainsTheSameRequestAcrossRestart(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var runner = new DebugRunner(store);
    store.setValue(runner.PLAN, {"p" => "plan-synthetic", "id" => "day-synthetic",
        "cat" => [{"id" => "exercise-synthetic"}], "items" => [{"id" => "item-synthetic"}]});
    runner.freeze();
    var first = store.getValue(runner.OUTBOX) as Dictionary;
    var id = first["request_id"] as String;
    Test.assert(Uuid.isV4(id));
    runner.freeze();
    Test.assert((((store.getValue(runner.OUTBOX) as Dictionary)["request_id"]) as String).equals(id));
    var restarted = new DebugRunner(store);
    restarted.freeze();
    Test.assert((((store.getValue(runner.OUTBOX) as Dictionary)["request_id"]) as String).equals(id));
    return true;
}
(:garminGate, :test)
function debugOnlyDeletesOutboxAfterConfirmedUpload(logger as Logger) as Boolean {
    var store = new MemoryStore();
    var runner = new DebugRunner(store);
    store.setValue(runner.OUTBOX, {"request_id" => "synthetic-fixed"});
    runner.wire(-104);
    Test.assert(store.getValue(runner.OUTBOX) != null);
    runner.onUpload(-2, null, ApiClient.WAITING);
    Test.assert(runner.uploadQueued);
    Test.assert(store.getValue(runner.OUTBOX) != null);
    runner.onUpload(200, {"ok" => true}, ApiClient.DONE_OK);
    Test.assert(store.getValue(runner.OUTBOX) != null);
    runner.onUpload(200, {"workout_id" => "synthetic-workout", "replayed" => false}, ApiClient.DONE_OK);
    Test.assert(store.getValue(runner.OUTBOX) == null);
    Test.assert(!runner.uploadQueued);
    return true;
}
(:garminGate, :test)
function debugRespectsNewerStorageSchema(logger as Logger) as Boolean {
    var store = new MemoryStore();
    store.setValue(StoreKeys.SCHEMA, StoreSchema.VERSION + 1);
    var runner = new DebugRunner(store);
    Test.assert(!runner.ready);
    runner.freeze();
    Test.assert(store.getValue(runner.OUTBOX) == null);
    Test.assert((store.getValue(StoreKeys.SCHEMA) as Number) == (StoreSchema.VERSION + 1));
    return true;
}
