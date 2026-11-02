import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Recovery } from "../../shared/write-recovery";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { RECOVERY_COPY, type UiFailure } from "../recovery";
import { ArnoldCard, CardActions, CardNote } from "./cards";
import { useModelContext } from "../hooks/useModelContext";

export function RecoveryCard({
  recovery,
  onAction,
  busy = false,
}: {
  recovery: Recovery;
  onAction?: () => void;
  busy?: boolean;
}) {
  const copy = RECOVERY_COPY[recovery];
  return (
    <ArnoldCard
      role="alert"
      label="So geht es weiter"
      title={copy.title}
      subtitle={copy.body}
      busy={busy}
    >
      {copy.action && onAction && (
        <CardActions
          primary={{
            label: busy ? "Wird geprüft …" : copy.action,
            onClick: onAction,
            disabled: busy,
          }}
        />
      )}
    </ArnoldCard>
  );
}

export function RecoveryNotice({
  recovery,
  code,
  message,
  onAction,
  busy = false,
}: {
  recovery: Recovery;
  code?: string;
  message?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  const copy =
    code === "DATE_IN_FUTURE"
      ? {
          title: "Das Datum liegt in der Zukunft",
          body: "Nenne im Chat heute oder ein vergangenes Trainingsdatum.",
        }
      : RECOVERY_COPY[recovery];
  return (
    <CardNote tone="error">
      <strong>{copy.title}</strong>
      {message && <p>{message}</p>}
      <p>{copy.body}</p>
      {copy.action && onAction && (
        <button
          type="button"
          className="ac-link"
          onClick={onAction}
          disabled={busy}
        >
          {busy ? "Wird geprüft …" : copy.action}
        </button>
      )}
    </CardNote>
  );
}
