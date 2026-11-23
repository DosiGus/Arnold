import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

// The 30-minute mobility routine with 15 exercises (MOB-009), moved here from MobilityPlayerTest.mc: run in the memory
// build, alone with the app, against the same limits as the three hours of a run (ThreeHours).
(:test)
class MobMemRig {
    var clock as FakeClock;
    var player as MobilityPlayer;
    var outbox as MobilityOutbox;

    function initialize(count as Number, seconds as Number) {
        clock = new FakeClock();
        clock.now = 1700000000;
        var store = new MemoryStore();
        var all = [] as Array;
        for (var i = 0; i < count; i++) {
            all.add({ "c" => "mob_cat_cow", "n" => "Übung " + i, "h" => "Ruhig atmen", "s" => 2, "t" => seconds, "r" => null });
        }
        var routine = { "id" => "s_1", "p" => "pv_1", "tot" => 600, "ex" => all };
        outbox = new MobilityOutbox(store);
        player = new MobilityPlayer("s_1", "session", routine, clock, new MobilitySignals(new QuietSignals(), new Settings(store)), new Recorder("u1", new QuietBackend()));
        player.connect(new MobilityJournal(store), outbox, null);
        player.begin();
    }

    function go(seconds as Number) as Void {
        for (var i = 0; i < seconds; i++) {
            clock.now++;
            player.tick();
        }
    }
}

(:test)
function aThirtyMinuteRoutineLeavesNothingBehindAndRedrawsAreFree(logger as Logger) as Boolean {
    var dc = displayDc();
    var baseline = System.getSystemStats().usedMemory;
    var rig = new MobMemRig(15, 60);   // 15 exercises, two sides of a minute: 30 minutes of movement
    var view = new MobilityView(rig.player);
    var peak = 0;
    for (var s = 0; s < 1800 + 15 * 8 + 1; s++) {
        rig.go(1);
        if (s % 100 == 99) {
            view.onUpdate(dc);
            peak = System.getSystemStats().usedMemory > peak ? System.getSystemStats().usedMemory : peak;
        }
    }
    Test.assert(rig.player.phase == MobilityPlayer.PH_END);
    Test.assertEqual(rig.player.countOf("done"), 15);
    Test.assert(rig.player.save());
    var limit = ThreeHours.LIMIT;
    logger.debug("30 min: peak " + peak + " of " + limit + " (before " + baseline + ")");
    Test.assertMessage(peak - baseline < limit * 6 / 100, "grew by " + (peak - baseline));
    Test.assertMessage(peak * 100 / limit < ThreeHours.PEAK_PERCENT, "peak " + peak);
    // 300 redraws while the routine would run: the memory stays flat
    var again = new MobMemRig(1, 600);
    var live = new MobilityView(again.player);
    for (var warm = 0; warm < 5; warm++) {
        live.onUpdate(dc);
    }
    var before = System.getSystemStats().usedMemory;
    for (var i = 0; i < 300; i++) {
        again.go(1);
        live.onUpdate(dc);
    }
    var after = System.getSystemStats().usedMemory;
    Test.assertMessage(after - before < 600, "memory grew by " + (after - before));
    return true;
}

// A bitmap of the real display size of the device the test runs on.
(:test)
function displayDc() as Dc {
    var settings = System.getDeviceSettings();
    var bitmap = Graphics.createBufferedBitmap({ :width => settings.screenWidth, :height => settings.screenHeight }).get() as BufferedBitmap;
    return bitmap.getDc();
}
