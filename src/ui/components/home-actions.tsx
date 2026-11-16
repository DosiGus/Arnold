import { useRef, useState } from "react";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

/**
 * The four action buttons under the start card. Each sends exactly one fixed
 * sentence into the chat; the wording is the interface to the server
 * instructions and must not change. Where there is no chat (local preview) or
 * the host refuses, a button goes the card way instead.
 */
export type HomeActionKey = "next" | "plan" | "exception" | "goal";

export const HOME_ACTIONS: readonly {
  key: HomeActionKey;
  label: string;
  message: string;
}[] = [
  {
    key: "next",
    label: "Nächstes Training",
    message: "Zeig mir mein nächstes Training.",
  },
  {
    key: "plan",
    label: "Plan ändern",
    message: "Ich möchte meinen Plan ändern.",
  },
  {
    key: "exception",
    label: "Urlaub oder Ausnahme",
    message: "Ich habe eine Ausnahme, zum Beispiel Urlaub.",
  },
  {
    key: "goal",
    label: "Ziel anpassen",
    message: "Ich möchte ein Ziel anpassen.",
  },
];

export function HomeActions({
  client,
  canWrite,
  onFallback,
}: {
  client?: ArnoldMcpClient;
  canWrite: boolean;
  /** Called when the chat did not take the sentence. */
  onFallback: (key: Exclude<HomeActionKey, "exception">) => void;
}) {
  const sending = useRef(false);
  const [busy, setBusy] = useState<HomeActionKey>();
  const [sent, setSent] = useState<ReadonlySet<HomeActionKey>>(new Set());
  const [hint, setHint] = useState(false);
  const actions = canWrite ? HOME_ACTIONS : HOME_ACTIONS.slice(0, 1);

  const run = async (key: HomeActionKey, message: string) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(key);
    setHint(false);
    let ok = false;
    try {
      ok = client ? await client.sendChatMessage(message) : false;
    } finally {
      sending.current = false;
      setBusy(undefined);
    }
    if (ok) setSent((s) => new Set(s).add(key));
    else if (key === "exception") setHint(true);
    else onFallback(key);
  };

  return (
    <div className="ac-home-actions-wrap">
      <div
        className="ac-home-actions"
        role="group"
        aria-label="Das kannst du tun"
      >
        {actions.map((a, i) => (
          <button
            key={a.key}
            type="button"
            className={`ac-btn ${i === 0 ? "primary" : "secondary"}`}
            disabled={busy !== undefined || sent.has(a.key)}
            aria-busy={busy === a.key || undefined}
            onClick={() => void run(a.key, a.message)}
          >
            {busy === a.key ? "Einen Moment …" : a.label}
          </button>
        ))}
      </div>
      <p className="ac-caption" role="status">
        {sent.size
          ? "Ich habe das an Arnold geschickt, die Antwort kommt im Chat."
          : hint
            ? "Urlaub oder eine Ausnahme sagst du am besten im Chat, zum Beispiel: „Ich habe nächste Woche Urlaub.“"
            : ""}
      </p>
    </div>
  );
}
