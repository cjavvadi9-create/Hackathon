import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { optimize, makeSampleData } from "../client/src/lib/optimizer";
import { optimizationRuns, runAssignments, runMetrics, skus, warehouseLocations } from "../drizzle/schema";
import { createOptimizationRepository, OptimizationRecoveryError } from "./optimization-repository";
import type { getDb } from "./db";

describe("optimization result persistence mapping", () => {
  it("maps baseline and optimized assignments, metrics, explanations, and scopes in one transaction", async () => {
    const data = makeSampleData();
    const run = optimize(data, { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 1000, seed: 42 });
    run.runId = "42";
    run.datasetVersion = "17";
    run.runtimeMs = 123;
    const statements: Array<{ type: string; table: unknown; values?: any }> = [];
    let committed = false;
    const tx = {
      select: () => {
        let selectedTable: unknown;
        const builder = {
          from: (table: unknown) => { selectedTable = table; return builder; },
          innerJoin: () => builder,
          where: () => builder,
          limit: () => builder,
          for: () => builder,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => {
            let rows: unknown[] = [];
            if (selectedTable === optimizationRuns) rows = [{ id: 42, datasetVersionId: 17 }];
            else if (selectedTable === skus) rows = data.skus.map((sku, index) => ({ id: index + 100, skuId: sku.sku_id }));
            else if (selectedTable === warehouseLocations) rows = data.layout.map((location, index) => ({ id: index + 200, locationId: location.location_id }));
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
        return builder;
      },
      insert: (table: unknown) => ({
        values: async (values: unknown) => { statements.push({ type: "insert", table, values }); },
      }),
      update: (table: unknown) => ({
        set: (values: unknown) => ({ where: async () => { statements.push({ type: "update", table, values }); } }),
      }),
    };
    const fakeDb = { transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => {
      const result = await work(tx);
      committed = true;
      return result;
    } };
    const db = fakeDb as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>;
    const repository = createOptimizationRepository(async () => db);

    await repository.completeRun({
      userId: 9,
      runId: 42,
      run,
      objectives: { baseline: 0.123456789, optimized: 0.0987654321 },
    });

    const assignmentInsert = statements.find((statement) => statement.type === "insert" && statement.table === runAssignments)?.values as Array<Record<string, unknown>>;
    const metricsInsert = statements.find((statement) => statement.type === "insert" && statement.table === runMetrics)?.values as Array<Record<string, unknown>>;
    const statusUpdateIndex = statements.findIndex((statement) => statement.type === "update" && statement.table === optimizationRuns);
    expect(committed).toBe(true);
    expect(assignmentInsert).toHaveLength(run.baselineAssignments.length + run.assignments.length);
    expect(assignmentInsert[0]).toMatchObject({ datasetVersionId: 17, optimizationRunId: 42, scope: "baseline", score: run.baselineAssignments[0]?.score, reason: run.baselineAssignments[0]?.reason });
    expect(assignmentInsert.at(-1)).toMatchObject({ scope: "optimized", reason: run.assignments.at(-1)?.reason });
    expect(assignmentInsert.every((assignment) => typeof assignment.skuId === "number" && typeof assignment.locationId === "number")).toBe(true);
    expect(metricsInsert).toHaveLength(2);
    expect(metricsInsert).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "baseline", objective: 0.123456789, totalDistance: run.baseline.totalDistance }),
      expect.objectContaining({ scope: "optimized", objective: 0.0987654321, totalDistance: run.optimized.totalDistance }),
    ]));
    expect(statusUpdateIndex).toBeGreaterThan(statements.findIndex((statement) => statement.type === "insert" && statement.table === runMetrics));
    expect(statements[statusUpdateIndex]?.values).toMatchObject({ status: "succeeded", runtimeMs: 123, validationReport: run.validation });
  });
});

function recoveryDatabase(staleRows: Array<{ id: number }>) {
  const updates: Array<{ table: unknown; values: Record<string, unknown>; condition: unknown }> = [];
  let selectionCondition: unknown;
  const tx = {
    select: () => {
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: (condition: unknown) => { selectionCondition = condition; return builder; },
        for: () => builder,
        then: (resolve: (value: Array<{ id: number }>) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(staleRows).then(resolve, reject),
      };
      return builder;
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => { updates.push({ table, values, condition }); },
      }),
    }),
  };
  const db = {
    transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>;
  return { db, updates, get selectionCondition() { return selectionCondition; } };
}

describe("stale optimization run recovery", () => {
  const recoveryInput = {
    userId: 29,
    staleBefore: new Date("2026-10-28T00:00:00Z"),
    errorMessage: "Run abandoned after 15 minutes without completion. Retry the optimization.",
    datasetVersionId: 17,
  };

  it("does not change successful runs because only stale running rows are candidates", async () => {
    const fake = recoveryDatabase([]);
    const repository = createOptimizationRepository(async () => fake.db);

    expect(await repository.recoverStaleRuns(recoveryInput)).toBe(0);
    const query = new MySqlDialect().sqlToQuery(fake.selectionCondition as never);
    expect(query.sql).toContain("status");
    expect(query.params).toContain("running");
    expect(query.params.some((value) => String(value).includes("2026-10-28"))).toBe(true);
    expect(fake.updates).toHaveLength(0);
  });

  it("leaves recent running rows active", async () => {
    const fake = recoveryDatabase([]);
    const repository = createOptimizationRepository(async () => fake.db);

    expect(await repository.recoverStaleRuns(recoveryInput)).toBe(0);
    const query = new MySqlDialect().sqlToQuery(fake.selectionCondition as never);
    expect(query.sql).toContain("startedAt");
    expect(query.sql).toMatch(/<\s*\?/);
    expect(query.params.some((value) => String(value).includes("2026-10-28"))).toBe(true);
    expect(fake.updates).toHaveLength(0);
  });

  it("marks stale running rows failed with a clear reason and a guarded update", async () => {
    const fake = recoveryDatabase([{ id: 88 }]);
    const repository = createOptimizationRepository(async () => fake.db);

    expect(await repository.recoverStaleRuns(recoveryInput)).toBe(1);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toMatchObject({
      table: optimizationRuns,
      values: {
        status: "failed",
        errorMessage: recoveryInput.errorMessage,
        completedAt: expect.any(Date),
      },
    });
    const updateQuery = new MySqlDialect().sqlToQuery(fake.updates[0]?.condition as never);
    expect(updateQuery.params).toContain("running");
    expect(updateQuery.params.some((value) => String(value).includes("2026-10-28"))).toBe(true);
  });

  it("hides database errors from callers", async () => {
    const repository = createOptimizationRepository(async () => { throw new Error("mysql://private-secret"); });

    const error = await repository.recoverStaleRuns(recoveryInput).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OptimizationRecoveryError);
    expect((error as Error).message).not.toContain("private-secret");
  });
});
