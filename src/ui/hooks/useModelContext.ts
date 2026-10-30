import { useEffect } from "react";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

/**
 * Keeps the model informed about what the card shows, without starting a chat
 * turn. Each update replaces the previous one, so `text` must always describe
 * the whole current state. Bursts (several taps in a row) collapse into one.
 */
export function useModelContext(
  client: ArnoldMcpClient,
  text: string | undefined,
) {
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => void client.tellModel(text), 300);
    return () => clearTimeout(timer);
  }, [client, text]);
}
