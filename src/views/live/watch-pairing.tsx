import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { useState } from "react";
import {
  PairGarminWatchResponseSchema,
  type PairGarminWatchConfirmMeta,
} from "../../shared/watch-contract.js";
import { ArnoldCallError, useArnoldTool } from "../arnold-client.js";
import {
  accountErrorText,
  pairConfirmInput,
  pairConfirmation,
  watchCode,
} from "../model/settings.js";

const errorText = (e: unknown) =>
  e instanceof ArnoldCallError
    ? accountErrorText(e.code, e.message)
    : "Die Uhr ließ sich gerade nicht koppeln.";

/**
 * Pairs a Garmin watch in two steps with `pair_garmin_watch`: the code from
 * the watch shows which watch it is; only the user's click on "Verbinden"
 * sends the confirmation token from `_meta.arnold` and pairs it.
 */
export function WatchPairing({
  onPaired,
  onCancel,
}: {
  onPaired: (label: string) => void;
  onCancel?: () => void;
}) {
  const pair = useArnoldTool(
    "pair_garmin_watch",
    PairGarminWatchResponseSchema,
  );
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState<PairGarminWatchConfirmMeta | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    const clean = watchCode(code);
    if (!clean) {
      setError("Der Code auf deiner Uhr hat acht Zeichen, z. B. ABCD-2345.");
      return;
    }
    setError(null);
    try {
      const { arnold } = await pair.callWithMeta({
        user_code: clean,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const c = pairConfirmation(arnold);
      if (!c) setError("Die Uhr ließ sich gerade nicht koppeln.");
      else setConfirm(c);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const connect = async () => {
    if (!confirm) return;
    setError(null);
    try {
      const done = await pair.call(pairConfirmInput(confirm));
      if (done.stage === "paired") onPaired(done.device_label);
      else setError("Die Uhr ließ sich gerade nicht koppeln.");
    } catch (e) {
      setConfirm(null);
      setError(errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {confirm ? (
        <>
          <Alert
            color="info"
            variant="soft"
            title={`${confirm.device_label} mit Arnold verbinden?`}
            description={`Code ${confirm.user_code}. Erst dein Klick verbindet die Uhr.`}
          />
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            <Button
              color="primary"
              block
              loading={pair.pending}
              onClick={() => void connect()}
            >
              Verbinden
            </Button>
            <Button
              color="secondary"
              variant="ghost"
              block
              onClick={() => {
                setConfirm(null);
                onCancel?.();
              }}
            >
              Abbrechen
            </Button>
          </div>
        </>
      ) : (
        <>
          <Input
            aria-label="Code von der Uhr"
            placeholder="Code von der Uhr, z. B. ABCD-2345"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            <Button
              color="primary"
              block
              disabled={code.trim() === ""}
              loading={pair.pending}
              onClick={() => void check()}
            >
              Code prüfen
            </Button>
            {onCancel && (
              <Button
                color="secondary"
                variant="ghost"
                block
                onClick={onCancel}
              >
                Abbrechen
              </Button>
            )}
          </div>
        </>
      )}
      {error && <Alert color="danger" variant="soft" title={error} />}
    </div>
  );
}
