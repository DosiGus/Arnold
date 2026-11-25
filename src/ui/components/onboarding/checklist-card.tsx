import {
  REQUIRED_FIELD_LABEL,
  modulesOf,
  requiredFieldsFor,
  type OnboardingState,
} from "../../../shared/onboarding-contract";
import { UnderstoodRows } from "../conversation-cards";
import { CardFrame } from "./card-frame";
import {
  fieldValue,
  modulesLine,
  personLine,
  SummaryLine,
} from "./card-summary";

/**
 * Card "Checkliste": what Arnold already knows, from the server state. A field
 * the server still lists as missing says "fehlt noch". No buttons: the card
 * reads again when the window gets focus or the card is tapped.
 */
export function ChecklistCard({ state }: { state: OnboardingState }) {
  const { profile } = state.session;
  const modules = modulesOf(profile.training);
  // The way is not a question for the user (D-17): never listed here.
  const missing = new Set(state.progress.missing_fields);
  const fields = requiredFieldsFor(profile.path ?? "arnold_plan", modules);
  const known = personLine(profile.person);
  return (
    <CardFrame tag="Checkliste" title="Das weiß ich schon" card="checklist">
      {known && <SummaryLine label="Eckdaten">{known}</SummaryLine>}
      <SummaryLine label="Module">{modulesLine(modules)}</SummaryLine>
      {fields.length > 0 ? (
        <UnderstoodRows
          label="Pflichtangaben"
          items={fields.map((field) => ({
            key: field,
            label: REQUIRED_FIELD_LABEL[field],
            // Without a stored way the server lists only "path" as missing,
            // so an empty field counts as missing on its own.
            value: missing.has(field)
              ? undefined
              : profile.path === null
                ? fieldValue(field, profile)
                : (fieldValue(field, profile) ?? "Angegeben"),
          }))}
        />
      ) : (
        <p className="ac-text">Für deinen Weg brauche ich nichts weiter.</p>
      )}
      <p className="oc-note">Antippen holt den neuesten Stand.</p>
    </CardFrame>
  );
}
