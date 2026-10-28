import {
  boolean,
  double,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type DatasetValidationSnapshot = {
  valid: boolean;
  checks: number;
  passed: number;
  failed: number;
  issues: Array<{ dataset: string; severity: string; code: string; message: string }>;
};

export type OptimizationParameters = {
  travelWeight: number;
  cooccurrenceWeight: number;
  demandWeight: number;
  timeLimitMs: number;
  seed: number;
  maxIterations?: number;
};

export type RouteAssumptions = {
  distanceModel: "euclidean_2d";
  depot: { x: number; y: number };
  stopOrdering: "timestamp_then_sku_id";
};

/** A user's warehouse container. Dataset ownership is inherited through this row. */
export const warehouses = mysqlTable("warehouses", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  ownerUserId: int("ownerUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 191 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  archivedAt: timestamp("archivedAt"),
}, (table) => [
  index("warehouses_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
]);

/** Ready versions are immutable snapshots; edits create a new version. */
export const datasetVersions = mysqlTable("dataset_versions", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  warehouseId: int("warehouseId", { unsigned: true }).notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  versionNumber: int("versionNumber", { unsigned: true }).notNull(),
  source: mysqlEnum("source", ["csv", "sample"]).notNull(),
  status: mysqlEnum("status", ["draft", "ready", "failed"]).default("draft").notNull(),
  createdByUserId: int("createdByUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  layoutCount: int("layoutCount", { unsigned: true }).default(0).notNull(),
  skuCount: int("skuCount", { unsigned: true }).default(0).notNull(),
  orderLineCount: int("orderLineCount", { unsigned: true }).default(0).notNull(),
  validationReport: json("validationReport").$type<DatasetValidationSnapshot>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  validatedAt: timestamp("validatedAt"),
}, (table) => [
  uniqueIndex("dataset_versions_warehouse_version_uq").on(table.warehouseId, table.versionNumber),
  uniqueIndex("dataset_versions_warehouse_id_uq").on(table.warehouseId, table.id),
  index("dataset_versions_warehouse_created_idx").on(table.warehouseId, table.createdAt),
  index("dataset_versions_status_created_idx").on(table.status, table.createdAt),
]);

export const warehouseLocations = mysqlTable("warehouse_locations", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  locationId: varchar("locationId", { length: 191 }).notNull(),
  xCoordinate: double("xCoordinate").notNull(),
  yCoordinate: double("yCoordinate").notNull(),
  aisleId: varchar("aisleId", { length: 191 }).notNull(),
  capacityWeight: double("capacityWeight").notNull(),
  capacityVolume: double("capacityVolume").notNull(),
  zone: mysqlEnum("zone", ["ambient", "cold", "hazmat"]).notNull(),
  accessibility: mysqlEnum("accessibility", ["open", "restricted"]).notNull(),
}, (table) => [
  uniqueIndex("warehouse_locations_version_location_uq").on(table.datasetVersionId, table.locationId),
  uniqueIndex("warehouse_locations_version_id_uq").on(table.datasetVersionId, table.id),
  index("warehouse_locations_version_zone_aisle_idx").on(table.datasetVersionId, table.zone, table.aisleId),
]);

export const skus = mysqlTable("skus", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  skuId: varchar("skuId", { length: 191 }).notNull(),
  length: double("length").notNull(),
  width: double("width").notNull(),
  height: double("height").notNull(),
  weight: double("weight").notNull(),
  demandFrequency: double("demandFrequency").notNull(),
  storageClass: mysqlEnum("storageClass", ["ambient", "cold", "hazmat"]).notNull(),
  handlingRestrictions: text("handlingRestrictions").notNull(),
}, (table) => [
  uniqueIndex("skus_version_sku_uq").on(table.datasetVersionId, table.skuId),
  uniqueIndex("skus_version_id_uq").on(table.datasetVersionId, table.id),
  index("skus_version_storage_class_idx").on(table.datasetVersionId, table.storageClass),
]);

export const orders = mysqlTable("orders", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  externalOrderId: varchar("externalOrderId", { length: 191 }).notNull(),
}, (table) => [
  uniqueIndex("orders_version_external_id_uq").on(table.datasetVersionId, table.externalOrderId),
  uniqueIndex("orders_version_id_uq").on(table.datasetVersionId, table.id),
]);

/** The source CSV timestamp is line-level and kept as text to preserve its exact input. */
export const orderLines = mysqlTable("order_lines", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  orderId: int("orderId", { unsigned: true }).notNull(),
  skuId: int("skuId", { unsigned: true }).notNull(),
  quantity: int("quantity", { unsigned: true }).notNull(),
  timestamp: varchar("timestamp", { length: 64 }).notNull(),
}, (table) => [
  foreignKey({
    name: "order_lines_version_order_fk",
    columns: [table.datasetVersionId, table.orderId],
    foreignColumns: [orders.datasetVersionId, orders.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "order_lines_version_sku_fk",
    columns: [table.datasetVersionId, table.skuId],
    foreignColumns: [skus.datasetVersionId, skus.id],
  }).onDelete("cascade"),
  uniqueIndex("order_lines_version_order_sku_uq").on(table.datasetVersionId, table.orderId, table.skuId),
  index("order_lines_version_order_idx").on(table.datasetVersionId, table.orderId),
  index("order_lines_version_sku_idx").on(table.datasetVersionId, table.skuId),
]);

export const optimizationRuns = mysqlTable("optimization_runs", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull().references(() => datasetVersions.id, { onDelete: "restrict" }),
  requestedByUserId: int("requestedByUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  algorithmKey: mysqlEnum("algorithmKey", ["greedy", "local_search"]).notNull(),
  algorithmName: varchar("algorithmName", { length: 191 }).notNull(),
  parameters: json("parameters").$type<OptimizationParameters>().notNull(),
  routeAssumptions: json("routeAssumptions").$type<RouteAssumptions>().notNull(),
  optimizerVersion: varchar("optimizerVersion", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["queued", "running", "succeeded", "failed"]).default("queued").notNull(),
  runtimeMs: int("runtimeMs", { unsigned: true }),
  iterations: int("iterations", { unsigned: true }),
  swapsAccepted: int("swapsAccepted", { unsigned: true }),
  converged: boolean("converged"),
  stopReason: mysqlEnum("stopReason", ["converged", "iteration_limit", "time_limit"]),
  reasons: json("reasons").$type<string[]>().notNull(),
  validationReport: json("validationReport").$type<DatasetValidationSnapshot>(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, (table) => [
  uniqueIndex("optimization_runs_version_id_uq").on(table.datasetVersionId, table.id),
  index("optimization_runs_version_created_idx").on(table.datasetVersionId, table.createdAt),
  index("optimization_runs_requester_created_idx").on(table.requestedByUserId, table.createdAt),
  index("optimization_runs_status_created_idx").on(table.status, table.createdAt),
]);

export const runMetrics = mysqlTable("run_metrics", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  optimizationRunId: int("optimizationRunId", { unsigned: true }).notNull().references(() => optimizationRuns.id, { onDelete: "cascade" }),
  scope: mysqlEnum("scope", ["baseline", "optimized"]).notNull(),
  objective: double("objective").notNull(),
  totalDistance: double("totalDistance").notNull(),
  averageDistance: double("averageDistance").notNull(),
  averagePickSeconds: double("averagePickSeconds").notNull(),
  throughput: double("throughput").notNull(),
  capacityUtilization: double("capacityUtilization").notNull(),
  validAssignments: int("validAssignments", { unsigned: true }).notNull(),
  constraintViolations: int("constraintViolations", { unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("run_metrics_run_scope_uq").on(table.optimizationRunId, table.scope),
]);

/** One baseline and one optimized assignment set are stored per solver run. */
export const runAssignments = mysqlTable("run_assignments", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull(),
  optimizationRunId: int("optimizationRunId", { unsigned: true }).notNull(),
  scope: mysqlEnum("scope", ["baseline", "optimized"]).notNull(),
  skuId: int("skuId", { unsigned: true }).notNull(),
  locationId: int("locationId", { unsigned: true }),
  score: double("score").notNull(),
  reason: text("reason").notNull(),
}, (table) => [
  foreignKey({
    name: "run_assignments_version_run_fk",
    columns: [table.datasetVersionId, table.optimizationRunId],
    foreignColumns: [optimizationRuns.datasetVersionId, optimizationRuns.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "run_assignments_version_sku_fk",
    columns: [table.datasetVersionId, table.skuId],
    foreignColumns: [skus.datasetVersionId, skus.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "run_assignments_version_location_fk",
    columns: [table.datasetVersionId, table.locationId],
    foreignColumns: [warehouseLocations.datasetVersionId, warehouseLocations.id],
  }).onDelete("restrict"),
  uniqueIndex("run_assignments_run_scope_sku_uq").on(table.optimizationRunId, table.scope, table.skuId),
  uniqueIndex("run_assignments_run_scope_location_uq").on(table.optimizationRunId, table.scope, table.locationId),
  index("run_assignments_version_run_idx").on(table.datasetVersionId, table.optimizationRunId),
  index("run_assignments_version_sku_idx").on(table.datasetVersionId, table.skuId),
  index("run_assignments_version_location_idx").on(table.datasetVersionId, table.locationId),
]);

export const benchmarkSessions = mysqlTable("benchmark_sessions", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull().references(() => datasetVersions.id, { onDelete: "restrict" }),
  requestedByUserId: int("requestedByUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  parameters: json("parameters").$type<OptimizationParameters>().notNull(),
  status: mysqlEnum("status", ["queued", "running", "succeeded", "failed"]).default("queued").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, (table) => [
  uniqueIndex("benchmark_sessions_version_id_uq").on(table.datasetVersionId, table.id),
  index("benchmark_sessions_version_created_idx").on(table.datasetVersionId, table.createdAt),
  index("benchmark_sessions_requester_created_idx").on(table.requestedByUserId, table.createdAt),
]);

/** Result rows snapshot the comparable baseline/greedy/local-search table. */
export const benchmarkResults = mysqlTable("benchmark_results", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(),
  datasetVersionId: int("datasetVersionId", { unsigned: true }).notNull(),
  benchmarkSessionId: int("benchmarkSessionId", { unsigned: true }).notNull(),
  optimizationRunId: int("optimizationRunId", { unsigned: true }).notNull(),
  resultScope: mysqlEnum("resultScope", ["baseline", "optimized"]).notNull(),
  algorithmKey: mysqlEnum("algorithmKey", ["baseline", "greedy", "local_search"]).notNull(),
  algorithmName: varchar("algorithmName", { length: 191 }).notNull(),
  totalDistance: double("totalDistance").notNull(),
  averageDistance: double("averageDistance").notNull(),
  objective: double("objective").notNull(),
  runtimeMs: int("runtimeMs", { unsigned: true }).notNull(),
  assignments: int("assignments", { unsigned: true }).notNull(),
  constraintViolations: int("constraintViolations", { unsigned: true }).notNull(),
  feasible: boolean("feasible").notNull(),
  improvementOverBaseline: double("improvementOverBaseline").notNull(),
  iterations: int("iterations", { unsigned: true }),
  swapsAccepted: int("swapsAccepted", { unsigned: true }),
  converged: boolean("converged"),
  stopReason: mysqlEnum("stopReason", ["converged", "iteration_limit", "time_limit"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  foreignKey({
    name: "benchmark_results_version_session_fk",
    columns: [table.datasetVersionId, table.benchmarkSessionId],
    foreignColumns: [benchmarkSessions.datasetVersionId, benchmarkSessions.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "benchmark_results_version_run_fk",
    columns: [table.datasetVersionId, table.optimizationRunId],
    foreignColumns: [optimizationRuns.datasetVersionId, optimizationRuns.id],
  }).onDelete("restrict"),
  uniqueIndex("benchmark_results_session_algorithm_uq").on(table.benchmarkSessionId, table.algorithmKey),
  index("benchmark_results_version_session_idx").on(table.datasetVersionId, table.benchmarkSessionId),
  index("benchmark_results_version_run_idx").on(table.datasetVersionId, table.optimizationRunId),
  index("benchmark_results_run_scope_idx").on(table.optimizationRunId, table.resultScope),
]);

export type Warehouse = typeof warehouses.$inferSelect;
export type InsertWarehouse = typeof warehouses.$inferInsert;
export type DatasetVersion = typeof datasetVersions.$inferSelect;
export type InsertDatasetVersion = typeof datasetVersions.$inferInsert;
export type WarehouseLocation = typeof warehouseLocations.$inferSelect;
export type InsertWarehouseLocation = typeof warehouseLocations.$inferInsert;
export type SkuRecord = typeof skus.$inferSelect;
export type InsertSkuRecord = typeof skus.$inferInsert;
export type OrderRecord = typeof orders.$inferSelect;
export type InsertOrderRecord = typeof orders.$inferInsert;
export type OrderLine = typeof orderLines.$inferSelect;
export type InsertOrderLine = typeof orderLines.$inferInsert;
export type OptimizationRunRecord = typeof optimizationRuns.$inferSelect;
export type InsertOptimizationRunRecord = typeof optimizationRuns.$inferInsert;
export type RunMetric = typeof runMetrics.$inferSelect;
export type InsertRunMetric = typeof runMetrics.$inferInsert;
export type RunAssignment = typeof runAssignments.$inferSelect;
export type InsertRunAssignment = typeof runAssignments.$inferInsert;
export type BenchmarkSession = typeof benchmarkSessions.$inferSelect;
export type InsertBenchmarkSession = typeof benchmarkSessions.$inferInsert;
export type BenchmarkResultRecord = typeof benchmarkResults.$inferSelect;
export type InsertBenchmarkResultRecord = typeof benchmarkResults.$inferInsert;
