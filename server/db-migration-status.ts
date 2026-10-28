export type MigrationJournalEntry = { tag: string; when: number };
export type MigrationStatus = "applied" | "pending" | "partial_or_untracked" | "history_mismatch";

export const MIGRATION_TABLES: Record<string, string[]> = {
  "0000_initial_users": ["users"],
  "0001_phase2a_warehouse_storage": [
    "benchmark_results",
    "benchmark_sessions",
    "dataset_versions",
    "optimization_runs",
    "order_lines",
    "orders",
    "run_assignments",
    "run_metrics",
    "skus",
    "warehouse_locations",
    "warehouses",
  ],
};

export const EXPECTED_DATABASE_TABLES = Object.values(MIGRATION_TABLES).flat();

export function summarizeMigrationStatus(input: {
  journal: MigrationJournalEntry[];
  latestAppliedAt: number | null;
  migrationTablePresent: boolean;
  existingTables: ReadonlySet<string>;
}): {
  status: MigrationStatus;
  appliedMigrations: string[];
  pendingMigrations: string[];
  missingTables: string[];
} {
  const { journal, latestAppliedAt, existingTables } = input;
  const appliedEntries = latestAppliedAt === null
    ? []
    : journal.filter((entry) => entry.when <= latestAppliedAt);
  const pendingEntries = latestAppliedAt === null
    ? journal
    : journal.filter((entry) => entry.when > latestAppliedAt);
  const knownTimestamps = new Set(journal.map((entry) => entry.when));
  const missingTables = EXPECTED_DATABASE_TABLES.filter((table) => !existingTables.has(table));

  let status: MigrationStatus;
  if (latestAppliedAt !== null && !knownTimestamps.has(latestAppliedAt)) {
    status = "history_mismatch";
  } else if (missingTables.length === 0 && pendingEntries.length === 0) {
    status = "applied";
  } else if (latestAppliedAt === null && existingTables.size === 0) {
    status = "pending";
  } else {
    const pendingTables = pendingEntries.flatMap((entry) => MIGRATION_TABLES[entry.tag] ?? []);
    const pendingTablesAlreadyPresent = pendingTables.some((table) => existingTables.has(table));
    const appliedTables = appliedEntries.flatMap((entry) => MIGRATION_TABLES[entry.tag] ?? []);
    const appliedTablesMissing = appliedTables.some((table) => !existingTables.has(table));

    if (appliedTablesMissing || pendingTablesAlreadyPresent || (pendingEntries.length === 0 && missingTables.length > 0)) {
      status = "partial_or_untracked";
    } else {
      status = "pending";
    }
  }

  // Existing tables without migration history may have been created manually;
  // report that ambiguity instead of asserting that a migration partially ran.
  if (!input.migrationTablePresent && existingTables.size > 0 && latestAppliedAt === null) {
    status = "partial_or_untracked";
  }

  return {
    status,
    appliedMigrations: appliedEntries.map((entry) => entry.tag),
    pendingMigrations: pendingEntries.map((entry) => entry.tag),
    missingTables,
  };
}
