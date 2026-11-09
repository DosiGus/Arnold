import Toybox.Application;
import Toybox.Lang;

// Thin wrapper around Application.Storage, so tests can swap in memory.
(:background)
class KeyValueStore {

    function initialize() {
    }

    function getValue(key as String) as Application.Storage.ValueType {
        return Application.Storage.getValue(key);
    }

    function setValue(key as String, value as Application.Storage.ValueType) as Void {
        Application.Storage.setValue(key, value);
    }

    function deleteValue(key as String) as Void {
        Application.Storage.deleteValue(key);
    }
}
