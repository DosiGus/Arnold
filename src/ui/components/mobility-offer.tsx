import { useEffect, useRef, useState } from "react";
import type { MobilityOverview } from "../../shared/mobility-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { browserZone } from "../run/shared";
import { WriteError, useMobilityWrite } from "../mobility/shared";

/** The one sentence the "Ja" button sends; the server skills know it. */
export const MOBILITY_OFFER_MESSAGE = "Ich will auch Mobility.";

/** The offer is for a profile that was never asked; yes and no both end it. */
export const offersMobility = (overview: MobilityOverview): boolean =>
  overview.profile.state === "not_asked";

/**
 * True only for someone whose mobility profile is `not_asked`. A failed read
 * hides the offer rather than suggesting a setup that may already exist.
 * Skipped while `enabled` is false (no read, no offer).
 */
export function useMobilityNotAsked(
  client: ArnoldMcpClient | undefined,
  enabled: boolean,
): boolean {
  const [notAsked, setNotAsked] = useState(false);
  useEffect(() => {
    if (!client || !enabled) {
      setNotAsked(false);
      return;
    }
    let alive = true;
    client
      .mobilityOverview(browserZone())
      .then((o) => alive && setNotAsked(offersMobility(o)))
      .catch(() => alive && setNotAsked(false));
    return () => {
      alive = false;
    };
  }, [client, enabled]);
  return notAsked;
}

/**
 * The single offer "Mobility oder Morgenroutine dazunehmen?". "Ja" sends one
 * sentence to the chat (the setup is a conversation); "Nein danke" stores
 * `wants: false`, after which the profile is "no" and the offer never returns.
 */
export function MobilityOffer({ client }: { client: ArnoldMcpClient }) {
  const { busy, error, send } = useMobilityWrite(client);
  const [gone, setGone] = useState(false);
  const [sent, setSent] = useState(false);
  const [asking, setAsking] = useState(false);
  const sending = useRef(false);
  if (gone) return null;

  const yes = async () => {
    if (sending.current || sent) return;
    sending.current = true;
    setAsking(true);
    let ok = false;
    try {
      ok = await client.askChat(MOBILITY_OFFER_MESSAGE);
    } finally {
      sending.current = false;
      setAsking(false);
    }
    // Where there is no chat, the setup card takes the same step.
    if (ok) setSent(true);
    else void client.openMobility("mobility_setup").catch(() => {});
  };
  const no = async () => {
    const result = await send("update_mobility_profile", {
      preference: { wants: false },
    });
    if (result?.ok) setGone(true);
  };

  return (
    <section className="ac-mobility-offer" aria-label="Mobility dazunehmen">
      <p className="ac-text">Mobility oder Morgenroutine dazunehmen?</p>
      <div className="ac-mobility-offer-actions">
        <button
          type="button"
          className="ac-btn secondary"
          disabled={busy || asking || sent}
          aria-busy={asking || undefined}
          onClick={() => void yes()}
        >
          {asking ? "Einen Moment …" : "Ja"}
        </button>
        <button
          type="button"
          className="ac-btn secondary"
          disabled={busy || asking || sent}
          aria-busy={busy || undefined}
          onClick={() => void no()}
        >
          {busy ? "Einen Moment …" : "Nein danke"}
        </button>
      </div>
      <p className="ac-caption" role="status">
        {sent
          ? "Ich habe das an Arnold geschickt, die Antwort kommt im Chat."
          : ""}
      </p>
      <WriteError error={error} />
    </section>
  );
}
