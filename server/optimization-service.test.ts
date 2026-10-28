import { describe, expect, it, vi } from "vitest";
import { makeSampleData } from "../client/src/lib/optimizer";
import { createOptimizationService, DatasetVersionUnavailableError, OptimizationExecutionError, OptimizationValidationError, ROUTE_ASSUMPTIONS, staleOptimizationRunAgeMs } from "./optimization-service";
import type { OptimizationRepository, PersistedOptimizationRun } from "./optimization-repository";
import type { OptimizationServiceDependencies } from "./optimization-service";
import type { WarehouseRepository } from "./warehouse-repository";

const parameters = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 1000, seed: 42 };

function readyDataset(data = makeSampleData()) {
  const now = new Date("2026-10-28T00:00:00Z");
  return {
    id: 17,
    warehouseId: 3,
    versionNumber: 1,
    source: "sample" as const,
    status: "ready" as const,
    layoutCount: data.layout.length,
    skuCount: data.skus.length,
    orderLineCount: data.orders.length,
    validationReport: null,
    createdAt: now,
    validatedAt: now,
    data,
  };
}

function dependencies(overrides: Partial<OptimizationServiceDependencies> = {}) {
  let completedRun: PersistedOptimizationRun | null = null;
  const defaults: OptimizationServiceDependencies = {
    getVersion: vi.fn(async () => readyDataset()),
    createRunningRun: vi.fn(async () => 42),
    completeRun: vi.fn(async ({ run, objectives }) => {
      completedRun = {
        id: 42,
        datasetVersionId: 17,
        status: "succeeded",
        algorithmKey: "greedy",
        algorithmName: run.algorithm,
        parameters: run.parameters,
        routeAssumptions: ROUTE_ASSUMPTIONS,
        optimizerVersion: "1.0.0",
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        runtimeMs: run.runtimeMs ?? null,
        errorMessage: null,
        objectives,
        result: run,
      };
    }),
    failRun: vi.fn(async () => true),
    recoverStaleRuns: vi.fn(async () => 0),
    getRun: vi.fn(async () => completedRun),
    listRuns: vi.fn(async () => []),
  };
  return { ...defaults, ...overrides };
}

describe("server optimization service", () => {
  it("uses a generous configurable stale-run age with safe bounds", () => {
    expect(staleOptimizationRunAgeMs(undefined)).toBe(15 * 60_000);
    expect(staleOptimizationRunAgeMs("300000")).toBe(5 * 60_000);
    expect(staleOptimizationRunAgeMs("86400000")).toBe(24 * 60 * 60_000);
    expect(staleOptimizationRunAgeMs("1000")).toBe(15 * 60_000);
    expect(staleOptimizationRunAgeMs("not-a-number")).toBe(15 * 60_000);
  });

  it("runs the existing greedy optimizer and persists its validated baseline and result", async () => {
    const deps = dependencies();
    const service = createOptimizationService(deps);
    const result = await service.run(29, { datasetVersionId: 17, algorithmKey: "greedy", parameters });

    expect(deps.getVersion).toHaveBeenCalledWith(29, 17);
    expect(deps.createRunningRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: 29,
      datasetVersionId: 17,
      algorithmKey: "greedy",
      parameters,
      routeAssumptions: ROUTE_ASSUMPTIONS,
    }));
    expect(deps.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: 29,
      runId: 42,
      run: expect.objectContaining({
        runId: "42",
        datasetVersion: "17",
        validation: expect.objectContaining({ valid: true, failed: 0 }),
      }),
      objectives: { baseline: expect.any(Number), optimized: expect.any(Number) },
    }));
    expect(result.status).toBe("succeeded");
    expect(result.result?.baselineAssignments).toHaveLength(36);
    expect(result.result?.assignments.every((assignment) => assignment.reason.length > 0 && Number.isFinite(assignment.score))).toBe(true);
    expect(deps.failRun).not.toHaveBeenCalled();
  });

  it("uses the existing pairwise local search and keeps its termination metadata", async () => {
    const deps = dependencies();
    const service = createOptimizationService(deps);
    const result = await service.run(29, {
      datasetVersionId: 17,
      algorithmKey: "local_search",
      parameters: { ...parameters, timeLimitMs: 100, maxIterations: 50 },
    });

    expect(deps.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({
        algorithm: "Greedy + local search (pairwise swap)",
        iterations: expect.any(Number),
        swapsAccepted: expect.any(Number),
        converged: expect.any(Boolean),
        stopReason: expect.stringMatching(/^(converged|iteration_limit|time_limit)$/),
      }),
    }));
    expect(result.result?.stopReason).toBeDefined();
  });

  it("rejects a dataset version not visible to the requesting user before creating a run", async () => {
    const deps = dependencies({ getVersion: vi.fn(async () => null) as unknown as WarehouseRepository["getVersion"] });
    const service = createOptimizationService(deps);
    await expect(service.run(30, { datasetVersionId: 17, algorithmKey: "greedy", parameters })).rejects.toBeInstanceOf(DatasetVersionUnavailableError);
    expect(deps.createRunningRun).not.toHaveBeenCalled();
  });

  it("marks invalid persisted data failed and does not save partial results", async () => {
    const invalid = readyDataset({ layout: [], skus: [], orders: [] });
    const deps = dependencies({ getVersion: vi.fn(async () => invalid) as unknown as WarehouseRepository["getVersion"] });
    const service = createOptimizationService(deps);
    await expect(service.run(29, { datasetVersionId: 17, algorithmKey: "greedy", parameters })).rejects.toBeInstanceOf(OptimizationValidationError);
    expect(deps.failRun).toHaveBeenCalledWith(expect.objectContaining({
      userId: 29,
      runId: 42,
      errorMessage: "Optimization results failed validation.",
      validationReport: expect.objectContaining({ valid: false }),
    }));
    expect(deps.completeRun).not.toHaveBeenCalled();
  });

  it("records a safe failed run when atomic result persistence fails", async () => {
    const deps = dependencies({ completeRun: vi.fn(async () => { throw new Error("mysql://secret-value"); }) });
    const service = createOptimizationService(deps);
    await expect(service.run(29, { datasetVersionId: 17, algorithmKey: "greedy", parameters })).rejects.toBeInstanceOf(OptimizationExecutionError);
    expect(deps.failRun).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: "Optimization results could not be saved.",
      runtimeMs: expect.any(Number),
    }));
    expect(deps.failRun.mock.calls[0]?.[0].errorMessage).not.toContain("secret-value");
  });

  it("runs stale recovery before returning scoped run history", async () => {
    const deps = dependencies();
    const service = createOptimizationService(deps);
    const before = Date.now();
    await service.list(29, { datasetVersionId: 17, limit: 25 });

    expect(deps.recoverStaleRuns).toHaveBeenCalledOnce();
    const recovery = deps.recoverStaleRuns.mock.calls[0]?.[0];
    expect(recovery).toMatchObject({
      userId: 29,
      datasetVersionId: 17,
      errorMessage: "Run abandoned after 15 minutes without completion. It may have been interrupted; retry the optimization.",
    });
    expect(recovery?.staleBefore.getTime()).toBeGreaterThanOrEqual(before - 15 * 60_000 - 100);
    expect(recovery?.staleBefore.getTime()).toBeLessThanOrEqual(Date.now() - 15 * 60_000);
    expect(deps.listRuns).toHaveBeenCalledWith(29, { datasetVersionId: 17, limit: 25 });
  });
});
