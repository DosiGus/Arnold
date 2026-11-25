import { useEffect } from "react";
import { useUser } from "skybridge/web";

/**
 * Apps SDK UI switches light/dark with `data-theme` on an ancestor. The host
 * (ChatGPT) tells the view its theme; this applies it to the document.
 */
export function useHostTheme() {
  const { theme } = useUser();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
