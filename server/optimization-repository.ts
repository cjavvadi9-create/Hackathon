import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm";
import {
  datasetVersions,
  optimizationRuns,
  runAssignments,
  runMetrics,
  skus,
  warehouseLocations,
  warehouses,
  type OptimizationParameters,
  type RouteAssumptions,
} from "../drizzle/schema";
import type { Assignment, OptimizationRun, RunMetrics, ValidationReport } from "../client/src/lib/optimizer";
import { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DatabaseProvider = () => Promise<Database | null>;
const WRITE_BATCH_SIZE = 500;

export type OptimizationAlgorithmKey = "greedy" | "local_search";
export type RunStatus = "queued" | "running" | "succeeded" | "failed";
export type ObjectiveValues = { baseline: number; optimized: number };
export type RunMetricsWithObjective = RunMetrics & { objective: number };

export type PersistedOptimizationRun = {
  id: number;
  datasetVersionId: number;
  status: RunStatus;
  algorithmKey: OptimizationAlgorithmKey;
  algorithmName: string;
  parameters: OptimizationParameters;
  routeAssumptions: RouteAssumptions;
  optimizerVersion: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  runtimeMs: number | null;
  errorMessage: string | null;
  objectives: ObjectiveValues | null;
  result: OptimizationRun | null;
};

export type OptimizationRunListItem = Omit<PersistedOptimizationRun, "routeAssumptions" | "optimizerVersion" | "startedAt" | "objectives" | "result"> & {
  metrics: { baseline: RunMetricsWithObjective; optimized: RunMetricsWithObjective } | null;
};

export type CreateRunningRunInput = {
  userId: number;
  datasetVersionId: number;
  algorithmKey: OptimizationAlgorithmKey;
  algorithmName: string;
  parameters: OptimizationParameters;
  routeAssumptions: RouteAssumptions;
  optimizerVersion: string;
};

export type CompleteRunInput = {
  userId: number;
  runId: number;
  run: OptimizationRun;
  objectives: ObjectiveValues;
};

export type FailRunInput = {
  userId: number;
  runId: number;
  errorMessage: string;
  validationReport?: ValidationReport;
  runtimeMs?: number;
  iterations?: number;
  swapsAccepted?: number;
  converged?: boolean;
  stopReason?: OptimizationRun["stopReason"];
  reasons?: string[];
};

export type RecoverStaleRunsInput = {
  userId: number;
  staleBefore: Date;
  errorMessage: string;
  datasetVersionId?: number;
};

export class OptimizationRecoveryError extends Error {
  constructor() {
    super("Unable to recover stale optimization runs");
    this.name = "OptimizationRecoveryError";
  }
}

export type OptimizationRepository = {
  createRunningRun(input: CreateRunningRunInput): Promise<number | null>;
  completeRun(input: CompleteRunInput): Promise<void>;
  failRun(input: FailRunInput): Promise<boolean>;
  recoverStaleRuns(input: RecoverStaleRunsInput): Promise<number>;
  getRun(userId: number, runId: number): Promise<PersistedOptimizationRun | null>;
  listRuns(userId: number, options: { datasetVersionId?: number; limit: number; beforeRunId?: number }): Promise<OptimizationRunListItem[]>;
};

function numeric(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function chunks<T>(rows: T[], limit = WRITE_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < rows.length; start += limit) batches.push(rows.slice(start, start + limit));
  return batches;
}

function metricFromRow(row: typeof runMetrics.$inferSelect): RunMetricsWithObjective {
  return {
    objective: Number(row.objective),
    totalDistance: Number(row.totalDistance),
    averageDistance: Number(row.averageDistance),
    averagePickSeconds: Number(row.averagePickSeconds),
    throughput: Number(row.throughput),
    capacityUtilization: Number(row.capacityUtilization),
    validAssignments: Number(row.validAssignments),
    constraintViolations: Number(row.constraintViolations),
  };
}

function metricsByScope(rows: (typeof runMetrics.$inferSelect)[]) {
  const baseline = rows.find((row) => row.scope === "baseline");
  const optimized = rows.find((row) => row.scope === "optimized");
  return baseline && optimized
    ? { baseline: metricFromRow(baseline), optimized: metricFromRow(optimized) }
    : null;
}

function publicRun(row: typeof optimizationRuns.$inferSelect): Omit<PersistedOptimizationRun, "objectives" | "result"> {
  return {
    id: Number(row.id),
    datasetVersionId: Number(row.datasetVersionId),
    status: row.status,
    algorithmKey: row.algorithmKey,
    algorithmName: row.algorithmName,
    parameters: row.parameters,
    routeAssumptions: row.routeAssumptions,
    optimizerVersion: row.optimizerVersion,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    runtimeMs: numeric(row.runtimeMs),
    errorMessage: row.errorMessage,
  };
}

export function createOptimizationRepository(databaseProvider: DatabaseProvider = getDb): OptimizationRepository {
  return {
    async createRunningRun(input) {
      const db = await databaseProvider();
      if (!db) throw new Error("Database is not available");
      return db.transaction(async (tx) => {
        const [version] = await tx.select({ id: datasetVersions.id })
          .from(datasetVersions)
          .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
          .where(and(
            eq(datasetVersions.id, input.datasetVersionId),
            eq(datasetVersions.status, "ready"),
            eq(warehouses.ownerUserId, input.userId),
          ))
          .limit(1)
          .for("update");
        if (!version) return null;

        const [inserted] = await tx.insert(optimizationRuns).values({
          datasetVersionId: input.datasetVersionId,
          requestedByUserId: input.userId,
          algorithmKey: input.algorithmKey,
          algorithmName: input.algorithmName,
          parameters: input.parameters,
          routeAssumptions: input.routeAssumptions,
          optimizerVersion: input.optimizerVersion,
          status: "running",
          reasons: [],
          startedAt: new Date(),
        }).$returningId();
        return Number(inserted.id);
      });
    },

    async completeRun(input) {
      const db = await databaseProvider();
      if (!db) throw new Error("Database is not available");
      await db.transaction(async (tx) => {
        const [ownedRun] = await tx.select({
          id: optimizationRuns.id,
          datasetVersionId: optimizationRuns.datasetVersionId,
        }).from(optimizationRuns)
          .innerJoin(datasetVersions, eq(optimizationRuns.datasetVersionId, datasetVersions.id))
          .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
          .where(and(
            eq(optimizationRuns.id, input.runId),
            eq(optimizationRuns.requestedByUserId, input.userId),
            eq(warehouses.ownerUserId, input.userId),
            eq(datasetVersions.status, "ready"),
            eq(optimizationRuns.status, "running"),
          ))
          .limit(1)
          .for("update");
        if (!ownedRun) throw new Error("Optimization run is not available");

        const [skuRows, locationRows] = await Promise.all([
          tx.select({ id: skus.id, skuId: skus.skuId }).from(skus)
            .where(eq(skus.datasetVersionId, ownedRun.datasetVersionId)),
          tx.select({ id: warehouseLocations.id, locationId: warehouseLocations.locationId }).from(warehouseLocations)
            .where(eq(warehouseLocations.datasetVersionId, ownedRun.datasetVersionId)),
        ]);
        const skuIds = new Map(skuRows.map((row) => [row.skuId, Number(row.id)]));
        const locationIds = new Map(locationRows.map((row) => [row.locationId, Number(row.id)]));

        const toRows = (assignments: Assignment[], scope: "baseline" | "optimized") => assignments.map((assignment) => {
          const skuId = skuIds.get(assignment.sku_id);
          const locationId = assignment.location_id === "UNASSIGNED" ? null : locationIds.get(assignment.location_id);
          if (skuId === undefined || (assignment.location_id !== "UNASSIGNED" && locationId === undefined)) {
            throw new Error("Optimization result references an unknown dataset row");
          }
          return {
            datasetVersionId: ownedRun.datasetVersionId,
            optimizationRunId: input.runId,
            scope,
            skuId,
            locationId,
            score: assignment.score,
            reason: assignment.reason,
          };
        });
        const assignmentRows = [
          ...toRows(input.run.baselineAssignments, "baseline"),
          ...toRows(input.run.assignments, "optimized"),
        ];
        for (const batch of chunks(assignmentRows)) await tx.insert(runAssignments).values(batch);

        await tx.insert(runMetrics).values([
          { optimizationRunId: input.runId, scope: "baseline", objective: input.objectives.baseline, ...input.run.baseline },
          { optimizationRunId: input.runId, scope: "optimized", objective: input.objectives.optimized, ...input.run.optimized },
        ]);

        await tx.update(optimizationRuns).set({
          status: "succeeded",
          runtimeMs: input.run.runtimeMs ?? 0,
          iterations: input.run.iterations ?? null,
          swapsAccepted: input.run.swapsAccepted ?? null,
          converged: input.run.converged ?? null,
          stopReason: input.run.stopReason ?? null,
          reasons: input.run.reasons,
          validationReport: input.run.validation,
          completedAt: new Date(),
        }).where(and(
          eq(optimizationRuns.id, input.runId),
          eq(optimizationRuns.requestedByUserId, input.userId),
          eq(optimizationRuns.status, "running"),
        ));
        const [updated] = await tx.select({ id: optimizationRuns.id }).from(optimizationRuns)
          .where(and(
            eq(optimizationRuns.id, input.runId),
            eq(optimizationRuns.requestedByUserId, input.userId),
            eq(optimizationRuns.status, "succeeded"),
          )).limit(1);
        if (!updated) throw new Error("Optimization run could not be completed");
      });
    },

    async failRun(input) {
      const db = await databaseProvider();
      if (!db) throw new Error("Database is not available");
      return db.transaction(async (tx) => {
        const [ownedRun] = await tx.select({ id: optimizationRuns.id }).from(optimizationRuns)
          .innerJoin(datasetVersions, eq(optimizationRuns.datasetVersionId, datasetVersions.id))
          .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
          .where(and(
            eq(optimizationRuns.id, input.runId),
            eq(optimizationRuns.requestedByUserId, input.userId),
            eq(warehouses.ownerUserId, input.userId),
            eq(optimizationRuns.status, "running"),
          )).limit(1).for("update");
        if (!ownedRun) return false;
        await tx.update(optimizationRuns).set({
          status: "failed",
          errorMessage: input.errorMessage.slice(0, 1000),
          validationReport: input.validationReport ?? null,
          runtimeMs: input.runtimeMs ?? null,
          iterations: input.iterations ?? null,
          swapsAccepted: input.swapsAccepted ?? null,
          converged: input.converged ?? null,
          stopReason: input.stopReason ?? null,
          reasons: input.reasons ?? [],
          completedAt: new Date(),
        }).where(and(
          eq(optimizationRuns.id, input.runId),
          eq(optimizationRuns.status, "running"),
        ));
        const [updated] = await tx.select({ id: optimizationRuns.id }).from(optimizationRuns)
          .where(and(eq(optimizationRuns.id, input.runId), eq(optimizationRuns.status, "failed"))).limit(1);
        return Boolean(updated);
      });
    },

    async recoverStaleRuns(input) {
      try {
        const db = await databaseProvider();
        if (!db) throw new Error("Database is not available");
        return await db.transaction(async (tx) => {
          const conditions = [
            eq(optimizationRuns.requestedByUserId, input.userId),
            eq(warehouses.ownerUserId, input.userId),
            eq(optimizationRuns.status, "running"),
            lt(optimizationRuns.startedAt, input.staleBefore),
          ];
          if (input.datasetVersionId !== undefined) {
            conditions.push(eq(optimizationRuns.datasetVersionId, input.datasetVersionId));
          }
          const staleRows = await tx.select({ id: optimizationRuns.id })
            .from(optimizationRuns)
            .innerJoin(datasetVersions, eq(optimizationRuns.datasetVersionId, datasetVersions.id))
            .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
            .where(and(...conditions))
            .for("update");

          let recovered = 0;
          for (const row of staleRows) {
            // Recheck both state and age in the write so a concurrent completion/failure wins.
            await tx.update(optimizationRuns).set({
              status: "failed",
              errorMessage: input.errorMessage.slice(0, 1000),
              completedAt: new Date(),
            }).where(and(
              eq(optimizationRuns.id, row.id),
              eq(optimizationRuns.requestedByUserId, input.userId),
              eq(optimizationRuns.status, "running"),
              lt(optimizationRuns.startedAt, input.staleBefore),
            ));
            recovered += 1;
          }
          return recovered;
        });
      } catch {
        // Do not propagate database or driver messages, which may contain connection details.
        throw new OptimizationRecoveryError();
      }
    },

    async getRun(userId, runId) {
      const db = await databaseProvider();
      if (!db) throw new Error("Database is not available");
      const [row] = await db.select({ run: optimizationRuns, skuCount: datasetVersions.skuCount }).from(optimizationRuns)
        .innerJoin(datasetVersions, eq(optimizationRuns.datasetVersionId, datasetVersions.id))
        .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
        .where(and(
          eq(optimizationRuns.id, runId),
          eq(optimizationRuns.requestedByUserId, userId),
          eq(warehouses.ownerUserId, userId),
          eq(datasetVersions.status, "ready"),
        )).limit(1);
      if (!row) return null;
      const base = publicRun(row.run);
      if (row.run.status !== "succeeded") return { ...base, objectives: null, result: null };

      const [metricRows, assignmentRows] = await Promise.all([
        db.select().from(runMetrics).where(eq(runMetrics.optimizationRunId, runId)),
        db.select({
          scope: runAssignments.scope,
          skuId: skus.skuId,
          locationId: warehouseLocations.locationId,
          score: runAssignments.score,
          reason: runAssignments.reason,
        }).from(runAssignments)
          .innerJoin(skus, and(
            eq(runAssignments.datasetVersionId, skus.datasetVersionId),
            eq(runAssignments.skuId, skus.id),
          ))
          .leftJoin(warehouseLocations, and(
            eq(runAssignments.datasetVersionId, warehouseLocations.datasetVersionId),
            eq(runAssignments.locationId, warehouseLocations.id),
          ))
          .where(eq(runAssignments.optimizationRunId, runId))
          .orderBy(asc(runAssignments.id)),
      ]);
      const objectives = metricsByScope(metricRows);
      if (!objectives || !row.run.validationReport?.valid) throw new Error("Stored optimization result is incomplete");
      const assignments = (scope: "baseline" | "optimized") => assignmentRows
        .filter((assignment) => assignment.scope === scope)
        .map((assignment) => ({
          sku_id: assignment.skuId,
          location_id: assignment.locationId ?? "UNASSIGNED",
          score: Number(assignment.score),
          reason: assignment.reason,
        }));
      const baselineAssignments = assignments("baseline");
      const optimizedAssignments = assignments("optimized");
      const expectedAssignments = Number(row.skuCount);
      if (baselineAssignments.length !== expectedAssignments || optimizedAssignments.length !== expectedAssignments) {
        throw new Error("Stored optimization assignments are incomplete");
      }
      const result: OptimizationRun = {
        runId: String(row.run.id),
        timestamp: (row.run.startedAt ?? row.run.createdAt).toISOString(),
        datasetVersion: String(row.run.datasetVersionId),
        algorithm: row.run.algorithmName,
        parameters: row.run.parameters,
        baseline: {
          totalDistance: objectives.baseline.totalDistance,
          averageDistance: objectives.baseline.averageDistance,
          averagePickSeconds: objectives.baseline.averagePickSeconds,
          throughput: objectives.baseline.throughput,
          capacityUtilization: objectives.baseline.capacityUtilization,
          validAssignments: objectives.baseline.validAssignments,
          constraintViolations: objectives.baseline.constraintViolations,
        },
        optimized: {
          totalDistance: objectives.optimized.totalDistance,
          averageDistance: objectives.optimized.averageDistance,
          averagePickSeconds: objectives.optimized.averagePickSeconds,
          throughput: objectives.optimized.throughput,
          capacityUtilization: objectives.optimized.capacityUtilization,
          validAssignments: objectives.optimized.validAssignments,
          constraintViolations: objectives.optimized.constraintViolations,
        },
        assignments: optimizedAssignments,
        baselineAssignments,
        validation: row.run.validationReport as ValidationReport,
        reasons: row.run.reasons,
        ...(row.run.runtimeMs === null ? {} : { runtimeMs: Number(row.run.runtimeMs) }),
        ...(row.run.iterations === null ? {} : { iterations: Number(row.run.iterations) }),
        ...(row.run.swapsAccepted === null ? {} : { swapsAccepted: Number(row.run.swapsAccepted) }),
        ...(row.run.converged === null ? {} : { converged: row.run.converged }),
        ...(row.run.stopReason === null ? {} : { stopReason: row.run.stopReason }),
      };
      return { ...base, objectives: { baseline: objectives.baseline.objective, optimized: objectives.optimized.objective }, result };
    },

    async listRuns(userId, options) {
      const db = await databaseProvider();
      if (!db) throw new Error("Database is not available");
      const conditions = [
        eq(optimizationRuns.requestedByUserId, userId),
        eq(warehouses.ownerUserId, userId),
        eq(datasetVersions.status, "ready"),
      ];
      if (options.datasetVersionId !== undefined) conditions.push(eq(optimizationRuns.datasetVersionId, options.datasetVersionId));
      if (options.beforeRunId !== undefined) conditions.push(lt(optimizationRuns.id, options.beforeRunId));
      const rows = await db.select({ run: optimizationRuns, skuCount: datasetVersions.skuCount }).from(optimizationRuns)
        .innerJoin(datasetVersions, eq(optimizationRuns.datasetVersionId, datasetVersions.id))
        .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
        .where(and(...conditions)).orderBy(desc(optimizationRuns.id)).limit(options.limit);
      if (!rows.length) return [];
      const ids = rows.map(({ run }) => Number(run.id));
      const [metricRows, assignmentCounts] = await Promise.all([
        db.select().from(runMetrics).where(inArray(runMetrics.optimizationRunId, ids)),
        db.select({ runId: runAssignments.optimizationRunId, scope: runAssignments.scope, total: count() })
          .from(runAssignments)
          .where(inArray(runAssignments.optimizationRunId, ids))
          .groupBy(runAssignments.optimizationRunId, runAssignments.scope),
      ]);
      const metricsForRun = new Map<number, (typeof runMetrics.$inferSelect)[]>();
      for (const metric of metricRows) metricsForRun.set(Number(metric.optimizationRunId), [...(metricsForRun.get(Number(metric.optimizationRunId)) ?? []), metric]);
      const assignmentCountsForRun = new Map<number, Map<string, number>>();
      for (const assignmentCount of assignmentCounts) {
        const runId = Number(assignmentCount.runId);
        const scopes = assignmentCountsForRun.get(runId) ?? new Map<string, number>();
        scopes.set(assignmentCount.scope, Number(assignmentCount.total));
        assignmentCountsForRun.set(runId, scopes);
      }
      return rows.map(({ run, skuCount }) => {
        const base = publicRun(run);
        const metrics = metricsByScope(metricsForRun.get(Number(run.id)) ?? []);
        if (run.status === "succeeded") {
          const assignments = assignmentCountsForRun.get(Number(run.id));
          const expected = Number(skuCount);
          if (!metrics || !run.validationReport?.valid || assignments?.get("baseline") !== expected || assignments.get("optimized") !== expected) {
            throw new Error("Stored optimization result is incomplete");
          }
        }
        return {
          id: base.id,
          datasetVersionId: base.datasetVersionId,
          status: base.status,
          algorithmKey: base.algorithmKey,
          algorithmName: base.algorithmName,
          parameters: base.parameters,
          createdAt: base.createdAt,
          completedAt: base.completedAt,
          runtimeMs: base.runtimeMs,
          errorMessage: base.errorMessage,
          metrics,
        };
      });
    },
  };
}

export const optimizationRepository = createOptimizationRepository();
