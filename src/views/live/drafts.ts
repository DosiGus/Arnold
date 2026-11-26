/**
 * What was ticked but not saved yet, kept while the card is open, so "back"
 * does not lose it. A draft keeps its request id: saving it again after a
 * lost answer is the same write, never a second one.
 */
import { newRequestId } from "../arnold-client.js";

export type Draft<T> = { requestId: string; value: T | null };

const drafts = new Map<string, Draft<unknown>>();

export function draftOf<T>(key: string): Draft<T> {
  let draft = drafts.get(key) as Draft<T> | undefined;
  if (!draft) {
    draft = { requestId: newRequestId(), value: null };
    drafts.set(key, draft);
  }
  return draft;
}

/** After a confirmed write the next one is a new operation. */
export const dropDraft = (key: string) => void drafts.delete(key);
