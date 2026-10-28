import { describe, expect, it, vi } from "vitest";
import { datasetVersions, orderLines, orders, skus, warehouseLocations, warehouses } from "../drizzle/schema";
import { makeSampleData, validateDataset } from "../client/src/lib/optimizer";
import { adaptDatasetBundleFromRows, createWarehouseRepository } from "./warehouse-repository";
import type { getDb } from "./db";

describe("warehouse repository transaction boundaries", () => {
  it("adapts database numeric values and preserves order timestamps and identifiers", () => {
    const data = adaptDatasetBundleFromRows(
      [{ id: 1, locationId: "A-1", xCoordinate: "1.25", yCoordinate: "-2", aisleId: "A", capacityWeight: "10", capacityVolume: "2.5", zone: "ambient", accessibility: "open" }] as never,
      [{ id: 51, skuId: "Sku-Mixed", length: "0.2", width: "0.3", height: "0.4", weight: "1.5", demandFrequency: "3", storageClass: "ambient", handlingRestrictions: "standard" }] as never,
      [{ id: 91, externalOrderId: "Order-Mixed" }] as never,
      [{ orderId: 91, skuId: 51, quantity: "2", timestamp: "2026-10-28T12:30:00+05:30" }] as never,
    );

    expect(data).toEqual({
      layout: [{ location_id: "A-1", x_coordinate: 1.25, y_coordinate: -2, aisle_id: "A", capacity_weight: 10, capacity_volume: 2.5, zone: "ambient", accessibility: "open" }],
      skus: [{ sku_id: "Sku-Mixed", length: 0.2, width: 0.3, height: 0.4, weight: 1.5, demand_frequency: 3, storage_class: "ambient", handling_restrictions: "standard" }],
      orders: [{ order_id: "Order-Mixed", sku_id: "Sku-Mixed", quantity: 2, timestamp: "2026-10-28T12:30:00+05:30" }],
    });
  });

  it("rolls back a partially inserted import when a child insert fails", async () => {
    const staged: Array<{ table: unknown; values: unknown }> = [];
    const committed: Array<{ table: unknown; values: unknown }> = [];
    let rolledBack = false;
    const selectResults: unknown[][] = [[{ id: 7 }], []];
    const tx = {
      select: () => {
        const builder = {
          from: () => builder,
          where: () => builder,
          orderBy: () => builder,
          limit: () => builder,
          for: () => builder,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
        };
        return builder;
      },
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          staged.push({ table, values });
          if (table === warehouseLocations) return Promise.reject(new Error("simulated insert failure"));
          return { $returningId: async () => [{ id: 101 }] };
        },
      }),
    };
    const db = {
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => {
        try {
          const result = await work(tx);
          committed.push(...staged);
          return result;
        } catch (error) {
          rolledBack = true;
          staged.length = 0;
          throw error;
        }
      },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>;
    const repository = createWarehouseRepository(async () => db);
    const data = makeSampleData();
    const validation = validateDataset(data, true).report;

    await expect(repository.importBundle(12, 7, data, "sample", validation)).rejects.toThrow("simulated insert failure");
    expect(staged).toHaveLength(0);
    expect(committed).toHaveLength(0);
    expect(rolledBack).toBe(true);
    expect(committed.some((record) => record.table === datasetVersions)).toBe(false);
  });

  it("allocates a new dataset version and transitions only its draft row to ready", async () => {
    const data = makeSampleData();
    const validation = validateDataset(data, true).report;
    const inserted: Array<{ table: unknown; values: any }> = [];
    const updates: Array<{ table: unknown; values: any }> = [];
    let datasetVersionSelectCount = 0;
    const readyRow = {
      id: 101,
      warehouseId: 7,
      versionNumber: 5,
      source: "sample",
      status: "ready",
      createdByUserId: 12,
      layoutCount: data.layout.length,
      skuCount: data.skus.length,
      orderLineCount: data.orders.length,
      validationReport: validation,
      createdAt: new Date(),
      validatedAt: new Date(),
    };
    const tx = {
      select: () => {
        let selectedTable: unknown;
        const builder = {
          from: (table: unknown) => { selectedTable = table; return builder; },
          where: () => builder,
          orderBy: () => builder,
          limit: () => builder,
          for: () => builder,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => {
            let result: unknown[] = [];
            if (selectedTable === warehouses) result = [{ id: 7 }];
            else if (selectedTable === datasetVersions) {
              datasetVersionSelectCount += 1;
              result = datasetVersionSelectCount === 1 ? [{ versionNumber: 4 }] : [readyRow];
            } else if (selectedTable === skus) result = data.skus.map((row, index) => ({ id: index + 1, skuId: row.sku_id }));
            else if (selectedTable === orders) result = [...new Set(data.orders.map((row) => row.order_id))].map((externalOrderId, index) => ({ id: index + 1, externalOrderId }));
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      },
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          inserted.push({ table, values });
          return table === datasetVersions ? { $returningId: async () => [{ id: 101 }] } : Promise.resolve();
        },
      }),
      update: (table: unknown) => ({
        set: (values: unknown) => ({ where: async () => { updates.push({ table, values }); } }),
      }),
    };
    const fakeDb = { transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
    const db = fakeDb as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>;
    const repository = createWarehouseRepository(async () => db);
    const result = await repository.importBundle(12, 7, data, "sample", validation);
    const datasetInsert = inserted.find((record) => record.table === datasetVersions)?.values as { versionNumber: number; status: string };

    expect(result.versionNumber).toBe(5);
    expect(datasetInsert).toMatchObject({ versionNumber: 5, status: "draft" });
    expect(updates).toEqual([{ table: datasetVersions, values: { status: "ready", validatedAt: expect.any(Date) } }]);
    expect(inserted.some((record) => record.table === orderLines)).toBe(true);
  });
});
