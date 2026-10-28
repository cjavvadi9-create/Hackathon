import { describe, expect, it } from "vitest";
import { EXPECTED_DATABASE_TABLES, summarizeMigrationStatus } from "./db-migration-status";

const journal = [
  { tag: "0000_initial_users", when: 100 },
  { tag: "0001_phase2a_warehouse_storage", when: 200 },
];

describe("read-only migration status classification", () => {
  it("reports all migrations pending for an empty database without a migration ledger", () => {
    expect(summarizeMigrationStatus({
      journal,
      latestAppliedAt: null,
      migrationTablePresent: false,
      existingTables: new Set(),
    })).toMatchObject({
      status: "pending",
      appliedMigrations: [],
      pendingMigrations: journal.map((entry) => entry.tag),
      missingTables: EXPECTED_DATABASE_TABLES,
    });
  });

  it("reports the warehouse migration pending after the users migration", () => {
    expect(summarizeMigrationStatus({
      journal,
      latestAppliedAt: 100,
      migrationTablePresent: true,
      existingTables: new Set(["users"]),
    })).toMatchObject({
      status: "pending",
      appliedMigrations: ["0000_initial_users"],
      pendingMigrations: ["0001_phase2a_warehouse_storage"],
    });
  });

  it("flags pending migration tables that already exist as partial or untracked", () => {
    expect(summarizeMigrationStatus({
      journal,
      latestAppliedAt: 100,
      migrationTablePresent: true,
      existingTables: new Set(["users", "warehouses"]),
    }).status).toBe("partial_or_untracked");
  });

  it("reports all applied when the ledger and all expected tables agree", () => {
    expect(summarizeMigrationStatus({
      journal,
      latestAppliedAt: 200,
      migrationTablePresent: true,
      existingTables: new Set(EXPECTED_DATABASE_TABLES),
    })).toMatchObject({
      status: "applied",
      appliedMigrations: journal.map((entry) => entry.tag),
      pendingMigrations: [],
      missingTables: [],
    });
  });

  it("flags applied migration records whose expected tables are missing", () => {
    const tables = new Set(EXPECTED_DATABASE_TABLES);
    tables.delete("optimization_runs");
    expect(summarizeMigrationStatus({
      journal,
      latestAppliedAt: 200,
      migrationTablePresent: true,
      existingTables: tables,
    }).status).toBe("partial_or_untracked");
  });
});
