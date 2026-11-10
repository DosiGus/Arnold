import Toybox.Attention;
import Toybox.Lang;
import Toybox.System;
module StudioProbe {
    function signal() as Void {
        Log.start("12 Vibration / Ton");
        if (Attention has :vibrate) { Attention.vibrate([new Attention.VibeProfile(100, 500)]); Log.line("Vibration 500ms"); }
        if (Attention has :playTone) { Attention.playTone(Attention.TONE_SUCCESS); Log.line("Ton success"); }
        Log.line("Im Studio Owner bewerten");
    }
    function battery() as Void {
        Log.start("17 Akku");
        Log.line("Akku=" + System.getSystemStats().battery + "%");
        Log.line("Zeit=" + System.getTimer() + "ms");
        Log.line("Vor/nach 60min notieren");
    }
}
