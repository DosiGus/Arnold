/**
 * Loading and empty states for the plan editor.
 *
 * They render finished text only; none of them knows about MCP, stored rows
 * or metric arithmetic.
 */
import type { ReactNode } from "react";
import { Dumbbell, LoaderCircle } from "lucide-react";

export function LoadingState({ text = "Daten werden geladen …" }) {
  return (
    <div className="empty" role="status" aria-live="polite">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function EmptyState({
  title = "Noch keine Daten",
  text,
  children,
}: {
  title?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Dumbbell size={26} aria-hidden="true" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
