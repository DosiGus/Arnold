import type { Dispatch, SetStateAction } from "react";
import {
  Ban,
  Calendar,
  Crosshair,
  Dumbbell,
  Heart,
  LayoutGrid,
  MessageSquare,
} from "lucide-react";
import type { OnboardingProfile } from "../../../shared/onboarding-contract";
import {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
  SPLIT_LABEL,
  WEEKDAYS,
  WEEKDAY_LABEL,
} from "../../../shared/onboarding-contract";
import { Fold, OptionChips } from "./controls";
import type { PageFrame } from "./page-frame";
import { ICON, TITLE, type WishesDraft } from "./pages";

/** The optional wishes: fixed days, split, focus, equipment, exercises, notes. */
export function renderWishesPage({
  head,
  errorNote,
  actions,
  busy,
  wishes,
  setWishes,
  training,
  exerciseChoices,
  splitOptions,
  fold,
  setFold,
}: PageFrame & {
  wishes: WishesDraft;
  setWishes: Dispatch<SetStateAction<WishesDraft>>;
  training: OnboardingProfile["training"];
  exerciseChoices: readonly { exercise_id: string; name_de: string }[];
  splitOptions: readonly (keyof typeof SPLIT_LABEL)[];
  fold: number;
  setFold: (fold: number) => void;
}) {
  const w = wishes;
  const update = (patch: Partial<WishesDraft>) =>
    setWishes((d) => ({ ...d, ...patch }));
  const names = (ids: string[]) =>
    ids
      .map(
        (id) =>
          exerciseChoices.find((e) => e.exercise_id === id)?.name_de ?? id,
      )
      .join(", ");
  const sections = [
    {
      icon: <Calendar size={ICON} />,
      title: "Feste Trainingstage",
      value: w.training_days.length
        ? `${w.training_days
            .map((d) =>
              WEEKDAY_LABEL[d as keyof typeof WEEKDAY_LABEL].slice(0, 2),
            )
            .join(", ")}${
            training.days_per_week &&
            w.training_days.length !== training.days_per_week
              ? ` · noch ${training.days_per_week - w.training_days.length}`
              : ""
          }`
        : "Flexibel",
      set: w.training_days.length > 0,
      body: (
        <>
          <p className="ac-text">
            {training.days_per_week
              ? `Wähle genau ${training.days_per_week} ${training.days_per_week === 1 ? "Tag" : "Tage"} oder keinen. Ohne feste Tage zählt nur, wie oft du trainierst.`
              : "Ohne feste Tage zählt nur, wie oft du trainierst."}
          </p>
          <OptionChips
            label="Feste Trainingstage"
            options={WEEKDAYS.map((d) => ({
              value: d,
              label: WEEKDAY_LABEL[d].slice(0, 2),
            }))}
            values={w.training_days}
            onChange={(v) => update({ training_days: v })}
            max={training.days_per_week ?? 7}
            grid
            disabled={busy}
          />
        </>
      ),
    },
    {
      icon: <LayoutGrid size={ICON} />,
      title: "Aufteilung",
      value:
        w.split && w.split !== "auto"
          ? SPLIT_LABEL[w.split as keyof typeof SPLIT_LABEL]
          : "Arnold entscheidet",
      set: !!w.split && w.split !== "auto",
      body: (
        <OptionChips
          label="Aufteilung"
          options={splitOptions.map((s) => ({
            value: s,
            label: SPLIT_LABEL[s],
          }))}
          values={w.split ? [w.split] : []}
          onChange={(v) => update({ split: v[0] })}
          single
          disabled={busy}
        />
      ),
    },
    {
      icon: <Crosshair size={ICON} />,
      title: "Schwerpunkt",
      value: w.focus_muscle_groups.length
        ? w.focus_muscle_groups
            .map(
              (m) => MUSCLE_GROUP_LABEL[m as keyof typeof MUSCLE_GROUP_LABEL],
            )
            .join(", ")
        : "Ausgewogen",
      set: w.focus_muscle_groups.length > 0,
      body: (
        <>
          <p className="ac-text">Bis zu drei Muskelgruppen.</p>
          <OptionChips
            label="Schwerpunkt"
            options={MUSCLE_GROUPS.map((m) => ({
              value: m,
              label: MUSCLE_GROUP_LABEL[m],
            }))}
            values={w.focus_muscle_groups}
            onChange={(v) => update({ focus_muscle_groups: v })}
            max={3}
            disabled={busy}
          />
        </>
      ),
    },
    {
      icon: <Dumbbell size={ICON} />,
      title: "Geräte",
      value: w.equipment.length
        ? w.equipment
            .map((e) => EQUIPMENT_LABEL[e as keyof typeof EQUIPMENT_LABEL])
            .join(", ")
        : "Was dein Trainingsort hat",
      set: w.equipment.length > 0,
      body: (
        <OptionChips
          label="Geräte"
          options={EQUIPMENT.map((e) => ({
            value: e,
            label: EQUIPMENT_LABEL[e],
          }))}
          values={w.equipment}
          onChange={(v) => update({ equipment: v })}
          disabled={busy}
        />
      ),
    },
    {
      icon: <Heart size={ICON} />,
      title: "Lieblingsübungen",
      value: w.preferred_exercise_ids.length
        ? names(w.preferred_exercise_ids)
        : "Keine Vorgabe",
      set: w.preferred_exercise_ids.length > 0,
      body: (
        <OptionChips
          label="Lieblingsübungen"
          options={exerciseChoices.map((e) => ({
            value: e.exercise_id,
            label: e.name_de,
          }))}
          values={w.preferred_exercise_ids}
          onChange={(v) =>
            update({
              preferred_exercise_ids: v,
              avoided_exercise_ids: w.avoided_exercise_ids.filter(
                (id) => !v.includes(id),
              ),
            })
          }
          disabled={busy}
        />
      ),
    },
    {
      icon: <Ban size={ICON} />,
      title: "Übungen vermeiden",
      value: w.avoided_exercise_ids.length
        ? names(w.avoided_exercise_ids)
        : "Keine",
      set: w.avoided_exercise_ids.length > 0,
      body: (
        <OptionChips
          label="Übungen vermeiden"
          options={exerciseChoices.map((e) => ({
            value: e.exercise_id,
            label: e.name_de,
          }))}
          values={w.avoided_exercise_ids}
          onChange={(v) =>
            update({
              avoided_exercise_ids: v,
              preferred_exercise_ids: w.preferred_exercise_ids.filter(
                (id) => !v.includes(id),
              ),
            })
          }
          disabled={busy}
        />
      ),
    },
    {
      icon: <MessageSquare size={ICON} />,
      title: "Sonst noch etwas?",
      value: w.notes.trim() ? w.notes.trim() : "In deinen Worten",
      set: !!w.notes.trim(),
      body: (
        <>
          <label className="visually-hidden" htmlFor="setup-notes">
            Sonst noch etwas für deinen Plan
          </label>
          <textarea
            id="setup-notes"
            className="ac-textarea"
            maxLength={600}
            value={w.notes}
            disabled={busy}
            placeholder="z. B. Ich will Klimmzüge lernen und mein Rücken soll stärker werden."
            onChange={(event) => update({ notes: event.target.value })}
          />
        </>
      ),
    },
  ];
  return (
    <section
      className="ac"
      aria-label={TITLE.wishes}
      aria-busy={busy || undefined}
    >
      {head}
      <div>
        <h2 className="ac-title">{TITLE.wishes}</h2>
        <p className="ac-sub">
          Je mehr du angibst, desto mehr passt der Plan zu dir. Was offen
          bleibt, entscheidet Arnold.
        </p>
      </div>
      <div className="ac-folds">
        {sections.map((s, i) => (
          <Fold
            key={s.title}
            icon={s.icon}
            title={s.title}
            value={s.value}
            set={s.set}
            open={fold === i}
            onToggle={() => setFold(fold === i ? -1 : i)}
          >
            {s.body}
          </Fold>
        ))}
      </div>
      {errorNote}
      {actions}
    </section>
  );
}
