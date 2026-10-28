import {
  computeObjective,
  cooccurrence,
  optimize,
  optimizeLocalSearch,
  validateAssignments,
  validateDataset,
  type DatasetBundle,
  type OptimizationRun,
  type ValidationReport,
} from "../client/src/lib/optimizer";
import type { OptimizationParameters, RouteAssumptions } from "../drizzle/schema";
import { warehouseRepository } from "./warehouse-repository";
import {
  optimizationRepository,
  type OptimizationAlgorithmKey,
  type OptimizationRepository,
  type RecoverStaleRunsInput,
  type PersistedOptimizationRun,
} from "./optimization-repository";

export class DatasetVersionUnavailableError extends Error {
  constructor() {
    super("Dataset version is unavailable");
    this.name = "DatasetVersionUnavailableError";
  }
}

export class OptimizationValidationError extends Error {
  constructor(message: string, readonly report: ValidationReport) {
    super(message);
    this.name = "OptimizationValidationError";
  }
}

export class OptimizationExecutionError extends Error {
  constructor() {
    super("Optimization execution failed");
    this.name = "OptimizationExecutionError";
  }
}

export type OptimizationRequest = {
  datasetVersionId: number;
  algorithmKey: OptimizationAlgorithmKey;
  parameters: OptimizationParameters;
};

export type OptimizationServiceDependencies = {
  getVersion: typeof warehouseRepository.getVersion;
  createRunningRun: OptimizationRepository["createRunningRun"];
  completeRun: OptimizationRepository["completeRun"];
  failRun: OptimizationRepository["failRun"];
  recoverStaleRuns: OptimizationRepository["recoverStaleRuns"];
  getRun: OptimizationRepository["getRun"];
  listRuns: OptimizationRepository["listRuns"];
};

export type OptimizationService = ReturnType<typeof createOptimizationService>;

export const ROUTE_ASSUMPTIONS: RouteAssumptions = {
  distanceModel: "euclidean_2d",
  depot: { x: 0, y: 0 },
  stopOrdering: "timestamp_then_sku_id",
};

const OPTIMIZER_VERSION = "1.0.0";
const DEFAULT_STALE_RUN_AGE_MS = 15 * 60 * 1000;
const MIN_STALE_RUN_AGE_MS = 5 * 60 * 1000;
const MAX_STALE_RUN_AGE_MS = 24 * 60 * 60 * 1000;

// Solves are synchronous and can block the event loop, so an in-process heartbeat
// would not be reliable. This timestamp threshold leaves a wide margin over the
// optimizer's 120-second API limit; it remains a best-effort recovery heuristic.
// OPTIMIZATION_STALE_RUN_AGE_MS accepts 5 minutes through 24 hours; default is 15 minutes.
export function staleOptimizationRunAgeMs(configured = process.env.OPTIMIZATION_STALE_RUN_AGE_MS): number {
  if (!configured) return DEFAULT_STALE_RUN_AGE_MS;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < MIN_STALE_RUN_AGE_MS || value > MAX_STALE_RUN_AGE_MS) {
    return DEFAULT_STALE_RUN_AGE_MS;
  }
  return value;
}

function withBaselineValidation(run: OptimizationRun, data: DatasetBundle): ValidationReport {
  const dataset = validateDataset(data, true).report;
  const baseline = validateAssignments(data, run.baselineAssignments);
  const optimized = validateAssignments(data, run.assignments);
  return {
    valid: dataset.valid && baseline.valid && optimized.valid,
    checks: dataset.checks + baseline.checks + optimized.checks,
    passed: dataset.passed + baseline.passed + optimized.passed,
    failed: dataset.failed + baseline.failed + optimized.failed,
    issues: [
      ...dataset.issues,
      ...baseline.issues.map((issue) => ({ ...issue, message: `Baseline: ${issue.message}` })),
      ...optimized.issues.map((issue) => ({ ...issue, message: `Optimized: ${issue.message}` })),
    ],
  };
}

function validationErrorMessage(report: ValidationReport): string {
  const errors = report.issues.filter((issue) => issue.severity === "error").slice(0, 10);
  const details = errors.map((issue) => `${issue.dataset}.${issue.code}: ${issue.message.slice(0, 200)}`);
  return details.length ? `Optimization validation failed: ${details.join("; ")}` : "Optimization validation failed.";
}

export function createOptimizationService(
  dependencies: OptimizationServiceDependencies = {
    getVersion: warehouseRepository.getVersion,
    createRunningRun: optimizationRepository.createRunningRun,
    completeRun: optimizationRepository.completeRun,
    failRun: optimizationRepository.failRun,
    recoverStaleRuns: optimizationRepository.recoverStaleRuns,
    getRun: optimizationRepository.getRun,
    listRuns: optimizationRepository.listRuns,
  },
) {
  return {
    async run(userId: number, request: OptimizationRequest): Promise<PersistedOptimizationRun> {
      const dataset = await dependencies.getVersion(userId, request.datasetVersionId);
      if (!dataset || dataset.status !== "ready") throw new DatasetVersionUnavailableError();

      const runId = await dependencies.createRunningRun({
        userId,
        datasetVersionId: request.datasetVersionId,
        algorithmKey: request.algorithmKey,
        algorithmName: request.algorithmKey === "greedy" ? "Demand + co-occurrence greedy heuristic" : "Greedy + local search (pairwise swap)",
        parameters: request.parameters,
        routeAssumptions: ROUTE_ASSUMPTIONS,
        optimizerVersion: OPTIMIZER_VERSION,
      });
      if (runId === null) throw new DatasetVersionUnavailableError();

      const startedAt = performance.now();
      let lastRun: OptimizationRun | undefined;
      let lastValidation: ValidationReport | undefined;
      try {
        const datasetValidation = validateDataset(dataset.data, true).report;
        if (!datasetValidation.valid) throw new OptimizationValidationError(validationErrorMessage(datasetValidation), datasetValidation);

        const parameters = request.parameters;
        const computed = request.algorithmKey === "greedy"
          ? optimize(dataset.data, parameters)
          : optimizeLocalSearch(dataset.data, {
              ...parameters,
              maxIterations: parameters.maxIterations ?? 500,
            });
        const runtimeMs = Math.max(0, Math.round(performance.now() - startedAt));
        const validation = withBaselineValidation(computed, dataset.data);
        const result: OptimizationRun = {
          ...computed,
          runId: String(runId),
          datasetVersion: String(request.datasetVersionId),
          runtimeMs,
          validation,
        };
        lastRun = result;
        lastValidation = validation;
        if (!validation.valid) throw new OptimizationValidationError(validationErrorMessage(validation), validation);

        const { demand } = validateDataset(dataset.data, true);
        const co = cooccurrence(dataset.data);
        const objectives = {
          baseline: computeObjective(dataset.data, result.baselineAssignments, parameters, demand, co),
          optimized: computeObjective(dataset.data, result.assignments, parameters, demand, co),
        };
        await dependencies.completeRun({ userId, runId, run: result, objectives });
        const persisted = await dependencies.getRun(userId, runId);
        if (!persisted || persisted.status !== "succeeded" || !persisted.result) throw new Error("Completed run could not be read back");
        return persisted;
      } catch (error) {
        const runtimeMs = Math.max(0, Math.round(performance.now() - startedAt));
        const validationReport = error instanceof OptimizationValidationError ? error.report : lastValidation;
        const safeFailureMessage = error instanceof OptimizationValidationError
          ? "Optimization results failed validation."
          : lastRun
            ? "Optimization results could not be saved."
            : "Optimization execution failed.";
        try {
          await dependencies.failRun({
            userId,
            runId,
            errorMessage: safeFailureMessage,
            ...(validationReport ? { validationReport } : {}),
            runtimeMs,
            ...(lastRun?.iterations === undefined ? {} : { iterations: lastRun.iterations }),
            ...(lastRun?.swapsAccepted === undefined ? {} : { swapsAccepted: lastRun.swapsAccepted }),
            ...(lastRun?.converged === undefined ? {} : { converged: lastRun.converged }),
            ...(lastRun?.stopReason === undefined ? {} : { stopReason: lastRun.stopReason }),
            ...(lastRun ? { reasons: lastRun.reasons } : {}),
          });
        } catch {
          // Keep the outward error generic if the database is also unavailable while recording failure.
        }
        if (error instanceof OptimizationValidationError) throw error;
        throw new OptimizationExecutionError();
      }
    },

    get(userId: number, runId: number) {
      return dependencies.getRun(userId, runId);
    },

    async list(userId: number, options: { datasetVersionId?: number; limit: number; beforeRunId?: number }) {
      if (options.datasetVersionId !== undefined) {
        const dataset = await dependencies.getVersion(userId, options.datasetVersionId);
        if (!dataset || dataset.status !== "ready") throw new DatasetVersionUnavailableError();
      }
      const ageMs = staleOptimizationRunAgeMs();
      const ageMinutes = Math.ceil(ageMs / 60_000);
      const recovery: RecoverStaleRunsInput = {
        userId,
        staleBefore: new Date(Date.now() - ageMs),
        errorMessage: `Run abandoned after ${ageMinutes} minutes without completion. It may have been interrupted; retry the optimization.`,
        ...(options.datasetVersionId === undefined ? {} : { datasetVersionId: options.datasetVersionId }),
      };
      await dependencies.recoverStaleRuns(recovery);
      return dependencies.listRuns(userId, options);
    },
  };
}

export const optimizationService = createOptimizationService();
