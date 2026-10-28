import { and, asc, desc, eq } from "drizzle-orm";
import {
  datasetVersions,
  orderLines,
  orders,
  skus,
  warehouseLocations,
  warehouses,
  type DatasetValidationSnapshot,
} from "../drizzle/schema.js";
import type { DatasetBundle, Location, Order, Sku } from "../client/src/lib/optimizer";
import { getDb } from "./db.js";

const INSERT_BATCH_SIZE = 500;
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DatabaseProvider = () => Promise<Database | null>;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database is not available");
    this.name = "DatabaseUnavailableError";
  }
}

export class WarehouseNotFoundError extends Error {
  constructor() {
    super("Warehouse not found");
    this.name = "WarehouseNotFoundError";
  }
}

export type WarehouseSummary = {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type DatasetVersionSummary = {
  id: number;
  warehouseId: number;
  versionNumber: number;
  source: "csv" | "sample";
  status: "ready";
  layoutCount: number;
  skuCount: number;
  orderLineCount: number;
  validationReport: DatasetValidationSnapshot | null;
  createdAt: Date;
  validatedAt: Date | null;
};

export type DatasetVersionWithBundle = DatasetVersionSummary & { data: DatasetBundle };

export type WarehouseRepository = {
  createWarehouse(ownerUserId: number, name: string): Promise<WarehouseSummary>;
  listWarehouses(ownerUserId: number): Promise<WarehouseSummary[]>;
  getWarehouse(ownerUserId: number, warehouseId: number): Promise<WarehouseSummary | null>;
  importBundle(
    ownerUserId: number,
    warehouseId: number,
    data: DatasetBundle,
    source: "csv" | "sample",
    validationReport: DatasetValidationSnapshot,
  ): Promise<DatasetVersionWithBundle>;
  listVersions(ownerUserId: number, warehouseId: number): Promise<DatasetVersionSummary[] | null>;
  getVersion(ownerUserId: number, datasetVersionId: number): Promise<DatasetVersionWithBundle | null>;
};

function chunks<T>(items: T[], size = INSERT_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

function numeric(value: number | string): number {
  return Number(value);
}

function asSummary(row: typeof datasetVersions.$inferSelect): DatasetVersionSummary {
  return {
    id: numeric(row.id),
    warehouseId: numeric(row.warehouseId),
    versionNumber: numeric(row.versionNumber),
    source: row.source,
    status: "ready",
    layoutCount: numeric(row.layoutCount),
    skuCount: numeric(row.skuCount),
    orderLineCount: numeric(row.orderLineCount),
    validationReport: row.validationReport,
    createdAt: row.createdAt,
    validatedAt: row.validatedAt,
  };
}

function asWarehouse(row: typeof warehouses.$inferSelect): WarehouseSummary {
  return {
    id: numeric(row.id),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

export function adaptDatasetBundleFromRows(
  locationRows: (typeof warehouseLocations.$inferSelect)[],
  skuRows: (typeof skus.$inferSelect)[],
  orderRows: (typeof orders.$inferSelect)[],
  lineRows: (typeof orderLines.$inferSelect)[],
): DatasetBundle {
  const layout: Location[] = locationRows.map((row) => ({
    location_id: row.locationId,
    x_coordinate: numeric(row.xCoordinate),
    y_coordinate: numeric(row.yCoordinate),
    aisle_id: row.aisleId,
    capacity_weight: numeric(row.capacityWeight),
    capacity_volume: numeric(row.capacityVolume),
    zone: row.zone,
    accessibility: row.accessibility,
  }));
  const skuByDatabaseId = new Map<number, Sku>();
  const skuList: Sku[] = skuRows.map((row) => {
    const sku: Sku = {
      sku_id: row.skuId,
      length: numeric(row.length),
      width: numeric(row.width),
      height: numeric(row.height),
      weight: numeric(row.weight),
      demand_frequency: numeric(row.demandFrequency),
      storage_class: row.storageClass,
      handling_restrictions: row.handlingRestrictions,
    };
    skuByDatabaseId.set(numeric(row.id), sku);
    return sku;
  });
  const orderByDatabaseId = new Map<number, string>(orderRows.map((row) => [numeric(row.id), row.externalOrderId]));
  const orderBundle: Order[] = lineRows.map((row) => {
    const orderId = orderByDatabaseId.get(numeric(row.orderId));
    const sku = skuByDatabaseId.get(numeric(row.skuId));
    if (orderId === undefined || sku === undefined) throw new Error("Stored dataset references are inconsistent");
    return {
      order_id: orderId,
      sku_id: sku.sku_id,
      quantity: numeric(row.quantity),
      timestamp: row.timestamp,
    };
  });
  return { layout, skus: skuList, orders: orderBundle };
}

async function readBundle(db: Database, datasetVersionId: number) {
  const [locationRows, skuRows, orderRows, lineRows] = await Promise.all([
    db.select().from(warehouseLocations).where(eq(warehouseLocations.datasetVersionId, datasetVersionId)).orderBy(asc(warehouseLocations.id)),
    db.select().from(skus).where(eq(skus.datasetVersionId, datasetVersionId)).orderBy(asc(skus.id)),
    db.select().from(orders).where(eq(orders.datasetVersionId, datasetVersionId)).orderBy(asc(orders.id)),
    db.select().from(orderLines).where(eq(orderLines.datasetVersionId, datasetVersionId)).orderBy(asc(orderLines.id)),
  ]);
  return adaptDatasetBundleFromRows(locationRows, skuRows, orderRows, lineRows);
}

export function createWarehouseRepository(databaseProvider: DatabaseProvider = getDb): WarehouseRepository {
  return {
  async createWarehouse(ownerUserId, name) {
    const db = await databaseProvider();
    if (!db) throw new DatabaseUnavailableError();
    const [inserted] = await db.insert(warehouses).values({ ownerUserId, name }).$returningId();
    const [row] = await db.select().from(warehouses).where(and(eq(warehouses.id, inserted.id), eq(warehouses.ownerUserId, ownerUserId))).limit(1);
    if (!row) throw new Error("Warehouse insert did not return a row");
    return asWarehouse(row);
  },

  async listWarehouses(ownerUserId) {
    const db = await databaseProvider();
    if (!db) throw new DatabaseUnavailableError();
    const rows = await db.select().from(warehouses).where(eq(warehouses.ownerUserId, ownerUserId)).orderBy(desc(warehouses.updatedAt));
    return rows.map(asWarehouse);
  },

  async getWarehouse(ownerUserId, warehouseId) {
    const db = await databaseProvider();
    if (!db) throw new DatabaseUnavailableError();
    const [row] = await db.select().from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.ownerUserId, ownerUserId))).limit(1);
    return row ? asWarehouse(row) : null;
  },

  async importBundle(ownerUserId, warehouseId, data, source, validationReport) {
    const db = await databaseProvider();
    if (!db) throw new DatabaseUnavailableError();

    return db.transaction(async (tx) => {
      // Lock the owned warehouse row so concurrent imports receive distinct version numbers.
      const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), eq(warehouses.ownerUserId, ownerUserId)))
        .limit(1).for("update");
      if (!warehouse) throw new WarehouseNotFoundError();

      const [latest] = await tx.select({ versionNumber: datasetVersions.versionNumber })
        .from(datasetVersions).where(eq(datasetVersions.warehouseId, warehouseId))
        .orderBy(desc(datasetVersions.versionNumber)).limit(1);
      const versionNumber = latest ? numeric(latest.versionNumber) + 1 : 1;
      const [insertedVersion] = await tx.insert(datasetVersions).values({
        warehouseId,
        versionNumber,
        source,
        status: "draft",
        createdByUserId: ownerUserId,
        layoutCount: data.layout.length,
        skuCount: data.skus.length,
        orderLineCount: data.orders.length,
        validationReport,
      }).$returningId();
      const datasetVersionId = numeric(insertedVersion.id);

      const locationRecords = data.layout.map((row) => ({
        datasetVersionId,
        locationId: row.location_id,
        xCoordinate: row.x_coordinate,
        yCoordinate: row.y_coordinate,
        aisleId: row.aisle_id,
        capacityWeight: row.capacity_weight,
        capacityVolume: row.capacity_volume,
        zone: row.zone,
        accessibility: row.accessibility,
      }));
      for (const batch of chunks(locationRecords)) await tx.insert(warehouseLocations).values(batch);

      const skuRecords = data.skus.map((row) => ({
        datasetVersionId,
        skuId: row.sku_id,
        length: row.length,
        width: row.width,
        height: row.height,
        weight: row.weight,
        demandFrequency: row.demand_frequency,
        storageClass: row.storage_class,
        handlingRestrictions: row.handling_restrictions,
      }));
      for (const batch of chunks(skuRecords)) await tx.insert(skus).values(batch);

      const distinctOrderIds = [...new Set(data.orders.map((row) => row.order_id))];
      for (const batch of chunks(distinctOrderIds)) {
        await tx.insert(orders).values(batch.map((externalOrderId) => ({ datasetVersionId, externalOrderId })));
      }

      const [storedSkus, storedOrders] = await Promise.all([
        tx.select({ id: skus.id, skuId: skus.skuId }).from(skus).where(eq(skus.datasetVersionId, datasetVersionId)),
        tx.select({ id: orders.id, externalOrderId: orders.externalOrderId }).from(orders).where(eq(orders.datasetVersionId, datasetVersionId)),
      ]);
      const skuIds = new Map(storedSkus.map((row) => [row.skuId, numeric(row.id)]));
      const orderIds = new Map(storedOrders.map((row) => [row.externalOrderId, numeric(row.id)]));
      const lineRecords = data.orders.map((row) => {
        const orderId = orderIds.get(row.order_id);
        const skuId = skuIds.get(row.sku_id);
        if (orderId === undefined || skuId === undefined) throw new Error("Validated dataset references could not be resolved");
        return { datasetVersionId, orderId, skuId, quantity: row.quantity, timestamp: row.timestamp };
      });
      for (const batch of chunks(lineRecords)) await tx.insert(orderLines).values(batch);

      await tx.update(datasetVersions).set({ status: "ready", validatedAt: new Date() })
        .where(and(eq(datasetVersions.id, datasetVersionId), eq(datasetVersions.status, "draft")));
      const [readyVersion] = await tx.select().from(datasetVersions)
        .where(and(eq(datasetVersions.id, datasetVersionId), eq(datasetVersions.status, "ready"))).limit(1);
      if (!readyVersion) throw new Error("Dataset version did not become ready");
      return { ...asSummary(readyVersion), data };
    });
  },

  async listVersions(ownerUserId, warehouseId) {
    const db = await databaseProvider();
    if (!db) throw new DatabaseUnavailableError();
    const [ownedWarehouse] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.ownerUserId, ownerUserId))).limit(1);
    if (!ownedWarehouse) return null;
    const rows = await db.select().from(datasetVersions)
      .where(and(eq(datasetVersions.warehouseId, warehouseId), eq(datasetVersions.status, "ready")))
      .orderBy(desc(datasetVersions.versionNumber));
    return rows.map(asSummary);
  },

  async getVersion(ownerUserId, datasetVersionId) {
    const db = await databaseProvider();
    if (!db) throw new DatabaseUnavailableError();
    const [row] = await db.select({ version: datasetVersions }).from(datasetVersions)
      .innerJoin(warehouses, eq(datasetVersions.warehouseId, warehouses.id))
      .where(and(
        eq(datasetVersions.id, datasetVersionId),
        eq(datasetVersions.status, "ready"),
        eq(warehouses.ownerUserId, ownerUserId),
      )).limit(1);
    if (!row) return null;
    const data = await readBundle(db, datasetVersionId);
    return { ...asSummary(row.version), data };
  },
  };
}

export const warehouseRepository = createWarehouseRepository();
