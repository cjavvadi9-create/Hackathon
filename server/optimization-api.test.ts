import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createAppRouter } from "./routers";
import type { OptimizationService } from "./optimization-service";
import type { PersistedOptimizationRun } from "./optimization-repository";

function context(userId: number | null): TrpcContext {
  const now = new Date("2026-10-28T00:00:00Z");
  return {
    user: userId === null ? null : {
      id: userId,
      openId: `user-${userId}`,
      email: null,
      name: null,
      loginMethod: null,
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie() {} } as TrpcContext["res"],
  };
}

function persistedRun(): PersistedOptimizationRun {
  return {
    id: 42,
    datasetVersionId: 17,
    status: "succeeded",
    algorithmKey: "greedy",
    algorithmName: "Demand + co-occurrence greedy heuristic",
    parameters: { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 1000, seed: 42 },
    routeAssumptions: { distanceModel: "euclidean_2d", depot: { x: 0, y: 0 }, stopOrdering: "timestamp_then_sku_id" },
    optimizerVersion: "1.0.0",
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    runtimeMs: 10,
    errorMessage: null,
    objectives: { baseline: 0.5, optimized: 0.4 },
    result: null,
  };
}

function optimizerService() {
  const service = {
    run: vi.fn(async () => persistedRun()),
    get: vi.fn(async () => persistedRun()),
    list: vi.fn(async () => []),
  };
  return { service: service as unknown as OptimizationService, calls: service };
}

describe("authenticated optimization API", () => {
  it("requires authentication for run, get, and list", async () => {
    const { service } = optimizerService();
    const caller = createAppRouter(undefined, service).createCaller(context(null));
    await expect(caller.optimization.run({ datasetVersionId: 17, algorithmKey: "greedy" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.optimization.get({ runId: 42 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.optimization.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("derives the requesting user and applies existing optimizer defaults", async () => {
    const { service, calls } = optimizerService();
    const caller = createAppRouter(undefined, service).createCaller(context(71));
    await caller.optimization.run({ datasetVersionId: 17, algorithmKey: "local_search" });
    expect(calls.run).toHaveBeenCalledWith(71, expect.objectContaining({
      datasetVersionId: 17,
      algorithmKey: "local_search",
      parameters: { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 2000, seed: 42, maxIterations: 500 },
    }));
    await expect(caller.optimization.run({ datasetVersionId: 17, algorithmKey: "greedy", userId: 99 } as never))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validates optimizer configuration and scopes get/list calls to ctx.user", async () => {
    const { service, calls } = optimizerService();
    const caller = createAppRouter(undefined, service).createCaller(context(71));
    await expect(caller.optimization.run({
      datasetVersionId: 17,
      algorithmKey: "greedy",
      parameters: { travelWeight: 2 },
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.optimization.get({ runId: 42 })).toMatchObject({ id: 42, status: "succeeded" });
    await caller.optimization.list({ datasetVersionId: 17, limit: 10, beforeRunId: 50 });
    expect(calls.get).toHaveBeenCalledWith(71, 42);
    expect(calls.list).toHaveBeenCalledWith(71, { datasetVersionId: 17, limit: 10, beforeRunId: 50 });
  });
});
