import { describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { assignmentCsv, computeOrderRoute, explainSku, exportRunCsv, getOrderIds, makeSampleData, optimize, runBenchmark } from "./optimizer";
import { apiQueryState, completedRunResult, createDemoWorkspaceState, createOptimizationInput, createWarehouseAndRefresh, importAndRefresh, latestCompletedRunId, runAndRefresh, runLocalOptimization, runsOnBackend, trpcErrorMessage, workspaceSourceLabel } from "./workspace";

const weights = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2 };

describe("frontend workspace API helpers", () => {
  it("sends a selected persisted dataset ID with the supported algorithm configuration", () => {
    expect(createOptimizationInput(73, "local_search", weights, 125)).toEqual({
      datasetVersionId: 73,
      algorithmKey: "local_search",
      parameters: { ...weights, timeLimitMs: 2000, seed: 42, maxIterations: 125 },
    });
    expect(createOptimizationInput(73, "greedy", weights, 125)).toEqual({
      datasetVersionId: 73,
      algorithmKey: "greedy",
      parameters: { ...weights, timeLimitMs: 1000, seed: 42 },
    });
  });

  it("uses backend results only when a server run is complete", () => {
    const result = optimize(makeSampleData());
    expect(completedRunResult({ status: "succeeded", result })).toBe(result);
    expect(completedRunResult({ status: "running", result })).toBeNull();
    expect(completedRunResult({ status: "failed", result: null })).toBeNull();
  });

  it("selects the newest successful item from the retrieved run history", () => {
    expect(latestCompletedRunId([
      { id: 12, status: "failed" },
      { id: 11, status: "succeeded" },
      { id: 10, status: "succeeded" },
    ])).toBe(11);
    expect(latestCompletedRunId([{ id: 12, status: "running" }])).toBeNull();
    expect(latestCompletedRunId(undefined)).toBeNull();
  });

  it("waits for successful imports and runs before refreshing server data", async () => {
    const result = optimize(makeSampleData());
    const savedVersion = { id: 11, status: "ready" };
    const importBundle = async (input: { warehouseId: number }) => ({ ...savedVersion, warehouseId: input.warehouseId });
    const refreshVersions = vi.fn(async () => undefined);
    await expect(importAndRefresh(importBundle, refreshVersions, { warehouseId: 4 })).resolves.toEqual({ value: { ...savedVersion, warehouseId: 4 }, refreshError: null });
    expect(refreshVersions).toHaveBeenCalledOnce();

    const runRequest = vi.fn(async () => ({ id: 92, status: "succeeded", result }));
    const refreshHistory = vi.fn(async () => undefined);
    const response = await runAndRefresh(runRequest, refreshHistory, { datasetVersionId: 11 });
    expect(response.result).toBe(result);
    expect(runRequest).toHaveBeenCalledWith({ datasetVersionId: 11 });
    expect(refreshHistory).toHaveBeenCalledOnce();

    const createWarehouse = vi.fn(async (input: { name: string }) => ({ id: 3, name: input.name }));
    const refreshWarehouses = vi.fn(async () => undefined);
    await expect(createWarehouseAndRefresh(createWarehouse, refreshWarehouses, { name: "North DC" })).resolves.toEqual({ value: { id: 3, name: "North DC" }, refreshError: null });
    expect(refreshWarehouses).toHaveBeenCalledOnce();

    const failedRefresh = vi.fn(async () => undefined);
    await expect(importAndRefresh(async () => { throw new Error("validation failed"); }, failedRefresh, {})).rejects.toThrow("validation failed");
    expect(failedRefresh).not.toHaveBeenCalled();
    const failedRun = new Error("Optimization failed. Check the run history before retrying.");
    const refreshFailedRunHistory = vi.fn(async () => undefined);
    await expect(runAndRefresh(async () => { throw failedRun; }, refreshFailedRunHistory, { datasetVersionId: 11 }))
      .rejects.toBe(failedRun);
    expect(refreshFailedRunHistory).toHaveBeenCalledOnce();
    const unavailableFailedRunHistory = vi.fn(async () => { throw new Error("history unavailable"); });
    await expect(runAndRefresh(async () => { throw failedRun; }, unavailableFailedRunHistory, { datasetVersionId: 11 }))
      .rejects.toBe(failedRun);
    expect(unavailableFailedRunHistory).toHaveBeenCalledOnce();
    const unavailableRefresh = vi.fn(async () => { throw new Error("refresh unavailable"); });
    await expect(importAndRefresh(importBundle, unavailableRefresh, { warehouseId: 4 })).resolves.toMatchObject({
      value: { id: 11, warehouseId: 4 },
      refreshError: expect.any(Error),
    });
    await expect(runAndRefresh(async () => ({ id: 1, status: "failed", result: null }), failedRefresh, {})).rejects.toThrow("completed optimization result");
  });

  it("exposes loading, error, empty, and ready states for warehouse queries", () => {
    expect(apiQueryState({ isLoading: true, isError: false, hasData: false })).toBe("loading");
    expect(apiQueryState({ isLoading: false, isError: true, hasData: false })).toBe("error");
    expect(apiQueryState({ isLoading: false, isError: false, hasData: false })).toBe("empty");
    expect(apiQueryState({ isLoading: false, isError: false, hasData: true })).toBe("ready");
  });

  it("keeps demo and draft modes local and labels them separately from saved data", () => {
    expect(runsOnBackend("persisted")).toBe(true);
    expect(runsOnBackend("demo")).toBe(false);
    expect(runsOnBackend("draft")).toBe(false);
    expect(workspaceSourceLabel("demo")).toContain("Synthetic demo");
    expect(workspaceSourceLabel("draft")).toContain("not saved");
    expect(workspaceSourceLabel("persisted")).toContain("backend");
  });

  it("activates and resets the demo workspace before running both algorithms and dependent features", () => {
    const data = makeSampleData();
    const localWeights = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2 };
    const reset = createDemoWorkspaceState(data);
    const greedy = runLocalOptimization(data, "greedy", localWeights, 500);
    const localSearch = reset.run;

    expect(runsOnBackend("demo")).toBe(false);
    expect(reset).toMatchObject({
      data,
      dataSource: "demo",
      scrollTarget: "datasets",
      selectedDatasetVersionId: null,
      selectedRunId: null,
      selectedSkuId: null,
      selectedAlgo: "local_search",
      maxIterations: 500,
      activeDataset: "layout",
      mapMode: "optimized",
      selectedLocation: data.layout[0]!.location_id,
      selectedOrderId: getOrderIds(data)[0],
      benchmark: null,
      notice: expect.stringContaining("36 locations, 36 SKUs, 120 sample orders"),
    });
    expect(data.layout).toHaveLength(36);
    expect(data.skus).toHaveLength(36);
    expect(new Set(data.orders.map((order) => order.order_id)).size).toBe(120);
    for (const run of [greedy, localSearch]) {
      expect(run.validation.valid).toBe(true);
      expect(run.assignments).toHaveLength(data.skus.length);
      expect(run.optimized.constraintViolations).toBe(0);
      expect(assignmentCsv(run)).toContain("sku_id");
      expect(exportRunCsv(run)).toContain("total_distance");
    }

    expect(explainSku(data, localSearch, data.skus[0]!.sku_id)).not.toBeNull();
    expect(computeOrderRoute(data, localSearch, getOrderIds(data)[0]!)).not.toBeNull();
    const comparison = runBenchmark(data);
    expect(comparison.greedy.feasible).toBe(true);
    expect(comparison.localSearch.feasible).toBe(true);
  });

  it("shows safe API failures without inventing details", () => {
    expect(trpcErrorMessage(new Error("Dataset validation failed: invalid SKU"), "fallback"))
      .toBe("Dataset validation failed: invalid SKU");
    expect(trpcErrorMessage(null, "fallback")).toBe("fallback");
    const validationError = TRPCClientError.from({
      error: {
        message: "Dataset validation failed: orders.invalid_reference",
        code: -32600,
        data: { code: -32600, httpStatus: 400, path: "datasets.importBundle" },
      },
    });
    expect(trpcErrorMessage(validationError, "fallback")).toContain("Dataset validation failed");
    const expiredSession = TRPCClientError.from({
      error: {
        message: "Please login (10001)",
        code: -32001,
        data: { code: -32001, httpStatus: 401, path: "warehouses.list" },
      },
    });
    expect(trpcErrorMessage(expiredSession, "fallback")).toContain("session is unavailable or expired");
  });
});
