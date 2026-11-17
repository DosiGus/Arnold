import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { PlanAdjustmentView } from "../components/plan/adjustment-card";
import { usePlanAdjustment } from "../hooks/usePlanAdjustment";

/** `plan_adjustment`: the adjustment for a while waiting for its yes (UX-008). */
export function PlanAdjustmentCard({
  client,
  onChanged,
}: {
  client: ArnoldMcpClient;
  onChanged: () => void;
}) {
  const { state, confirm, cancel, reload } = usePlanAdjustment(
    client,
    onChanged,
  );
  return (
    <PlanAdjustmentView
      state={state}
      onConfirm={() => void confirm()}
      onCancel={() => void cancel()}
      onReload={() => void reload()}
    />
  );
}
