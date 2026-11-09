import Toybox.Application;
import Toybox.Lang;

// Runs one migration step of the storage schema. Version 1 is the first one,
// so there are no steps yet; a later version adds a case per step.
(:background)
class SchemaSteps {

    function initialize() {
    }

    // Moves stored data from version `from` to `from + 1`.
    function step(store as KeyValueStore, from as Number) as Void {
    }
}

// Version of the stored data and its migration. Fails closed: data from a newer
// app version or with an unreadable version is left untouched.
(:background)
module StoreSchema {
    const VERSION as Number = 1;

    enum Result {
        RESULT_FRESH,     // nothing stored yet, version written
        RESULT_CURRENT,   // already up to date
        RESULT_MIGRATED,  // older data moved up to the current version
        RESULT_NEWER,     // written by a newer app version, left untouched
        RESULT_INVALID    // version entry is not a number, left untouched
    }

    function migrate(store as KeyValueStore) as Result {
        return migrateTo(store, VERSION, new SchemaSteps());
    }

    // Writes the version after every step, so an interrupted migration resumes
    // at the step that did not finish.
    function migrateTo(store as KeyValueStore, target as Number, steps as SchemaSteps) as Result {
        var stored = store.getValue(StoreKeys.SCHEMA);
        if (stored == null) {
            store.setValue(StoreKeys.SCHEMA, target);
            return RESULT_FRESH;
        }
        if (!(stored instanceof Number)) {
            return RESULT_INVALID;
        }
        var version = stored as Number;
        if (version > target) {
            return RESULT_NEWER;
        }
        if (version == target) {
            return RESULT_CURRENT;
        }
        while (version < target) {
            steps.step(store, version);
            version++;
            store.setValue(StoreKeys.SCHEMA, version);
        }
        return RESULT_MIGRATED;
    }
}
