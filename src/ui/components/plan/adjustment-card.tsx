import { CalendarClock } from "lucide-react";
import { ArnoldCard, CardNote, CardSkeleton } from "../cards";
import {
  CardTag,
  ChangeList,
  ChangeRow,
  ConfirmAction,
  SayHint,
  StatusLines,
  UnderstoodRows,
} from "../conversation-cards";
import { RecoveryCard } from "../recovery";
import { formatShortDay } from "../../../shared/arnold-format";
import { planChangeRows } from "../../../shared/plan-change-rows";
import type { PlanAdjustmentView } from "../../../shared/plan-adjustment-contract";
import type { PlanAdjustmentState } from "../../hooks/usePlanAdjustment";

const Tag = () => (
  <CardTag icon={<CalendarClock size={13} />}>Anpassung auf Zeit</CardTag>
);

/** The card's title: what kind of time the user has. */
export function adjustmentTitle(view: PlanAdjustmentView): string {
  const { kind, reason } = view.adjustment;
  if (kind === "today") return "Heute kürzer";
  if (kind === "week") return "Diese Woche";
  if (kind === "month") return "Diesen Monat: Stand halten";
  return reason ?? "Für eine Weile";
}

/** "Nur heute, Mo. 17.11." or "Mo. 17.11. bis So. 23.11." */
export function adjustmentPeriodText(view: PlanAdjustmentView): string {
  const { start_date_local: start, end_date_local: end } = view.adjustment;
  return start === end
    ? `Nur heute, ${formatShortDay(start)}`
    : `${formatShortDay(start)} bis ${formatShortDay(end)}`;
}

/** The sentence every adjustment card ends with. */
export const backText = (view: PlanAdjustmentView) =>
  `Ab ${formatShortDay(view.normal_from)} gilt wieder dein normaler Plan.`;

function sessionValue(session: PlanAdjustmentView["sessions"][number]) {
  const n = session.exercises.length;
  const parts = [`${n} ${n === 1 ? "Übung" : "Übungen"}`];
  if (session.minutes !== null) parts.push(`ca. ${session.minutes} Min.`);
  return parts.join(" · ");
}

/**
 * The card "Anpassung auf Zeit": period, sessions, old → new and the way
 * back, with "Bestätigen" and "Absagen". It shows the state it is given and
 * computes nothing.
 */
export function PlanAdjustmentView({
  state,
  onConfirm,
  onCancel,
  onReload,
}: {
  state: PlanAdjustmentState;
  onConfirm: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  if (state.kind === "loading") return <CardSkeleton />;
  if (state.kind === "failed")
    return <RecoveryCard recovery="retry_same_request" onAction={onReload} />;
  if (state.kind === "none")
    return (
      <ArnoldCard label={<Tag />} title="Es gilt dein normaler Plan">
        <CardNote>Gerade ist keine Anpassung auf Zeit offen.</CardNote>
        <SayHint>Ich habe heute nur 20 Minuten</SayHint>
      </ArnoldCard>
    );

  const { view } = state;
  const status = view.adjustment.status;
  const busy = state.kind === "running";
  const rows = planChangeRows(view.changes);
  const details = (
    <>
      <UnderstoodRows
        label="Einheiten im Zeitraum"
        items={view.sessions.map((session) => ({
          key: session.session_id,
          label: session.session_name,
          value: sessionValue(session),
        }))}
      />
      {rows.length > 0 && (
        <ChangeList label="Das ändert sich">
          {rows.map((row) => (
            <ChangeRow
              key={row.key}
              label={row.label}
              before={row.before}
              after={row.after}
            />
          ))}
        </ChangeList>
      )}
      {view.runs_unchanged && (
        <CardNote>Deine geplanten Läufe bleiben, wie sie sind.</CardNote>
      )}
      {view.capped && (
        <CardNote>Länger als 56 Tage geht eine Anpassung nicht.</CardNote>
      )}
    </>
  );

  if (status === "cancelled")
    return (
      <ArnoldCard
        label={<Tag />}
        title={adjustmentTitle(view)}
        subtitle={adjustmentPeriodText(view)}
      >
        <ConfirmAction
          state="declined"
          label="Bestätigen"
          declinedText="Abgesagt. Es gilt wieder dein normaler Plan."
          onConfirm={onConfirm}
        />
      </ArnoldCard>
    );

  return (
    <ArnoldCard
      label={<Tag />}
      title={adjustmentTitle(view)}
      subtitle={adjustmentPeriodText(view)}
      busy={busy}
    >
      {details}
      <p className="cc-line" role="note">
        {backText(view)}
      </p>
      {status === "confirmed" ? (
        <>
          <StatusLines saved watch={state.watch ?? "unknown"} />
          <ConfirmAction
            state="confirmed"
            label="Bestätigen"
            confirmedText={
              view.running
                ? "Gilt jetzt"
                : `Gilt ab ${formatShortDay(view.adjustment.start_date_local)}`
            }
            onConfirm={onConfirm}
          />
          {state.canWrite && (
            <button className="ac-link" onClick={onCancel} disabled={busy}>
              Absagen
            </button>
          )}
          {state.kind === "error" && (
            <p className="cc-line warn" role="alert">
              Das hat nicht geklappt. Versuch es noch einmal.
            </p>
          )}
        </>
      ) : state.canWrite ? (
        <ConfirmAction
          state={state.kind === "error" ? "error" : busy ? "running" : "ready"}
          label="Bestätigen"
          declineLabel="Absagen"
          runningLabel="Wird gespeichert …"
          onConfirm={onConfirm}
          onDecline={onCancel}
        />
      ) : (
        <CardNote>Bestätigen ist in dieser Ansicht nicht möglich.</CardNote>
      )}
    </ArnoldCard>
  );
}
