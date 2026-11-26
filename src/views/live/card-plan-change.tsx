/**
 * The two cards that wait for the user's yes. "Übernehmen" confirms exactly
 * the draft revision on screen, "Bestätigen" exactly the adjustment shown;
 * one edited in the meantime is loaded again, never confirmed unseen.
 * Nothing takes effect without the click.
 */
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useRef, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  PlanAdjustmentListSchema,
  PlanAdjustmentWriteResponseSchema,
} from "../../shared/plan-adjustment-contract.js";
import {
  PlanContextSchema,
  PlanVersionComparisonSchema,
  PlanWriteResponseSchema,
} from "../../shared/plan-contract.js";
import type { WatchDelivery } from "../../shared/watch-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import {
  adjustmentInput,
  adjustmentModel,
  applyPlanInput,
  declinePlanInput,
  pickAdjustment,
  planChangeCandidate,
  planChangeModel,
  STALE_CODES,
  watchLine,
  type PlanChangeModel,
} from "../model/plan-change.js";
import {
  Actions,
  Box,
  Card,
  ChangeRows,
  Loading,
  LoadError,
  Note,
  Rows,
  useCardWrite,
  useLoad,
  WriteAlert,
} from "./card-kit.js";

type Props = {
  onBack: () => void;
  onAsk: (sentence: string) => void;
  /** After a write: the overview reads the new state. */
  onChanged: () => void;
};

type ChangeState =
  | { kind: "none"; reason: "no_active" | "no_draft" | "no_difference" }
  | { kind: "change"; model: PlanChangeModel };

export function PlanChangeCard({ onBack, onAsk, onChanged }: Props) {
  const context = useArnoldTool("get_plan_editor_context", PlanContextSchema);
  const compare = useArnoldTool(
    "compare_plan_versions",
    PlanVersionComparisonSchema,
  );
  const load = useLoad<ChangeState>(async () => {
    const ctx = await context.call();
    const candidate = planChangeCandidate(ctx);
    if (candidate.kind === "none") return candidate;
    const comparison = await compare.call({
      from_plan_version_id: candidate.from,
      to_plan_version_id: candidate.draft.plan_version_id,
    });
    const model = planChangeModel(ctx, comparison);
    return model
      ? { kind: "change", model }
      : { kind: "none", reason: "no_difference" };
  });
  const apply = useCardWrite("activate_training_plan", PlanWriteResponseSchema);
  const decline = useCardWrite("archive_plan_draft", PlanWriteResponseSchema);
  const [done, setDone] = useState<{
    kind: "applied" | "declined";
    model: PlanChangeModel;
    watch?: WatchDelivery;
  } | null>(null);
  const [stale, setStale] = useState(false);
  const title = "Planänderung";

  const send = async (kind: "applied" | "declined", model: PlanChangeModel) => {
    const write = kind === "applied" ? apply : decline;
    const input = kind === "applied" ? applyPlanInput : declinePlanInput;
    (kind === "applied" ? decline : apply).clear();
    const answer = await write.send(
      [kind, model.planVersionId, model.rowRevision],
      (id) => input(model, id),
      (failure) => {
        if (!STALE_CODES.includes(failure.code)) return;
        write.clear();
        setStale(true);
        void load.reload();
      },
    );
    if (!answer?.ok) return;
    setDone({ kind, model, watch: answer.watch_delivery });
    onChanged();
  };

  if (done) {
    const line = watchLine(done.watch);
    return (
      <DataLLM
        content={
          done.kind === "applied"
            ? `Plan-Änderungskarte: „${done.model.name}“ wurde vom Nutzer übernommen und gilt jetzt.`
            : "Plan-Änderungskarte: Der Nutzer hat den Entwurf nicht übernommen; der Plan bleibt."
        }
      >
        <Card title={title} onBack={onBack}>
          <Alert
            color={done.kind === "applied" ? "success" : "info"}
            variant="soft"
            title={
              done.kind === "applied"
                ? `„${done.model.name}“ gilt ab jetzt.`
                : "Der Entwurf ist verworfen. Dein Plan bleibt, wie er ist."
            }
            description={
              done.kind === "applied" ? (line ?? undefined) : undefined
            }
          />
        </Card>
      </DataLLM>
    );
  }
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  if (load.data.kind === "none")
    return (
      <DataLLM content="Plan-Änderungskarte: Es wartet keine Änderung auf eine Bestätigung.">
        <Card title={title} onBack={onBack}>
          <Box>
            <p className="m-0 font-medium">
              {load.data.reason === "no_active"
                ? "Es gibt noch keinen aktiven Plan."
                : "Keine Änderung zu bestätigen."}
            </p>
            <Note>
              {load.data.reason === "no_difference"
                ? "Der offene Entwurf unterscheidet sich nicht von deinem Plan."
                : "Es wartet kein Entwurf auf dich."}
            </Note>
          </Box>
          <Button
            color="secondary"
            variant="soft"
            size="lg"
            block
            onClick={() => onAsk("Ich möchte meinen Plan ändern.")}
          >
            Plan ändern
          </Button>
        </Card>
      </DataLLM>
    );
  const model = load.data.model;
  return (
    <DataLLM
      content={`Plan-Änderungskarte: ${model.rows.length} Änderungen im Entwurf „${model.name}“. Nur der Klick des Nutzers auf „Übernehmen“ aktiviert ihn.`}
    >
      <Card
        title={title}
        subtitle={`Entwurf „${model.name}“, Version ${model.versionNo}`}
        onBack={onBack}
      >
        {model.openDrafts > 1 && (
          <Note>
            Du hast {model.openDrafts} offene Entwürfe. Gemeint ist der neueste.
          </Note>
        )}
        {stale && (
          <Alert
            color="warning"
            variant="soft"
            title="Der Entwurf wurde inzwischen geändert."
            description="Hier ist der aktuelle Unterschied; übernommen ist noch nichts."
          />
        )}
        <Box>
          <ChangeRows rows={model.rows} />
        </Box>
        <WriteAlert error={apply.error ?? decline.error} />
        {model.canWrite ? (
          <Actions
            label="Übernehmen"
            loading={apply.pending}
            disabled={decline.pending}
            onClick={() => void send("applied", model)}
            secondary={{
              label: "Nicht übernehmen",
              onClick: () => void send("declined", model),
            }}
          />
        ) : (
          <Note>Übernehmen ist in dieser Ansicht nicht möglich.</Note>
        )}
      </Card>
    </DataLLM>
  );
}

export function PlanAdjustmentCard({ onBack, onAsk, onChanged }: Props) {
  const list = useArnoldTool("get_plan_adjustments", PlanAdjustmentListSchema);
  /** After a conflict the card reads exactly this adjustment again. */
  const target = useRef<string | null>(null);
  const load = useLoad(async () => {
    const answer = await list.call(
      target.current ? { plan_adjustment_id: target.current } : {},
    );
    const view = pickAdjustment(answer);
    return { model: view && adjustmentModel(view), canWrite: answer.can_write };
  });
  const confirm = useCardWrite(
    "confirm_plan_adjustment",
    PlanAdjustmentWriteResponseSchema,
  );
  const cancel = useCardWrite(
    "cancel_plan_adjustment",
    PlanAdjustmentWriteResponseSchema,
  );
  const [written, setWritten] = useState<{
    model: ReturnType<typeof adjustmentModel>;
    watch?: WatchDelivery;
  } | null>(null);
  const title = "Anpassung auf Zeit";

  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  const model = written?.model ?? load.data.model;
  if (!model)
    return (
      <DataLLM content="Anpassungskarte: Es gilt der normale Plan; keine Anpassung ist offen.">
        <Card title={title} onBack={onBack}>
          <Box>
            <p className="m-0 font-medium">Es gilt dein normaler Plan.</p>
            <Note>Gerade ist keine Anpassung auf Zeit offen.</Note>
          </Box>
          <Button
            color="secondary"
            variant="soft"
            size="lg"
            block
            onClick={() => onAsk("Ich habe heute nur 20 Minuten.")}
          >
            Heute weniger Zeit
          </Button>
        </Card>
      </DataLLM>
    );

  const send = async (kind: "confirm" | "cancel") => {
    const write = kind === "confirm" ? confirm : cancel;
    (kind === "confirm" ? cancel : confirm).clear();
    const answer = await write.send(
      [kind, model.id, model.rowRevision],
      (id) => adjustmentInput(model, id),
      (failure) => {
        if (failure.code !== "REVISION_CONFLICT") return;
        // Show the newer revision; nothing was confirmed.
        setWritten(null);
        target.current = model.id;
        void load.reload();
      },
    );
    if (!answer?.result) return;
    setWritten({
      model: adjustmentModel(answer.result.plan_adjustment),
      watch: answer.watch_delivery,
    });
    onChanged();
  };
  const line = watchLine(written?.watch);
  const canWrite = load.data.canWrite;
  return (
    <DataLLM
      content={`Anpassungskarte: „${model.title}“ (${model.period}), Status ${model.status}. Nur der Klick des Nutzers bestätigt oder sagt ab.`}
    >
      <Card title={model.title} subtitle={model.period} onBack={onBack}>
        {model.status === "cancelled" ? (
          <Alert
            color="info"
            variant="soft"
            title="Abgesagt. Es gilt wieder dein normaler Plan."
          />
        ) : (
          <>
            <Box>
              <h3 className="heading-xs m-0">Einheiten im Zeitraum</h3>
              <Rows label="Einheiten im Zeitraum" items={model.sessions} />
            </Box>
            {model.rows.length > 0 && (
              <Box>
                <h3 className="heading-xs m-0">Das ändert sich</h3>
                <ChangeRows rows={model.rows} />
              </Box>
            )}
            {model.hints.map((h) => (
              <Note key={h}>{h}</Note>
            ))}
            <Note>{model.back}</Note>
            <WriteAlert error={confirm.error ?? cancel.error} />
            {model.status === "confirmed" ? (
              <>
                <Alert
                  color="success"
                  variant="soft"
                  title={model.confirmedText}
                  description={line ?? undefined}
                />
                {canWrite && (
                  <Button
                    color="secondary"
                    variant="ghost"
                    block
                    loading={cancel.pending}
                    onClick={() => void send("cancel")}
                  >
                    Absagen
                  </Button>
                )}
              </>
            ) : canWrite ? (
              <Actions
                label="Bestätigen"
                loading={confirm.pending}
                disabled={cancel.pending}
                onClick={() => void send("confirm")}
                secondary={{
                  label: "Absagen",
                  onClick: () => void send("cancel"),
                }}
              />
            ) : (
              <Note>Bestätigen ist in dieser Ansicht nicht möglich.</Note>
            )}
          </>
        )}
      </Card>
    </DataLLM>
  );
}
