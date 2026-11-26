/**
 * "A screen saved something": whoever shows figures read before the write
 * reads them again. One card, one user; nothing but the signal travels.
 */
const listeners = new Set<() => void>();

export function onDataChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function dataChanged(): void {
  for (const listener of listeners) listener();
}
