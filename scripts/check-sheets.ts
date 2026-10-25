import { createStorage } from "../src/server/storage-config";
import { buildDashboard } from "../src/shared/calculations";
if (process.env.STORAGE_MODE !== "google_sheets")
  throw new Error("Für diesen Check das private Sheets-Profil laden.");
try {
  const dashboard = buildDashboard(
    await createStorage(process.cwd()).getSnapshot(),
  );
  console.log(
    JSON.stringify(
      {
        source: dashboard.source,
        synthetic: dashboard.synthetic,
        readOnly: dashboard.connection?.readOnly,
        totals: dashboard.totals,
        skippedRows: dashboard.connection?.skippedRows,
        fetchedAt: dashboard.connection?.fetchedAt,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Sheets-Leseprüfung fehlgeschlagen.",
  );
  process.exitCode = 1;
}
