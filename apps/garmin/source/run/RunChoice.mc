import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// A short list the user chooses from on the run display: the pause menu, the questions (discard, skip, interrupted
// run), the run settings. One small view for all of them; the handler knows what each choice does.
class RunChoices {
    hidden var _nav as RunNav;

    function initialize(nav as RunNav) {
        _nav = nav;
    }

    function title() as String {
        return "";
    }

    // The choices as they read now (the settings change their words when switched).
    function labels() as Array<String> {
        return [] as Array<String>;
    }

    // The choice that is selected when the list opens.
    function first() as Number {
        return 0;
    }

    function onChoose(index as Number) as Void {
    }

    // BACK: by default the list closes and nothing else happens.
    function onCancel() as Void {
        _nav.pop();
    }
}

class RunChoiceView extends WatchUi.View {
    private var _choices as RunChoices;
    private var _selected as Number;

    function initialize(choices as RunChoices) {
        View.initialize();
        _choices = choices;
        _selected = choices.first();
    }

    function selected() as Number {
        return _selected;
    }

    // delta = +1 for DOWN, -1 for UP; wraps around.
    function move(delta as Number) as Void {
        var count = _choices.labels().size();
        if (count > 0) {
            _selected = ((_selected + delta) % count + count) % count;
        }
    }

    function onUpdate(dc as Dc) as Void {
        PairingLayout.draw(dc, RunChoiceView.lines(_choices, _selected));
    }

    // The question or title, then the choices: the selected one big and white, the others small and grey.
    static function lines(choices as RunChoices, selected as Number) as Array<PairingLine> {
        var out = [] as Array<PairingLine>;
        var title = choices.title();
        if (title.length() > 0) {
            out.add(new PairingLine(title, Graphics.FONT_TINY, Graphics.COLOR_ORANGE));
        }
        var labels = choices.labels();
        for (var i = 0; i < labels.size(); i++) {
            if (i == selected) {
                out.add(new PairingLine(labels[i], Graphics.FONT_MEDIUM, Graphics.COLOR_WHITE));
            } else {
                out.add(new PairingLine(labels[i], Graphics.FONT_SMALL, Graphics.COLOR_LT_GRAY));
            }
        }
        return out;
    }
}

class RunChoiceDelegate extends WatchUi.BehaviorDelegate {
    private var _choices as RunChoices;
    private var _view as RunChoiceView;

    function initialize(choices as RunChoices, view as RunChoiceView) {
        BehaviorDelegate.initialize();
        _choices = choices;
        _view = view;
    }

    function onNextPage() as Boolean {
        _view.move(1);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.move(-1);
        WatchUi.requestUpdate();
        return true;
    }

    function onSelect() as Boolean {
        _choices.onChoose(_view.selected());
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() as Boolean {
        _choices.onCancel();
        return true;
    }
}

// Where the run display goes next. The real one drives WatchUi; tests record the calls instead.
class RunNav {
    function initialize() {
    }

    // Closes the view on top.
    function pop() as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }

    function openChoices(choices as RunChoices) as Void {
        var view = new RunChoiceView(choices);
        WatchUi.pushView(view, new RunChoiceDelegate(choices, view), WatchUi.SLIDE_UP);
    }

    // After SAVE: the run display gives way to the next step of the end (distance, effort, summary; RUN-018).
    function show(flow as RunEndFlow) as Void {
        WatchUi.switchToView(new RunEndView(flow), new RunEndDelegate(flow, self), WatchUi.SLIDE_IMMEDIATE);
    }

    // Closes the view on top and what was opened before the run display (the pre-start screen), back to the start screen.
    function leave(afterPreStart as Boolean) as Void {
        pop();
        if (afterPreStart) {
            pop();
        }
    }
}
