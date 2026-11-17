import { TriangleAlert } from "lucide-react";
import { ArnoldCard, CardNote, CardSkeleton } from "../cards";
import {
  CardTag,
  ChangeList,
  ChangeRow,
  ConfirmAction,
  SayHint,
  StatusLines,
} from "../conversation-cards";
import { RecoveryCard } from "../recovery";
import type { PlanChangeState } from "../../hooks/usePlanChange";

/**
 * The plan change card: only what differs between the active plan and the
 * open draft, one main button, and the way out into the big editor. It shows
 * the state it is given and computes nothing.
 */
export function PlanChangeView({
  state,
  onApply,
  onDecline,
  onReload,
  onOpenEditor,
}: {
  state: PlanChangeState;
  onApply: () => void;
  onDecline: () => void;
  onReload: () => void;
  onOpenEditor: () => void;
}) {
  if (state.kind === "loading") return <CardSkeleton />;
  if (state.kind === "failed")
    return <RecoveryCard recovery="retry_same_request" onAction={onReload} />;
  if (state.kind === "none")
    return (
      <ArnoldCard
        label={<CardTag>Planänderung</CardTag>}
        title={
          state.reason === "no_active"
            ? "Es gibt noch keinen aktiven Plan"
            : "Keine Änderung zu bestätigen"
        }
      >
        <CardNote>
          {state.reason === "no_difference"
            ? "Der offene Entwurf unterscheidet sich nicht von deinem Plan."
            : "Dein Plan ist, wie er ist. Es wartet kein Entwurf auf dich."}
        </CardNote>
        <SayHint>Ich möchte meinen Plan ändern</SayHint>
      </ArnoldCard>
    );

  const draftName = `„${state.draft.name}“, Version ${state.draft.version_no}`;
  if (state.kind === "confirmed")
    return (
      <ArnoldCard
        label={<CardTag>Plan übernommen</CardTag>}
        title={state.draft.name}
        subtitle={`Version ${state.draft.version_no} gilt ab jetzt.`}
      >
        <StatusLines saved watch={state.watch ?? "unknown"} />
        <ConfirmAction
          state="confirmed"
          label="Übernehmen"
          confirmedText="Plan übernommen"
          onConfirm={onApply}
        />
      </ArnoldCard>
    );
  if (state.kind === "declined")
    return (
      <ArnoldCard
        label={<CardTag>Planänderung</CardTag>}
        title="Nicht übernommen"
      >
        <ConfirmAction
          state="declined"
          label="Übernehmen"
          declinedText="Der Entwurf ist verworfen. Dein Plan bleibt, wie er ist."
          onConfirm={onApply}
        />
        <SayHint>Ich möchte meinen Plan ändern</SayHint>
      </ArnoldCard>
    );

  const busy = state.kind === "running";
  return (
    <ArnoldCard
      label={<CardTag>Änderung</CardTag>}
      title="Das ändert sich"
      subtitle={`Entwurf ${draftName}`}
      busy={busy}
    >
      {state.openDrafts > 1 && (
        <CardNote>
          Du hast {state.openDrafts} offene Entwürfe. Gemeint ist der neueste:{" "}
          {draftName}.
        </CardNote>
      )}
      {state.kind === "stale" && (
        <p className="cc-line warn" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          Der Entwurf wurde inzwischen geändert. Hier ist der aktuelle
          Unterschied; übernommen ist noch nichts.
        </p>
      )}
      <ChangeList label="Änderungen am Plan">
        {state.rows.map((row) => (
          <ChangeRow
            key={row.key}
            label={row.label}
            before={row.before}
            after={row.after}
          />
        ))}
      </ChangeList>
      {state.canWrite ? (
        <ConfirmAction
          state={state.kind === "error" ? "error" : busy ? "running" : "ready"}
          label="Übernehmen"
          declineLabel="Nicht übernehmen"
          runningLabel="Wird übernommen …"
          onConfirm={onApply}
          onDecline={onDecline}
        />
      ) : (
        <CardNote>Übernehmen ist in dieser Ansicht nicht möglich.</CardNote>
      )}
      <button className="ac-link" onClick={onOpenEditor} disabled={busy}>
        Im Editor öffnen
      </button>
    </ArnoldCard>
  );
}
