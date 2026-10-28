import { describe, expect, it, vi } from "vitest";
import { makeSampleData } from "../client/src/lib/optimizer";
import type { TrpcContext } from "./_core/context";
import { createAppRouter } from "./routers";
import type { WarehouseRepository } from "./warehouse-repository";

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

function fakeRepository(overrides: Partial<WarehouseRepository> = {}) {
  const repository: WarehouseRepository = {
    createWarehouse: vi.fn(async (ownerUserId, name) => ({
      id: 1, name, createdAt: new Date(), updatedAt: new Date(), archivedAt: null,
    })),
    listWarehouses: vi.fn(async () => []),
    getWarehouse: vi.fn(async () => null),
    importBundle: vi.fn(async (ownerUserId, warehouseId, data) => ({
      id: 5,
      warehouseId,
      versionNumber: 1,
      source: "csv" as const,
      status: "ready" as const,
      layoutCount: data.layout.length,
      skuCount: data.skus.length,
      orderLineCount: data.orders.length,
      validationReport: null,
      createdAt: new Date(),
      validatedAt: new Date(),
      data,
    })),
    listVersions: vi.fn(async () => null),
    getVersion: vi.fn(async () => null),
    ...overrides,
  };
  return repository;
}

function getCode(error: unknown) {
  return (error as { code?: string }).code;
}

describe("authenticated warehouse and dataset APIs", () => {
  it("rejects unauthenticated access to all warehouse and dataset operations", async () => {
    const caller = createAppRouter(fakeRepository()).createCaller(context(null));
    await expect(caller.warehouses.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.warehouses.create({ name: "A warehouse" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.datasets.listVersions({ warehouseId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("always scopes warehouse reads and writes to the authenticated user", async () => {
    const repository = fakeRepository({
      listWarehouses: vi.fn(async (ownerUserId) => ownerUserId === 41 ? [{ id: 1, name: "Mine", createdAt: new Date(), updatedAt: new Date(), archivedAt: null }] : []),
      getWarehouse: vi.fn(async () => null),
    });
    const caller = createAppRouter(repository).createCaller(context(41));
    expect(await caller.warehouses.list()).toEqual([expect.objectContaining({ name: "Mine" })]);
    await expect(caller.warehouses.get({ warehouseId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.listWarehouses).toHaveBeenCalledWith(41);
    expect(repository.getWarehouse).toHaveBeenCalledWith(41, 99);
  });

  it("derives the owner on warehouse creation instead of accepting one from input", async () => {
    const repository = fakeRepository();
    const caller = createAppRouter(repository).createCaller(context(73));
    await caller.warehouses.create({ name: "  North warehouse  " });
    expect(repository.createWarehouse).toHaveBeenCalledWith(73, "North warehouse");
    await expect(caller.warehouses.create({ name: "Warehouse", ownerUserId: 999 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects duplicate identifiers and invalid order-to-SKU references before persistence", async () => {
    const repository = fakeRepository();
    const caller = createAppRouter(repository).createCaller(context(8));
    const duplicateLayout = makeSampleData();
    duplicateLayout.layout[1]!.location_id = duplicateLayout.layout[0]!.location_id;
    await expect(caller.datasets.importBundle({ warehouseId: 1, data: duplicateLayout })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const badReference = makeSampleData();
    badReference.orders[0]!.sku_id = "UNKNOWN-SKU";
    await expect(caller.datasets.importBundle({ warehouseId: 1, data: badReference })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(repository.importBundle).not.toHaveBeenCalled();
  });

  it("rejects duplicate SKU/order-line pairs, invalid quantities, dates, and oversized imports", async () => {
    const repository = fakeRepository();
    const caller = createAppRouter(repository).createCaller(context(8));
    const duplicateLine = makeSampleData();
    duplicateLine.orders.push({ ...duplicateLine.orders[0]! });
    await expect(caller.datasets.importBundle({ warehouseId: 1, data: duplicateLine })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const invalidQuantity = makeSampleData();
    invalidQuantity.orders[0]!.quantity = 0;
    await expect(caller.datasets.importBundle({ warehouseId: 1, data: invalidQuantity })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const invalidTimestamp = makeSampleData();
    invalidTimestamp.orders[0]!.timestamp = "not-a-timestamp";
    await expect(caller.datasets.importBundle({ warehouseId: 1, data: invalidTimestamp })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const oversized = makeSampleData();
    const seedOrders = oversized.orders;
    oversized.orders = Array.from({ length: 50_001 }, (_, index) => ({ ...seedOrders[index % seedOrders.length]!, order_id: `CAP-${index}` }));
    await expect(caller.datasets.importBundle({ warehouseId: 1, data: oversized })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(repository.importBundle).not.toHaveBeenCalled();
  });

  it("persists a valid bundle as a new version using the authenticated owner", async () => {
    const repository = fakeRepository();
    const caller = createAppRouter(repository).createCaller(context(21));
    const data = makeSampleData();
    const result = await caller.datasets.importBundle({ warehouseId: 4, source: "sample", data });
    expect(result).toMatchObject({ status: "ready", versionNumber: 1, warehouseId: 4, layoutCount: data.layout.length, skuCount: data.skus.length, orderLineCount: data.orders.length });
    expect(repository.importBundle).toHaveBeenCalledWith(21, 4, data, "sample", expect.objectContaining({ valid: true }));
  });

  it("retrieves only ready versions visible through the owner's repository scope", async () => {
    const data = makeSampleData();
    const repository = fakeRepository({
      listVersions: vi.fn(async (ownerUserId, warehouseId) => ownerUserId === 13 && warehouseId === 2 ? [] : null),
      getVersion: vi.fn(async (ownerUserId, datasetVersionId) => ownerUserId === 13 && datasetVersionId === 30 ? ({
        id: 30,
        warehouseId: 2,
        versionNumber: 1,
        source: "sample" as const,
        status: "ready" as const,
        layoutCount: data.layout.length,
        skuCount: data.skus.length,
        orderLineCount: data.orders.length,
        validationReport: null,
        createdAt: new Date(),
        validatedAt: new Date(),
        data,
      }) : null),
    });
    const caller = createAppRouter(repository).createCaller(context(13));
    expect(await caller.datasets.listVersions({ warehouseId: 2 })).toEqual([]);
    await expect(caller.datasets.listVersions({ warehouseId: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await caller.datasets.getVersion({ datasetVersionId: 30 })).toMatchObject({ status: "ready", data });
    await expect(caller.datasets.getVersion({ datasetVersionId: 31 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.listVersions).toHaveBeenCalledWith(13, 2);
    expect(repository.getVersion).toHaveBeenCalledWith(13, 30);
  });

  it("does not accept an existing version ID as an import target", async () => {
    const repository = fakeRepository();
    const caller = createAppRouter(repository).createCaller(context(8));
    await expect(caller.datasets.importBundle({ warehouseId: 1, datasetVersionId: 2, data: makeSampleData() } as never))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(repository.importBundle).not.toHaveBeenCalled();
  });

  it("does not expose database error details to clients", async () => {
    const repository = fakeRepository({ listWarehouses: vi.fn(async () => { throw new Error("mysql://secret-password"); }) });
    const caller = createAppRouter(repository).createCaller(context(8));
    const error = await caller.warehouses.list().catch((caught: unknown) => caught);
    expect(getCode(error)).toBe("INTERNAL_SERVER_ERROR");
    expect((error as Error).message).not.toContain("secret-password");
    expect((error as Error).message).toBe("Unable to complete the request.");
  });
});
