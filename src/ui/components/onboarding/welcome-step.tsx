import { useId } from "react";
import { ChevronRight, FileText, Sparkles } from "lucide-react";
import type { OnboardingPath } from "../../../shared/onboarding-contract";
import { CardNote } from "../cards";

export function WelcomeStep({
  onChoose,
  busy,
  canWritePlan,
}: {
  onChoose: (path: OnboardingPath) => void;
  busy: boolean;
  canWritePlan: boolean;
}) {
  const disabled = busy || !canWritePlan;
  const ids = useId();
  return (
    <section className="ac" aria-label="Willkommen bei Arnold">
      <div>
        <h2 className="ac-title">Willkommen bei Arnold</h2>
        <p className="ac-sub">
          Dein Trainingsbegleiter im Chat: ein Plan, schnelle Satzeingabe und
          dein Fortschritt an einem Ort. Wie möchtest du starten?
        </p>
      </div>
      {!canWritePlan && (
        <CardNote>
          Hier kannst du die Einrichtung ansehen. Ein Plan kann in dieser
          Verbindung noch nicht gespeichert werden.
        </CardNote>
      )}
      <div className="ac-paths">
        <button
          type="button"
          className="ac-btn ac-path primary-path"
          disabled={disabled}
          aria-label="Plan mit Arnold erstellen"
          aria-describedby={`${ids}-arnold`}
          onClick={() => onChoose("arnold_plan")}
        >
          <span className="ac-path-icon">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <span className="ac-path-text">
            <strong>Plan mit Arnold erstellen</strong>
            <span id={`${ids}-arnold`}>
              4 kurze Fragen und deine Wünsche, etwa 2 Minuten
            </span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ac-btn ac-path"
          disabled={disabled}
          aria-label="Eigenen Plan übernehmen"
          aria-describedby={`${ids}-own`}
          onClick={() => onChoose("own_plan")}
        >
          <span className="ac-path-icon muted">
            <FileText size={20} aria-hidden="true" />
          </span>
          <span className="ac-path-text">
            <strong>Eigenen Plan übernehmen</strong>
            <span id={`${ids}-own`}>Als Text oder Foto in den Chat</span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
