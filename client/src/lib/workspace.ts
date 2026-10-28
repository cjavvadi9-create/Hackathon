import { TRPCClientError } from "@trpc/client";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import type { OptimizationParameters } from "../../../drizzle/schema";
import type { OptimizationRun } from "./optimizer";

export type WorkspaceMode = "demo" | "draft" | "persisted";

export function createOptimizationInput(
  datasetVersionId: number,
  algorithmKey: "greedy" | "local_search",
  weights: Pick<OptimizationParameters, "travelWeight" | "cooccurrenceWeight" | "demandWeight">,
  maxIterations: number,
) {
  return {
    datasetVersionId,
    algorithmKey,
    parameters: algorithmKey === "local_search"
      ? { ...weights, timeLimitMs: 2000, seed: 42, maxIterations }
      : { ...weights, timeLimitMs: 1000, seed: 42 },
  };
}

export function completedRunResult(response: { status: string; result: OptimizationRun | null }): OptimizationRun | null {
  return response.status === "succeeded" ? response.result : null;
}

export function latestCompletedRunId(runs: ReadonlyArray<{ id: number; status: string }> | undefined): number | null {
  return runs?.find((run) => run.status === "succeeded")?.id ?? null;
}

export function runsOnBackend(source: WorkspaceMode): boolean {
  return source === "persisted";
}

export function apiQueryState(input: { isLoading: boolean; isError: boolean; hasData: boolean }): "loading" | "error" | "ready" | "empty" {
  if (input.isLoading) return "loading";
  if (input.isError) return "error";
  return input.hasData ? "ready" : "empty";
}

export async function importAndRefresh<Input, Output>(
  importBundle: (input: Input) => Promise<Output>,
  refresh: () => Promise<unknown>,
  input: Input,
): Promise<{ value: Output; refreshError: unknown | null }> {
  const saved = await importBundle(input);
  try {
    await refresh();
    return { value: saved, refreshError: null };
  } catch (refreshError) {
    return { value: saved, refreshError };
  }
}

export async function createWarehouseAndRefresh<Input, Output>(
  createWarehouse: (input: Input) => Promise<Output>,
  refreshWarehouses: () => Promise<unknown>,
  input: Input,
): Promise<{ value: Output; refreshError: unknown | null }> {
  const created = await createWarehouse(input);
  try {
    await refreshWarehouses();
    return { value: created, refreshError: null };
  } catch (refreshError) {
    return { value: created, refreshError };
  }
}

export async function runAndRefresh<Input, Response extends { status: string; result: OptimizationRun | null }>(
  run: (input: Input) => Promise<Response>,
  refreshHistory: () => Promise<unknown>,
  input: Input,
): Promise<{ response: Response; result: OptimizationRun; refreshError: unknown | null }> {
  let response: Response;
  try {
    response = await run(input);
  } catch (error) {
    // The server may have persisted a failed run before rejecting the mutation.
    // Refresh once, but keep the mutation error as the error shown to the user.
    try {
      await refreshHistory();
    } catch {
      // History may be unavailable too; do not mask the original run failure.
    }
    throw error;
  }
  const result = completedRunResult(response);
  if (!result) throw new Error("The server did not return a completed optimization result.");
  try {
    await refreshHistory();
    return { response, result, refreshError: null };
  } catch (refreshError) {
    return { response, result, refreshError };
  }
}

export function trpcErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TRPCClientError) {
    if (error.data?.httpStatus === 401 || error.message === UNAUTHED_ERR_MSG) return "Your session is unavailable or expired. Sign in again to use saved warehouse data.";
    if (error.data?.httpStatus === 404) return "The selected warehouse, dataset, or run is no longer available to this account.";
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export function workspaceSourceLabel(source: WorkspaceMode): string {
  if (source === "persisted") return "Saved backend dataset";
  if (source === "draft") return "Local draft · not saved";
  return "Synthetic demo data";
}
