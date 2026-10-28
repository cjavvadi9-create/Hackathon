import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";
import {
  benchmarkResults,
  benchmarkSessions,
  datasetVersions,
  optimizationRuns,
  orderLines,
  orders,
  runAssignments,
  runMetrics,
  skus,
  users,
  warehouseLocations,
  warehouses,
} from "../drizzle/schema";

const tables = [
  warehouses,
  datasetVersions,
  warehouseLocations,
  skus,
  orders,
  orderLines,
  optimizationRuns,
  runMetrics,
  runAssignments,
  benchmarkSessions,
  benchmarkResults,
];

const indexNames = (table: (typeof tables)[number]) =>
  getTableConfig(table).indexes.map((index) => index.config.name);

describe("warehouse database schema", () => {
  it("preserves users and defines every warehouse persistence table", () => {
    expect(getTableConfig(users).name).toBe("users");
    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      "warehouses",
      "dataset_versions",
      "warehouse_locations",
      "skus",
      "orders",
      "order_lines",
      "optimization_runs",
      "run_metrics",
      "run_assignments",
      "benchmark_sessions",
      "benchmark_results",
    ]);
  });

  it("ties every warehouse to an existing user and versions datasets immutably by status", () => {
    const ownerFk = getTableConfig(warehouses).foreignKeys[0];
    expect(getTableConfig(ownerFk.reference().foreignTable).name).toBe("users");
    expect(ownerFk.onDelete).toBe("restrict");

    const versionColumns = getTableConfig(datasetVersions).columns;
    expect(versionColumns.map((column) => column.name)).toContain("status");
    expect(versionColumns.map((column) => column.name)).toContain("validatedAt");
    expect(indexNames(datasetVersions)).toContain("dataset_versions_warehouse_version_uq");
  });

  it("keeps order lines within one dataset version and enforces optimizer uniqueness", () => {
    const lineFks = getTableConfig(orderLines).foreignKeys.map((fk) =>
      getTableConfig(fk.reference().foreignTable).name,
    );
    expect(lineFks).toContain("orders");
    expect(lineFks).toContain("skus");
    expect(indexNames(orderLines)).toContain("order_lines_version_order_sku_uq");
    expect(indexNames(runAssignments)).toContain("run_assignments_run_scope_sku_uq");
    expect(indexNames(runAssignments)).toContain("run_assignments_run_scope_location_uq");
  });

  it("stores full-precision metrics and snapshots benchmark results", () => {
    const metricColumns = getTableConfig(runMetrics).columns;
    expect(metricColumns.find((column) => column.name === "objective")?.getSQLType()).toBe("double");
    expect(metricColumns.find((column) => column.name === "averageDistance")?.getSQLType()).toBe("double");
    expect(indexNames(runMetrics)).toContain("run_metrics_run_scope_uq");
    expect(indexNames(benchmarkResults)).toContain("benchmark_results_session_algorithm_uq");
    expect(getTableConfig(optimizationRuns).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["parameters", "routeAssumptions", "optimizerVersion", "stopReason"]),
    );
    expect(getTableConfig(benchmarkSessions).columns.map((column) => column.name)).toContain("parameters");
  });

  it("ships an additive migration for these tables without changing users", () => {
    const migration = readFileSync(new URL("../drizzle/0001_phase2a_warehouse_storage.sql", import.meta.url), "utf8");
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE \`${getTableConfig(table).name}\``);
    }
    expect(migration).not.toContain("ALTER TABLE `users`");
    expect(migration).not.toContain("DROP TABLE");
  });
});
