import { useEffect, useState } from "react";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

/**
 * True only for someone who has no run profile yet. A failed read hides the
 * offer rather than suggesting a setup that may already exist. Shared by the
 * account card and the start screen so both offer the same way in.
 */
export function useNoRunProfile(client: ArnoldMcpClient | undefined): boolean {
  const [noRunProfile, setNoRunProfile] = useState(false);
  useEffect(() => {
    if (!client) return;
    let alive = true;
    client
      .runProfile()
      .then((r) => alive && setNoRunProfile(r.profile === null))
      .catch(() => alive && setNoRunProfile(false));
    return () => {
      alive = false;
    };
  }, [client]);
  return noRunProfile;
}
