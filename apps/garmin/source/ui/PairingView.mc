import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Shows the pairing state: how to connect, the code with the time left,
// the connected account, or why the watch is not connected (UMSETZUNG 7.2).
class PairingView extends WatchUi.View {
    private var _controller as PairingController;

    function initialize(controller as PairingController) {
        View.initialize();
        _controller = controller;
    }

    function onShow() as Void {
        _controller.setObserver(method(:onChanged));
    }

    function onHide() as Void {
        _controller.setObserver(null);
    }

    function onChanged() as Void {
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, PairingScreen.lines(dc, _controller));
    }
}

// What each state says. Texts come from the string resources (German or English).
module PairingScreen {
    const HINT_AFTER_SECONDS as Number = 12;   // asking for a code takes this long: hint at the phone

    function text(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }

    function lines(dc as Dc, controller as PairingController) as Array<PairingLine> {
        var white = Graphics.COLOR_WHITE;
        var gray = Graphics.COLOR_LT_GRAY;
        var alert = Graphics.COLOR_YELLOW;
        var out = [] as Array<PairingLine>;
        if (controller.state == PairingController.STATE_READY) {
            out.add(new PairingLine(text(Rez.Strings.PairConnected), Graphics.FONT_MEDIUM, white));
            out.add(new PairingLine(controller.accountLabel, Graphics.FONT_SMALL, gray));
            if (controller.isSigningOut()) {
                out.add(new PairingLine(text(Rez.Strings.PairSigningOut), Graphics.FONT_XTINY, gray));
            } else if (controller.notice == PairingController.NOTICE_SIGNOUT_FAILED) {
                out.add(new PairingLine(text(Rez.Strings.PairSignOutFailed), Graphics.FONT_XTINY, alert));
            } else {
                out.add(new PairingLine(text(Rez.Strings.PairMenuHint), Graphics.FONT_XTINY, gray));
            }
            return out;
        }
        if (controller.state == PairingController.STATE_PAIRING) {
            if (controller.phase == PairingController.PHASE_SHOWING) {
                var code = controller.userCode as String;
                out.add(new PairingLine(text(Rez.Strings.PairTellCode), Graphics.FONT_XTINY, gray));
                var fonts = [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY] as Array<Graphics.FontType>;
                out.add(new PairingLine(code, PairingLayout.fitFont(dc, code, PairingLayout.textWidth(dc), fonts), white));
                out.add(new PairingLine(Lang.format(text(Rez.Strings.PairTimeLeft), [minutesAndSeconds(controller.remainingSeconds())]), Graphics.FONT_SMALL, white));
                out.add(new PairingLine(text(Rez.Strings.PairBackCancel), Graphics.FONT_XTINY, gray));
            } else {
                out.add(new PairingLine(text(Rez.Strings.PairGetting), Graphics.FONT_SMALL, white));
                if (controller.waitedSeconds() >= HINT_AFTER_SECONDS) {
                    out.add(new PairingLine(text(Rez.Strings.PairPhone), Graphics.FONT_XTINY, alert));
                }
            }
            return out;
        }
        var notice = controller.notice;
        if (notice == PairingController.NOTICE_EXPIRED) {
            out.add(new PairingLine(text(Rez.Strings.PairExpired), Graphics.FONT_MEDIUM, alert));
            out.add(new PairingLine(text(Rez.Strings.PairNewCode), Graphics.FONT_SMALL, white));
        } else if (notice == PairingController.NOTICE_RECONNECT) {
            out.add(new PairingLine(text(Rez.Strings.PairReconnect), Graphics.FONT_MEDIUM, alert));
            out.add(new PairingLine(text(Rez.Strings.PairReconnectHint), Graphics.FONT_XTINY, gray));
            out.add(new PairingLine(text(Rez.Strings.PairStart), Graphics.FONT_SMALL, white));
        } else if (notice == PairingController.NOTICE_FAILED) {
            out.add(new PairingLine(text(Rez.Strings.PairNoConnection), Graphics.FONT_MEDIUM, alert));
            out.add(new PairingLine(text(Rez.Strings.PairPhone), Graphics.FONT_XTINY, gray));
            out.add(new PairingLine(text(Rez.Strings.PairRetry), Graphics.FONT_SMALL, white));
        } else if (notice == PairingController.NOTICE_UPGRADE) {
            out.add(new PairingLine(text(Rez.Strings.PairUpgrade), Graphics.FONT_MEDIUM, alert));
            out.add(new PairingLine(text(Rez.Strings.PairUpgradeHint), Graphics.FONT_XTINY, gray));
        } else if (notice == PairingController.NOTICE_STORAGE) {
            out.add(new PairingLine(text(Rez.Strings.PairStorage), Graphics.FONT_MEDIUM, alert));
            out.add(new PairingLine(text(Rez.Strings.PairUpgradeHint), Graphics.FONT_XTINY, gray));
        } else {
            out.add(new PairingLine(text(Rez.Strings.AppName), Graphics.FONT_MEDIUM, white));
            out.add(new PairingLine(text(Rez.Strings.PairIntro), Graphics.FONT_SMALL, gray));
            out.add(new PairingLine(text(Rez.Strings.PairStart), Graphics.FONT_SMALL, white));
        }
        return out;
    }

    // "9:41"
    function minutesAndSeconds(seconds as Number) as String {
        return (seconds / 60).toString() + ":" + (seconds % 60).format("%02d");
    }
}
