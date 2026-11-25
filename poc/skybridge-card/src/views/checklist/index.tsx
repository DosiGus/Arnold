import "../../index.css";

import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { DataLLM } from "skybridge/web";
import { useCallTool, useToolInfo } from "../../helpers.js";
import { useHostTheme } from "../../use-host-theme.js";

export default function Checklist() {
  useHostTheme();
  const info = useToolInfo<"show_checklist">();
  const refresh = useCallTool("show_checklist");

  if (info.isPending) return <p className="p-4 text-secondary">Lade …</p>;

  // After "Aktualisieren" the newest answer wins over the first render.
  const state = refresh.data?.structuredContent ?? info.output;
  const items = state.items;
  const missing = items.filter((i) => i.value === null);
  const summary = missing.length
    ? `Checkliste offen. Es fehlt noch: ${missing.map((i) => i.label).join(", ")}.`
    : "Checkliste offen. Alle Pflichtangaben sind da.";

  return (
    <DataLLM content={summary}>
      <section className="flex flex-col gap-3 p-4">
        <h2 className="heading-lg">Das weiß ich schon</h2>
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3 border-b border-subtle py-3 last:border-b-0"
            >
              <span>{item.label}</span>
              {item.value === null ? (
                <Badge color="warning">fehlt noch</Badge>
              ) : (
                <span className="text-secondary">{item.value}</span>
              )}
            </li>
          ))}
        </ul>
        {missing.length > 0 && (
          <p className="m-0 text-sm text-secondary">
            Sag zum Beispiel: „{missing[0].hint}“
          </p>
        )}
        <Button
          color="secondary"
          variant="soft"
          loading={refresh.isPending}
          onClick={() => refresh.callTool()}
        >
          Aktualisieren
        </Button>
      </section>
    </DataLLM>
  );
}
