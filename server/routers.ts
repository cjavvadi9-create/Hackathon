import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { OptimizationParameters } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const.js";
import { validateDataset, type DatasetBundle } from "../client/src/lib/optimizer.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc.js";
import { DatabaseUnavailableError, WarehouseNotFoundError, warehouseRepository, type WarehouseRepository } from "./warehouse-repository.js";
import {
  DatasetVersionUnavailableError,
  OptimizationExecutionError,
  OptimizationValidationError,
  optimizationService,
  type OptimizationService,
} from "./optimization-service.js";

const MAX_WAREHOUSE_NAME_LENGTH = 191;
const MAX_LOCATION_ROWS = 10_000;
const MAX_SKU_ROWS = 10_000;
const MAX_ORDER_LINES = 50_000;
const MAX_TOTAL_ROWS = MAX_LOCATION_ROWS + MAX_SKU_ROWS + MAX_ORDER_LINES;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UINT32 = 4_294_967_295;

const idInput = z.number().int().positive().max(MAX_UINT32);
const optimizerParametersInput = z.object({
  travelWeight: z.number().finite().min(0).max(1).optional(),
  cooccurrenceWeight: z.number().finite().min(0).max(1).optional(),
  demandWeight: z.number().finite().min(0).max(1).optional(),
  timeLimitMs: z.number().int().min(1).max(120_000).optional(),
  seed: z.number().int().min(-2_147_483_647).max(2_147_483_647).optional(),
  maxIterations: z.number().int().min(1).max(10_000).optional(),
}).strict();
const locationInput = z.object({
  location_id: z.string().trim().min(1).max(191),
  x_coordinate: z.number().finite(),
  y_coordinate: z.number().finite(),
  aisle_id: z.string().trim().min(1).max(191),
  capacity_weight: z.number().finite(),
  capacity_volume: z.number().finite(),
  zone: z.enum(["ambient", "cold", "hazmat"]),
  accessibility: z.enum(["open", "restricted"]),
}).strict();
const skuInput = z.object({
  sku_id: z.string().trim().min(1).max(191),
  length: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  weight: z.number().finite(),
  demand_frequency: z.number().finite(),
  storage_class: z.enum(["ambient", "cold", "hazmat"]),
  handling_restrictions: z.string().trim().max(1_000_000),
}).strict();
const orderInput = z.object({
  order_id: z.string().trim().min(1).max(191),
  sku_id: z.string().trim().min(1).max(191),
  quantity: z.number().int().min(1).max(MAX_UINT32),
  timestamp: z.string().trim().min(1).max(64),
}).strict();
const bundleInput = z.object({
  layout: z.array(locationInput).min(1).max(MAX_LOCATION_ROWS),
  skus: z.array(skuInput).min(1).max(MAX_SKU_ROWS),
  orders: z.array(orderInput).min(1).max(MAX_ORDER_LINES),
}).strict();

function translateFailure(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof DatabaseUnavailableError) {
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database storage is unavailable. Check server configuration." });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to complete the request." });
}

async function callRepository<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translateFailure(error);
  }
}

function validateImportBundle(data: DatasetBundle) {
  const totalRows = data.layout.length + data.skus.length + data.orders.length;
  if (totalRows > MAX_TOTAL_ROWS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Dataset exceeds the ${MAX_TOTAL_ROWS.toLocaleString()} row total limit.` });
  }
  const payloadSize = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  if (payloadSize > MAX_PAYLOAD_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Dataset payload exceeds the ${MAX_PAYLOAD_BYTES / (1024 * 1024)} MB limit.` });
  }

  const report = validateDataset(data, true).report;
  if (!report.valid) {
    const issues = report.issues.filter((issue) => issue.severity === "error").slice(0, 20);
    const details = issues.map(({ dataset, code, message }) => `${dataset}.${code}: ${message.slice(0, 300)}`);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: details.length ? `Dataset validation failed: ${details.join("; ")}` : "Dataset validation failed.",
    });
  }
  return report;
}

export function createAppRouter(
  repository: WarehouseRepository = warehouseRepository,
  optimizer: OptimizationService = optimizationService,
) {
  return router({
    system: systemRouter,
    auth: router({
      me: publicProcedure.query(({ ctx }) => ctx.user),
      logout: publicProcedure.mutation(({ ctx }) => {
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        return { success: true } as const;
      }),
    }),
    warehouses: router({
      create: protectedProcedure
        .input(z.object({ name: z.string().trim().min(1).max(MAX_WAREHOUSE_NAME_LENGTH) }).strict())
        .mutation(({ ctx, input }) => callRepository(() => repository.createWarehouse(ctx.user.id, input.name))),
      list: protectedProcedure.query(({ ctx }) => callRepository(() => repository.listWarehouses(ctx.user.id))),
      get: protectedProcedure
        .input(z.object({ warehouseId: idInput }).strict())
        .query(async ({ ctx, input }) => {
          const result = await callRepository(() => repository.getWarehouse(ctx.user.id, input.warehouseId));
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found." });
          return result;
        }),
    }),
    datasets: router({
      importBundle: protectedProcedure
        .input(z.object({
          warehouseId: idInput,
          source: z.enum(["csv", "sample"]).default("csv"),
          data: bundleInput,
        }).strict())
        .mutation(async ({ ctx, input }) => {
          const validationReport = validateImportBundle(input.data);
          try {
            return await repository.importBundle(ctx.user.id, input.warehouseId, input.data, input.source, validationReport);
          } catch (error) {
            if (error instanceof WarehouseNotFoundError) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found." });
            }
            throw translateFailure(error);
          }
        }),
      listVersions: protectedProcedure
        .input(z.object({ warehouseId: idInput }).strict())
        .query(async ({ ctx, input }) => {
          const result = await callRepository(() => repository.listVersions(ctx.user.id, input.warehouseId));
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found." });
          return result;
        }),
      getVersion: protectedProcedure
        .input(z.object({ datasetVersionId: idInput }).strict())
        .query(async ({ ctx, input }) => {
          const result = await callRepository(() => repository.getVersion(ctx.user.id, input.datasetVersionId));
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Dataset version not found." });
          return result;
        }),
    }),
    optimization: router({
      run: protectedProcedure
        .input(z.object({
          datasetVersionId: idInput,
          algorithmKey: z.enum(["greedy", "local_search"]),
          parameters: optimizerParametersInput.optional(),
        }).strict())
        .mutation(async ({ ctx, input }) => {
          const defaults: OptimizationParameters = input.algorithmKey === "greedy"
            ? { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 1000, seed: 42 }
            : { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 2000, seed: 42, maxIterations: 500 };
          const parameters = { ...defaults, ...input.parameters } as OptimizationParameters;
          try {
            return await optimizer.run(ctx.user.id, {
              datasetVersionId: input.datasetVersionId,
              algorithmKey: input.algorithmKey,
              parameters,
            });
          } catch (error) {
            if (error instanceof DatasetVersionUnavailableError) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Ready dataset version not found." });
            }
            if (error instanceof OptimizationValidationError) {
              throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
            }
            if (error instanceof OptimizationExecutionError) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Optimization failed. Check the run history before retrying." });
            }
            throw translateFailure(error);
          }
        }),
      get: protectedProcedure
        .input(z.object({ runId: idInput }).strict())
        .query(async ({ ctx, input }) => {
          const result = await callRepository(() => optimizer.get(ctx.user.id, input.runId));
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Optimization run not found." });
          return result;
        }),
      list: protectedProcedure
        .input(z.object({
          datasetVersionId: idInput.optional(),
          limit: z.number().int().min(1).max(100).default(20),
          beforeRunId: idInput.optional(),
        }).strict())
        .query(async ({ ctx, input }) => {
          try {
            return await optimizer.list(ctx.user.id, input);
          } catch (error) {
            if (error instanceof DatasetVersionUnavailableError) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Ready dataset version not found." });
            }
            throw translateFailure(error);
          }
        }),
    }),
  });
}

export const appRouter = createAppRouter();
export type AppRouter = typeof appRouter;
