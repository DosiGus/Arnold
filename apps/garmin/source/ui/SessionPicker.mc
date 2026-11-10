import Toybox.Lang;

// Which training day of the plan is selected on the start screen. The next day
// is selected first; UP and DOWN move through the days and wrap around. The
// selection stays on the same day when the plan is refreshed, as long as that
// day is still in the plan.
class SessionPicker {
    private var _selectedId as String or Null;

    function initialize() {
        _selectedId = null;
    }

    // Index of the selected day in the directory, or -1 without a directory.
    function selectedIndex(dir as Dictionary or Null) as Number {
        if (dir == null) {
            return -1;
        }
        var days = (dir as Dictionary)["days"] as Array;
        if (_selectedId != null) {
            var found = indexOf(days, _selectedId as String);
            if (found >= 0) {
                return found;
            }
        }
        var next = indexOf(days, (dir as Dictionary)["next"] as String);
        return next >= 0 ? next : 0;
    }

    // The selected day (an entry of the directory), or null.
    function selectedDay(dir as Dictionary or Null) as Dictionary or Null {
        var index = selectedIndex(dir);
        if (index < 0) {
            return null;
        }
        return ((dir as Dictionary)["days"] as Array)[index] as Dictionary;
    }

    function isNextDay(dir as Dictionary or Null) as Boolean {
        var day = selectedDay(dir);
        return day != null && ((day as Dictionary)["id"] as String).equals((dir as Dictionary)["next"] as String);
    }

    // delta = +1 for DOWN, -1 for UP.
    function move(dir as Dictionary or Null, delta as Number) as Void {
        var index = selectedIndex(dir);
        if (index < 0) {
            return;
        }
        var days = (dir as Dictionary)["days"] as Array;
        var count = days.size();
        var target = ((index + delta) % count + count) % count;
        _selectedId = (days[target] as Dictionary)["id"] as String;
    }

    hidden function indexOf(days as Array, id as String) as Number {
        for (var i = 0; i < days.size(); i++) {
            if (((days[i] as Dictionary)["id"] as String).equals(id)) {
                return i;
            }
        }
        return -1;
    }
}
