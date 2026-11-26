/**
 * "Satz korrigieren" on a stored training: the sets from `get_workout`, each
 * saved with `update_set` or discarded with `void_set` (after a second tap,
 * as the tool's confirmation rule asks). Arnold keeps a discarded set as
 * voided; nothing is deleted.
 */
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { useState } from "react";
import {
  WorkoutContextSchema,
  WriteResponseSchema,
} from "../../shared/workout-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import {
  canCorrectSets,
  setForms,
  updateSetInput,
  voidSetInput,
  type SetForm,
} from "../model/set-edit.js";
import { Note, useCardWrite, useLoad, WriteAlert } from "./card-kit.js";
import { dataChanged } from "./data-changed.js";

export function SetEditor({
  workoutId,
  title,
  onSaved,
  onAsk,
  onClose,
}: {
  workoutId: string;
  title: string;
  /** A set was changed: the caller reads the training again. */
  onSaved: () => void;
  /** The way through the chat when the card may not write. */
  onAsk: () => void;
  onClose: () => void;
}) {
  const read = useArnoldTool("get_workout", WorkoutContextSchema);
  const load = useLoad(() => read.call({ workout_id: workoutId }), [workoutId]);
  if (load.failed)
    return (
      <>
        <Note>Die Sätze ließen sich nicht laden.</Note>
        <Button
          color="secondary"
          variant="soft"
          size="sm"
          className="self-start"
          onClick={() => void load.reload()}
        >
          Sätze erneut laden
        </Button>
      </>
    );
  if (!load.data)
    return (
      <p role="status" className="m-0 text-sm text-secondary">
        Sätze werden geladen …
      </p>
    );
  const context = load.data;
  if (!canCorrectSets(context))
    return (
      <>
        <Note>Hier lässt sich das Training nicht ändern.</Note>
        <Button
          color="secondary"
          variant="soft"
          size="sm"
          className="self-start"
          onClick={onAsk}
        >
          Im Chat korrigieren
        </Button>
      </>
    );
  const completed = context.workout!.status === "completed";
  const forms = setForms(context.sets);
  const changed = () => {
    void load.reload();
    onSaved();
    dataChanged();
  };
  return (
    <div
      role="group"
      aria-label={`Sätze von ${title} korrigieren`}
      className="flex flex-col gap-3"
    >
      {forms.map((form, i) => (
        <div
          key={`${form.id}-${form.revision}`}
          className="flex flex-col gap-2"
        >
          {form.exercise !== forms[i - 1]?.exercise && (
            <span className="font-medium">{form.exercise}</span>
          )}
          <SetFields
            form={form}
            completed={completed}
            onChanged={changed}
            onConflict={() => void load.reload()}
          />
        </div>
      ))}
      {!forms.length && <Note>Keine Sätze mehr gespeichert.</Note>}
      <Button
        color="secondary"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={onClose}
      >
        Korrektur schließen
      </Button>
    </div>
  );
}

function SetFields({
  form,
  completed,
  onChanged,
  onConflict,
}: {
  form: SetForm;
  completed: boolean;
  onChanged: () => void;
  onConflict: () => void;
}) {
  const update = useCardWrite("update_set", WriteResponseSchema);
  const discard = useCardWrite("void_set", WriteResponseSchema);
  const [kg, setKg] = useState(form.kg);
  const [reps, setReps] = useState(form.reps);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const busy = update.pending || discard.pending;
  const dirty = kg !== form.kg || reps !== form.reps;
  /** Arnold asks before it stores an unusually high value. */
  const unusual = update.error?.code === "CONFIRMATION_REQUIRED";
  const onFail = (f: { code: string }) => {
    if (f.code === "REVISION_CONFLICT") onConflict();
  };
  const save = async (confirmed: boolean) => {
    setInvalid(null);
    discard.clear();
    const built = updateSetInput(form, { kg, reps }, completed);
    if (!built.ok) return setInvalid(built.error);
    if (!built.input) return;
    const input = {
      ...built.input,
      ...(confirmed ? { confirm_unusual_values: true } : {}),
    };
    const answer = await update.send(
      input,
      (id) => ({ request_id: id, ...input }),
      onFail,
    );
    if (answer) onChanged();
  };
  const remove = async () => {
    if (!confirming) return setConfirming(true);
    update.clear();
    const input = voidSetInput(form, completed);
    const answer = await discard.send(
      ["void", input],
      (id) => ({ request_id: id, ...input }),
      onFail,
    );
    setConfirming(false);
    if (answer) onChanged();
  };
  const name = `${form.exercise} ${form.label}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-sm text-secondary">
          {form.label}
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <Input
            aria-label={`${name} Gewicht`}
            inputMode="decimal"
            value={kg}
            disabled={!form.hasWeight || busy}
            placeholder={form.hasWeight ? "offen" : "–"}
            endAdornment="kg"
            onChange={(e) => setKg(e.target.value)}
          />
          <Input
            aria-label={`${name} Wiederholungen`}
            inputMode="numeric"
            value={reps}
            disabled={busy}
            endAdornment="×"
            onChange={(e) => setReps(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          color={confirming ? "danger" : "secondary"}
          variant={confirming ? "soft" : "ghost"}
          size="sm"
          aria-label={
            confirming ? `${name} wirklich verwerfen?` : `${name} verwerfen`
          }
          disabled={busy}
          onClick={() => void remove()}
        >
          {confirming ? "Wirklich verwerfen?" : "Verwerfen"}
        </Button>
        {dirty && (
          <Button
            color="primary"
            size="sm"
            aria-label={unusual ? `${name} so speichern` : `${name} speichern`}
            loading={update.pending}
            disabled={busy}
            onClick={() => void save(unusual)}
          >
            {unusual ? "Ja, so speichern" : "Speichern"}
          </Button>
        )}
      </div>
      {invalid && <Note>{invalid}</Note>}
      <WriteAlert error={update.error ?? discard.error} />
    </div>
  );
}
