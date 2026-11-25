import "../../index.css";

import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { useState } from "react";
import { DataLLM } from "skybridge/web";
import { useCallTool, useToolInfo } from "../../helpers.js";
import { useHostTheme } from "../../use-host-theme.js";

type Geschlecht = "weiblich" | "maennlich" | "divers" | "keine_angabe";

export default function Eckdaten() {
  useHostTheme();
  const info = useToolInfo<"show_eckdaten">();
  const save = useCallTool("save_eckdaten");
  const [alter, setAlter] = useState("");
  const [groesse, setGroesse] = useState("");
  const [gewicht, setGewicht] = useState("");
  const [geschlecht, setGeschlecht] = useState<Geschlecht>("keine_angabe");

  if (info.isPending) return <p className="p-4 text-secondary">Lade …</p>;

  const num = (v: string) =>
    v.trim() === "" ? undefined : Number(v.replace(",", "."));
  const summary = `Eckdaten-Karte offen. Eingegeben: Alter ${alter || "fehlt"}, Größe ${groesse || "fehlt"}, Gewicht ${gewicht || "fehlt"}, Geschlecht ${geschlecht}.`;

  return (
    <DataLLM content={summary}>
      <section className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="heading-lg">Erzähl mir kurz von dir</h2>
          {save.isSuccess && <Badge color="success">Gespeichert</Badge>}
        </div>
        <p className="text-secondary">
          Freiwillig, nur für deinen Plan, jederzeit löschbar.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Alter
            <Input
              inputMode="numeric"
              value={alter}
              onChange={(e) => setAlter(e.target.value)}
              endAdornment="Jahre"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Größe
            <Input
              inputMode="decimal"
              value={groesse}
              onChange={(e) => setGroesse(e.target.value)}
              endAdornment="cm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Gewicht
            <Input
              inputMode="decimal"
              value={gewicht}
              onChange={(e) => setGewicht(e.target.value)}
              endAdornment="kg"
            />
          </label>
        </div>
        <SegmentedControl
          aria-label="Geschlecht (optional)"
          value={geschlecht}
          onChange={setGeschlecht}
          pill
        >
          <SegmentedControl.Option value="weiblich">
            Weiblich
          </SegmentedControl.Option>
          <SegmentedControl.Option value="maennlich">
            Männlich
          </SegmentedControl.Option>
          <SegmentedControl.Option value="divers">
            Divers
          </SegmentedControl.Option>
          <SegmentedControl.Option value="keine_angabe">
            Keine Angabe
          </SegmentedControl.Option>
        </SegmentedControl>
        <Button
          color="primary"
          block
          loading={save.isPending}
          onClick={() =>
            save.callTool({
              alter: num(alter),
              groesse: num(groesse),
              gewicht: num(gewicht),
              geschlecht,
            })
          }
        >
          Weiter
        </Button>
        {save.isError && (
          <p className="text-danger">
            Das hat nicht geklappt. Bitte noch einmal versuchen.
          </p>
        )}
      </section>
    </DataLLM>
  );
}
