/**
 * The retry rule of every card write: the same input keeps its `request_id`,
 * so trying again after an unclear outcome never saves twice. A definite
 * answer (saved or refused) ends the id; a changed input gets a new one.
 */
export function requestIds(next: () => string) {
  let pending: { key: string; id: string } | null = null;
  return {
    for(input: unknown): string {
      const key = JSON.stringify(input);
      if (pending?.key !== key) pending = { key, id: next() };
      return pending.id;
    },
    done() {
      pending = null;
    },
  };
}
