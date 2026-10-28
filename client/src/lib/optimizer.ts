export type DatasetKind = "layout" | "sku" | "orders";

export type Location = {
  location_id: string;
  x_coordinate: number;
  y_coordinate: number;
  aisle_id: string;
  capacity_weight: number;
  capacity_volume: number;
  zone: "ambient" | "cold" | "hazmat";
  accessibility: "open" | "restricted";
};

export type Sku = {
  sku_id: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  demand_frequency: number;
  storage_class: "ambient" | "cold" | "hazmat";
  handling_restrictions: string;
};

export type Order = {
  order_id: string;
  sku_id: string;
  quantity: number;
  timestamp: string;
};

export type DatasetBundle = { layout: Location[]; skus: Sku[]; orders: Order[] };

export type ValidationIssue = { dataset: DatasetKind; severity: "error" | "warning"; code: string; message: string };

export type ValidationReport = {
  valid: boolean;
  checks: number;
  passed: number;
  failed: number;
  issues: ValidationIssue[];
};

export type Assignment = {
  sku_id: string;
  location_id: string;
  score: number;
  reason: string;
};

export type RunMetrics = {
  totalDistance: number;
  averageDistance: number;
  averagePickSeconds: number;
  throughput: number;
  capacityUtilization: number;
  validAssignments: number;
  constraintViolations: number;
};

export type OptimizationRun = {
  runId: string;
  timestamp: string;
  datasetVersion: string;
  algorithm: string;
  parameters: { travelWeight: number; cooccurrenceWeight: number; demandWeight: number; timeLimitMs: number; seed: number; maxIterations?: number };
  baseline: RunMetrics;
  optimized: RunMetrics;
  assignments: Assignment[];
  baselineAssignments: Assignment[];
  validation: ValidationReport;
  reasons: string[];
  runtimeMs?: number;
  iterations?: number;
  swapsAccepted?: number;
  converged?: boolean;
  stopReason?: "converged" | "iteration_limit" | "time_limit";
};

export type BenchmarkResult = {
  algorithmName: string;
  totalDistance: number;
  averageDistance: number;
  objective: number;
  runtimeMs: number;
  assignments: number;
  constraintViolations: number;
  feasible?: boolean;
  improvementOverBaseline: number;
  iterations?: number;
  swapsAccepted?: number;
  converged?: boolean;
  stopReason?: "converged" | "iteration_limit" | "time_limit";
};

export type SkuExplanation = {
  skuId: string;
  baselineLocation: string;
  optimizedLocation: string;
  demandFrequency: number;
  coOrderedSkus: { skuId: string; count: number }[];
  distanceFromStation: number;
  baselineDistanceFromStation: number;
  weightCapacity: number;
  volumeCapacity: number;
  storageClass: string;
  zone: string;
  accessibility: string;
  assignmentReason: string;
  alternativeLocation?: string;
  alternativeObjectiveDiff?: number;
  alternativeDistanceDiff?: number;
};

export type OrderRoute = {
  orderId: string;
  skus: string[];
  locations: { skuId: string; locationId: string; x: number; y: number }[];
  baselineDistance: number;
  optimizedDistance: number;
  distanceSaved: number;
  note: string;
};

export const EXPECTED_HEADERS: Record<DatasetKind, string[]> = {
  layout: ["location_id", "x_coordinate", "y_coordinate", "aisle_id", "capacity_weight", "capacity_volume", "zone", "accessibility"],
  sku: ["sku_id", "length", "width", "height", "weight", "demand_frequency", "storage_class", "handling_restrictions"],
  orders: ["order_id", "sku_id", "quantity", "timestamp"],
};

const LEGACY_DATA_STORAGE_KEY = "optistore-e1-datasets";

const sampleNames = ["phone case", "cable pack", "screen guard", "desk lamp", "power strip", "usb hub", "keyboard", "mouse", "webcam", "charger", "notebook", "label roll"];

function hash(seed: number) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function makeSampleData(): DatasetBundle {
  const random = hash(20261026);
  const layout: Location[] = [];
  for (let aisle = 1; aisle <= 6; aisle += 1) {
    for (let bay = 1; bay <= 6; bay += 1) {
      const zone: Location["zone"] = aisle === 6 ? "cold" : aisle === 5 ? "hazmat" : "ambient";
      layout.push({
        location_id: `${String.fromCharCode(64 + aisle)}-${String(bay).padStart(2, "0")}`,
        x_coordinate: aisle * 12,
        y_coordinate: bay * 8,
        aisle_id: `AISLE-${String(aisle).padStart(2, "0")}`,
        capacity_weight: zone === "hazmat" ? 18 : zone === "cold" ? 12 : 24,
        capacity_volume: zone === "cold" ? 0.9 : 1.8,
        zone,
        accessibility: "open",
      });
    }
  }

  const skus: Sku[] = Array.from({ length: 36 }, (_, index) => {
    const rank = index % 12;
    const storageClass: Sku["storage_class"] = index < 6 ? "cold" : index < 12 ? "hazmat" : "ambient";
    return {
      sku_id: `SKU-${String(1001 + index).padStart(4, "0")}`,
      length: Number((0.18 + (rank % 4) * 0.12).toFixed(2)),
      width: Number((0.12 + (rank % 3) * 0.09).toFixed(2)),
      height: Number((0.08 + (rank % 5) * 0.06).toFixed(2)),
      weight: Number((0.15 + (rank % 6) * 0.27 + (storageClass === "hazmat" ? 0.8 : 0)).toFixed(2)),
      demand_frequency: 0,
      storage_class: storageClass,
      handling_restrictions: storageClass === "cold" ? "temperature_controlled" : storageClass === "hazmat" ? "segregated" : "standard",
    };
  });

  const orders: Order[] = [];
  for (let order = 1; order <= 120; order += 1) {
    const lineCount = 1 + (order % 4);
    const anchor = (order * 7) % skus.length;
    for (let line = 0; line < lineCount; line += 1) {
      const skuIndex = (anchor + line * (order % 5 + 1)) % skus.length;
      orders.push({
        order_id: `ORD-${String(80000 + order).padStart(5, "0")}`,
        sku_id: skus[skuIndex].sku_id,
        quantity: 1 + Math.floor(random() * 3),
        timestamp: `2026-${String(1 + (order % 9)).padStart(2, "0")}-${String(1 + (order % 27)).padStart(2, "0")}T${String(8 + (order % 10)).padStart(2, "0")}:${String((order * 7) % 60).padStart(2, "0")}:00Z`,
      });
    }
  }

  const demand = new Map<string, number>();
  for (const order of orders) demand.set(order.sku_id, (demand.get(order.sku_id) ?? 0) + order.quantity);
  for (const sku of skus) sku.demand_frequency = demand.get(sku.sku_id) ?? 0;
  return { layout, skus, orders };
}

function parseRows(csv: string) {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((value) => value.trim() !== "")) records.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(field);
  if (row.some((value) => value.trim() !== "")) records.push(row);
  if (records.length === 0) return { headers: [], rows: [] as Record<string, string>[] };
  const headers = records[0].map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim());
  const rows = records.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
  });
  return { headers, rows };
}

export function parseDatasetCsv(kind: DatasetKind, csv: string): { data?: Location[] | Sku[] | Order[]; report: ValidationReport } {
  let parsed: ReturnType<typeof parseRows>;
  try {
    parsed = parseRows(csv);
  } catch (error) {
    const issue: ValidationIssue = { dataset: kind, severity: "error", code: "malformed_csv", message: error instanceof Error ? error.message : "Malformed CSV input" };
    return { report: reportFromIssues([issue], 1) };
  }
  const { headers, rows } = parsed;
  const expected = EXPECTED_HEADERS[kind];
  const issues: ValidationIssue[] = [];
  for (const header of expected) if (!headers.includes(header)) issues.push({ dataset: kind, severity: "error", code: "missing_column", message: `Missing required column: ${header}` });
  if (issues.length) return { report: reportFromIssues(issues, expected.length) };

  if (kind === "layout") {
    const data = rows.map((row) => ({ location_id: row.location_id, x_coordinate: Number(row.x_coordinate), y_coordinate: Number(row.y_coordinate), aisle_id: row.aisle_id, capacity_weight: Number(row.capacity_weight), capacity_volume: Number(row.capacity_volume), zone: row.zone as Location["zone"], accessibility: row.accessibility as Location["accessibility"] }));
    return { data, report: validateDataset({ layout: data, skus: [], orders: [] }).report };
  }
  if (kind === "sku") {
    const data = rows.map((row) => ({ sku_id: row.sku_id, length: Number(row.length), width: Number(row.width), height: Number(row.height), weight: Number(row.weight), demand_frequency: Number(row.demand_frequency), storage_class: row.storage_class as Sku["storage_class"], handling_restrictions: row.handling_restrictions }));
    return { data, report: validateDataset({ layout: [], skus: data, orders: [] }).report };
  }
  const data = rows.map((row) => ({ order_id: row.order_id, sku_id: row.sku_id, quantity: Number(row.quantity), timestamp: row.timestamp }));
  return { data, report: validateDataset({ layout: [], skus: [], orders: data }).report };
}

function reportFromIssues(issues: ValidationIssue[], checks: number): ValidationReport {
  const failed = issues.filter((issue) => issue.severity === "error").length;
  const totalChecks = Math.max(checks, failed);
  return { valid: failed === 0, checks: totalChecks, passed: totalChecks - failed, failed, issues };
}

export function validateDataset(data: DatasetBundle, requireAll = false): { report: ValidationReport; demand: Map<string, number> } {
  const issues: ValidationIssue[] = [];
  let checks = 0;
  const check = (condition: boolean, kind: DatasetKind, code: string, message: string, severity: "error" | "warning" = "error") => {
    checks += 1;
    if (!condition) issues.push({ dataset: kind, severity, code, message });
  };
  const duplicate = (values: string[], kind: DatasetKind, label: string) => {
    const seen = new Set<string>();
    for (const value of values) {
      check(!seen.has(value), kind, "duplicate_id", `Duplicate ${label}: ${value}`);
      seen.add(value);
    }
  };
  duplicate(data.layout.map((row) => row.location_id), "layout", "location_id");
  duplicate(data.skus.map((row) => row.sku_id), "sku", "sku_id");
  duplicate(data.orders.map((row) => `${row.order_id}:${row.sku_id}`), "orders", "order_id + sku_id");
  const skuIds = new Set(data.skus.map((sku) => sku.sku_id));
  const demand = new Map<string, number>();
  for (const row of data.orders) {
    check(Boolean(row.order_id.trim() && row.sku_id.trim()), "orders", "invalid_id", "Order rows require order_id and sku_id");
    if (data.skus.length) check(skuIds.has(row.sku_id), "orders", "invalid_reference", `${row.order_id} references unknown SKU ${row.sku_id}`);
    check(Number.isInteger(row.quantity) && row.quantity > 0, "orders", "invalid_quantity", `${row.order_id} has an invalid quantity`);
    check(Boolean(row.timestamp.trim() && !Number.isNaN(Date.parse(row.timestamp))), "orders", "invalid_timestamp", `${row.order_id} has an invalid timestamp`);
    demand.set(row.sku_id, (demand.get(row.sku_id) ?? 0) + (row.quantity || 0));
  }
  for (const location of data.layout) {
    check(Boolean(location.location_id.trim() && location.aisle_id.trim()), "layout", "invalid_id", "Layout rows require location_id and aisle_id");
    check(Number.isFinite(location.x_coordinate) && Number.isFinite(location.y_coordinate), "layout", "invalid_coordinate", `${location.location_id} has invalid coordinates`);
    check(Number.isFinite(location.capacity_weight) && location.capacity_weight > 0, "layout", "invalid_capacity", `${location.location_id} has invalid weight capacity`);
    check(Number.isFinite(location.capacity_volume) && location.capacity_volume > 0, "layout", "invalid_capacity", `${location.location_id} has invalid volume capacity`);
    check(["ambient", "cold", "hazmat"].includes(location.zone), "layout", "invalid_zone", `${location.location_id} has unsupported zone ${location.zone}`);
    check(["open", "restricted"].includes(location.accessibility), "layout", "invalid_accessibility", `${location.location_id} has unsupported accessibility ${location.accessibility}`);
  }
  for (const sku of data.skus) {
    check(Boolean(sku.sku_id.trim()), "sku", "invalid_id", "SKU rows require sku_id");
    const volume = sku.length * sku.width * sku.height;
    check([sku.length, sku.width, sku.height, sku.weight, volume].every((value) => Number.isFinite(value) && value > 0), "sku", "invalid_physical", `${sku.sku_id} has invalid physical metadata`);
    check(Number.isFinite(sku.demand_frequency) && sku.demand_frequency >= 0, "sku", "invalid_demand_frequency", `${sku.sku_id} has invalid demand_frequency`);
    check(["ambient", "cold", "hazmat"].includes(sku.storage_class), "sku", "invalid_storage_class", `${sku.sku_id} has unsupported storage class ${sku.storage_class}`);
    check(handlingRestrictionSupported(sku.handling_restrictions), "sku", "unsupported_handling_restriction", `${sku.sku_id} has a handling restriction the optimizer cannot enforce: ${sku.handling_restrictions}`);
  }
  if (!data.layout.length) { checks += 1; if (requireAll) issues.push({ dataset: "layout", severity: "error", code: "empty_dataset", message: "No warehouse layout rows loaded" }); else issues.push({ dataset: "layout", severity: "warning", code: "empty_dataset", message: "No warehouse layout rows loaded" }); }
  if (!data.skus.length) { checks += 1; if (requireAll) issues.push({ dataset: "sku", severity: "error", code: "empty_dataset", message: "No SKU rows loaded" }); else issues.push({ dataset: "sku", severity: "warning", code: "empty_dataset", message: "No SKU rows loaded" }); }
  if (!data.orders.length) { checks += 1; if (requireAll) issues.push({ dataset: "orders", severity: "error", code: "empty_dataset", message: "No order rows loaded" }); else issues.push({ dataset: "orders", severity: "warning", code: "empty_dataset", message: "No order rows loaded" }); }
  return { report: reportFromIssues(issues, checks), demand };
}

export function euclideanDistance(left: { x_coordinate: number; y_coordinate: number }, right: { x_coordinate: number; y_coordinate: number }) {
  return Math.hypot(left.x_coordinate - right.x_coordinate, left.y_coordinate - right.y_coordinate);
}

export function travelDistance(location: Location) {
  return euclideanDistance(location, { x_coordinate: 0, y_coordinate: 0 });
}

export function volume(sku: Sku) { return sku.length * sku.width * sku.height; }
function handlingRestrictionSupported(value: string) {
  const restriction = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  return !restriction || ["standard", "none", "no_restrictions", "ambient", "cold", "temperature_controlled", "hazmat", "segregated"].includes(restriction);
}

function handlingCompatible(sku: Sku, location: Location) {
  const restriction = sku.handling_restrictions.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (!restriction || ["standard", "none", "no_restrictions"].includes(restriction)) return true;
  if (["ambient", "cold", "temperature_controlled"].includes(restriction)) return location.zone === (restriction === "ambient" ? "ambient" : "cold");
  if (["hazmat", "segregated"].includes(restriction)) return location.zone === "hazmat";
  return false;
}

export function compatible(sku: Sku, location: Location) { return sku.storage_class === location.zone && handlingCompatible(sku, location) && sku.weight <= location.capacity_weight && volume(sku) <= location.capacity_volume && location.accessibility === "open"; }

export function validateAssignments(data: DatasetBundle, assignments: Assignment[]): ValidationReport {
  const issues: ValidationIssue[] = [];
  let checks = 0;
  const check = (condition: boolean, dataset: DatasetKind, code: string, message: string) => {
    checks += 1;
    if (!condition) issues.push({ dataset, severity: "error", code, message });
  };
  const skuById = new Map(data.skus.map((sku) => [sku.sku_id, sku]));
  const locationById = new Map(data.layout.map((location) => [location.location_id, location]));
  const bySku = new Map<string, Assignment[]>();
  const byLocation = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    bySku.set(assignment.sku_id, [...(bySku.get(assignment.sku_id) ?? []), assignment]);
    if (assignment.location_id !== "UNASSIGNED") byLocation.set(assignment.location_id, [...(byLocation.get(assignment.location_id) ?? []), assignment]);
  }
  for (const sku of data.skus) check(bySku.get(sku.sku_id)?.length === 1 && bySku.get(sku.sku_id)?.[0].location_id !== "UNASSIGNED", "sku", "assignment_completeness", `${sku.sku_id} must have exactly one assigned location`);
  for (const assignment of assignments) {
    const sku = skuById.get(assignment.sku_id);
    const location = locationById.get(assignment.location_id);
    check(Boolean(location), "layout", "location_reference", `${assignment.sku_id} references missing location ${assignment.location_id}`);
    check(assignment.location_id === "UNASSIGNED" || byLocation.get(assignment.location_id)?.length === 1, "layout", "location_uniqueness", `${assignment.location_id} is assigned to more than one SKU`);
    check(Boolean(sku && location && sku.weight <= location.capacity_weight), "sku", "weight_capacity", `${assignment.sku_id} exceeds the weight capacity of ${assignment.location_id}`);
    check(Boolean(sku && location && volume(sku) <= location.capacity_volume), "sku", "volume_capacity", `${assignment.sku_id} exceeds the volume capacity of ${assignment.location_id}`);
    check(Boolean(sku && location && sku.storage_class === location.zone), "sku", "storage_compatibility", `${assignment.sku_id} is incompatible with zone ${location?.zone ?? "unknown"}`);
    check(Boolean(sku && location && handlingCompatible(sku, location)), "sku", "handling_compatibility", `${assignment.sku_id} has handling restrictions incompatible with ${location?.location_id ?? assignment.location_id}`);
    check(Boolean(sku && location && location.accessibility === "open"), "layout", "location_availability", `${assignment.location_id} is not accessible`);
  }
  return { valid: issues.length === 0, checks, passed: checks - issues.length, failed: issues.length, issues };
}

export function cooccurrence(data: DatasetBundle) {
  const result = new Map<string, Map<string, number>>();
  const orders = new Map<string, string[]>();
  for (const row of data.orders) orders.set(row.order_id, [...(orders.get(row.order_id) ?? []), row.sku_id]);
  for (const ids of orders.values()) for (const left of ids) for (const right of ids) if (left !== right) result.set(left, result.get(left) ?? new Map()), result.get(left)!.set(right, (result.get(left)!.get(right) ?? 0) + 1);
  return result;
}

function routeDistanceForAssignments(data: DatasetBundle, assignments: Assignment[]) {
  const bySku = new Map(assignments.map((assignment) => [assignment.sku_id, assignment.location_id]));
  const byLocation = new Map(data.layout.map((location) => [location.location_id, location]));
  const orders = new Map<string, Order[]>();
  for (const row of data.orders) orders.set(row.order_id, [...(orders.get(row.order_id) ?? []), row]);
  let total = 0;
  for (const order of orders.values()) {
    order.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.sku_id.localeCompare(right.sku_id));
    const points = order.map((row) => byLocation.get(bySku.get(row.sku_id) ?? "")).filter(Boolean) as Location[];
    let previous = { x_coordinate: 0, y_coordinate: 0 };
    for (const point of points) { total += euclideanDistance(point, previous); previous = point; }
    total += euclideanDistance(previous, { x_coordinate: 0, y_coordinate: 0 });
  }
  return total;
}

export function assignmentMetrics(data: DatasetBundle, assignments: Assignment[]): RunMetrics {
  const total = routeDistanceForAssignments(data, assignments);
  const orders = new Set(data.orders.map((order) => order.order_id)).size || 1;
  const averageDistance = total / orders;
  const averagePickSeconds = 55 + averageDistance * 0.72;
  const validAssignments = assignments.filter((assignment) => assignment.location_id !== "UNASSIGNED").length;
  return { totalDistance: Number(total.toFixed(1)), averageDistance: Number(averageDistance.toFixed(1)), averagePickSeconds: Number(averagePickSeconds.toFixed(1)), throughput: Number((3600 / averagePickSeconds).toFixed(1)), capacityUtilization: Number(((validAssignments / Math.max(data.layout.length, 1)) * 100).toFixed(1)), validAssignments, constraintViolations: assignments.length - validAssignments };
}

/** Compute a normalized objective using the same order-route distance reported in the benchmark. Lower is better. */
export function computeObjective(
  data: DatasetBundle,
  assignments: Assignment[],
  parameters: { travelWeight: number; cooccurrenceWeight: number; demandWeight: number },
  demand: Map<string, number>,
  co: Map<string, Map<string, number>>,
): number {
  const locationById = new Map(data.layout.map((l) => [l.location_id, l]));
  const placed = new Map<string, Location>();
  for (const a of assignments) {
    const loc = locationById.get(a.location_id);
    if (loc && a.location_id !== "UNASSIGNED") placed.set(a.sku_id, loc);
  }
  const maxDepotDistance = Math.max(1, ...data.layout.map(travelDistance));
  const uniqueOrderCount = Math.max(new Set(data.orders.map((order) => order.order_id)).size, 1);
  const routeScale = Math.max(2 * maxDepotDistance * (data.orders.length + uniqueOrderCount), 1);
  const routeCost = routeDistanceForAssignments(data, assignments) / routeScale;

  const totalDemand = data.skus.reduce((sum, sku) => sum + Math.max(0, demand.get(sku.sku_id) ?? 0), 0);
  const demandCost = totalDemand > 0
    ? data.skus.reduce((sum, sku) => {
      const location = placed.get(sku.sku_id);
      const distance = location ? travelDistance(location) : maxDepotDistance;
      return sum + Math.max(0, demand.get(sku.sku_id) ?? 0) * (distance / maxDepotDistance);
    }, 0) / totalDemand
    : 0;

  const maxPairDistance = Math.max(1, ...data.layout.flatMap((left) => data.layout.map((right) => euclideanDistance(left, right))));
  let totalCooccurrence = 0;
  let totalPairFrequency = 0;

  // Each unordered SKU pair contributes once; missing assignments receive the maximum pair cost.
  for (const sku of data.skus) {
    for (const [partnerId, count] of co.get(sku.sku_id)?.entries() ?? []) {
      if (sku.sku_id >= partnerId) continue;
      totalPairFrequency += count;
      const location = placed.get(sku.sku_id);
      const partnerLocation = placed.get(partnerId);
      totalCooccurrence += count * (location && partnerLocation ? euclideanDistance(location, partnerLocation) : maxPairDistance);
    }
  }

  // Average distance terms are normalized to [0, 1] scales so UI weights are comparable.
  const cooccurrenceCost = totalPairFrequency > 0 ? totalCooccurrence / (totalPairFrequency * maxPairDistance) : 0;
  const objective = parameters.travelWeight * routeCost + parameters.demandWeight * demandCost + parameters.cooccurrenceWeight * cooccurrenceCost;

  return objective;
}

/**
 * Greedy + Local Search optimizer.
 * Starts from the greedy solution and iteratively swaps pairs of assigned SKUs
 * to improve the objective, respecting all hard constraints.
 */
export function optimizeLocalSearch(
  data: DatasetBundle,
  parameters = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 2000, seed: 42, maxIterations: 500 },
): OptimizationRun {
  const startTime = performance.now();
  // Start from the greedy solution
  const greedyRun = optimize(data, { ...parameters });
  const assignments = [...greedyRun.assignments.map((a) => ({ ...a }))]; // deep copy

  const { demand } = validateDataset(data, true);
  const co = cooccurrence(data);
  const locationById = new Map(data.layout.map((l) => [l.location_id, l]));
  const skuById = new Map(data.skus.map((s) => [s.sku_id, s]));

  // Build assignment index
  const skuToIndex = new Map<string, number>();
  for (let i = 0; i < assignments.length; i++) skuToIndex.set(assignments[i].sku_id, i);

  // Compute initial objective
  let bestObjective = computeObjective(data, assignments, parameters, demand, co);
  let bestAssignments = assignments.map((a) => ({ ...a }));
  let iterations = 0;
  let swapsAccepted = 0;
  const maxIterations = parameters.maxIterations ?? 500;
  const maxTimeMs = parameters.timeLimitMs ?? 2000;
  let stopReason: "converged" | "iteration_limit" | "time_limit" = "converged";
  let converged = false;

  // Deterministic pairwise swap local search
  let improvedInPass = true;
  while (improvedInPass) {
    improvedInPass = false;
    let completedFullPass = true;

    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        // Check iteration cap
        if (iterations >= maxIterations) {
          stopReason = "iteration_limit";
          completedFullPass = false;
          break;
        }

        // Check time limit
        if (performance.now() - startTime > maxTimeMs) {
          stopReason = "time_limit";
          completedFullPass = false;
          break;
        }

        iterations++;

        const ai = assignments[i];
        const aj = assignments[j];

        // Skip UNASSIGNED
        if (ai.location_id === "UNASSIGNED" || aj.location_id === "UNASSIGNED") continue;

        const locI = locationById.get(ai.location_id);
        const locJ = locationById.get(aj.location_id);
        const skuI = skuById.get(ai.sku_id);
        const skuJ = skuById.get(aj.sku_id);
        if (!locI || !locJ || !skuI || !skuJ) continue;

        // Check feasibility of swap: SKU i -> location j and SKU j -> location i
        if (!compatible(skuI, locJ) || !compatible(skuJ, locI)) continue;

        // Perform candidate swap
        const origLocI = ai.location_id;
        const origLocJ = aj.location_id;
        ai.location_id = origLocJ;
        aj.location_id = origLocI;

        // Compute new objective
        const newObjective = computeObjective(data, assignments, parameters, demand, co);

        if (newObjective < bestObjective - 1e-9) {
          // Accept improvement
          bestObjective = newObjective;
          swapsAccepted++;
          improvedInPass = true;
          // Update reasons
          const partnerI = [...(co.get(ai.sku_id)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
          const partnerJ = [...(co.get(aj.sku_id)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
          ai.reason = `Local search swap${partnerI ? ` · co-pick affinity with ${partnerI}` : ` · ${skuI.storage_class} zone`}`;
          aj.reason = `Local search swap${partnerJ ? ` · co-pick affinity with ${partnerJ}` : ` · ${skuJ.storage_class} zone`}`;
          ai.score = Number(Math.max(0.5, 1 - travelDistance(locJ) / 100).toFixed(2));
          aj.score = Number(Math.max(0.5, 1 - travelDistance(locI) / 100).toFixed(2));
          // Snapshot only after all assignment metadata matches the accepted locations.
          bestAssignments = assignments.map((a) => ({ ...a }));
        } else {
          // Revert swap
          ai.location_id = origLocI;
          aj.location_id = origLocJ;
        }
      }
      if (!completedFullPass) break;
    }

    if (!completedFullPass) break;

    // If an entire pass completed across all pairs without a single improving swap, we have converged
    if (!improvedInPass) {
      stopReason = "converged";
      converged = true;
      break;
    }
  }

  const runtimeMs = Math.round(performance.now() - startTime);

  // Use best found assignments
  const finalAssignments = bestAssignments;
  const optimizedMetrics = assignmentMetrics(data, finalAssignments);
  const baselineMetrics = greedyRun.baseline;
  const assignmentReport = validateAssignments(data, finalAssignments);
  const { report } = validateDataset(data, true);
  const validation: ValidationReport = {
    valid: report.valid && assignmentReport.valid,
    checks: report.checks + assignmentReport.checks,
    passed: report.passed + assignmentReport.passed,
    failed: report.failed + assignmentReport.failed,
    issues: [...report.issues, ...assignmentReport.issues],
  };
  optimizedMetrics.constraintViolations = assignmentReport.failed;
  const timestamp = new Date().toISOString();

  const stopExplanation =
    stopReason === "converged"
      ? "Converged: full 2-opt neighborhood scanned with no further improving swaps found."
      : stopReason === "iteration_limit"
      ? `Iteration limit reached: stopped after ${iterations}/${maxIterations} iterations before convergence.`
      : `Time limit reached: stopped after ${runtimeMs}ms (${iterations} iterations) before convergence.`;

  return {
    runId: `LS-${timestamp.replace(/\D/g, "").slice(0, 14)}`,
    timestamp,
    datasetVersion: `synthetic-e1-v3-${data.layout.length}x${data.skus.length}x${data.orders.length}`,
    algorithm: "Greedy + local search (pairwise swap)",
    parameters: { ...parameters, maxIterations },
    baseline: baselineMetrics,
    optimized: optimizedMetrics,
    assignments: finalAssignments,
    baselineAssignments: greedyRun.baselineAssignments,
    validation,
    reasons: [
      `Local search started from greedy solution and explored pairwise swaps.`,
      `${swapsAccepted} improving swaps accepted over ${iterations} iterations in ${runtimeMs}ms.`,
      stopExplanation,
      "All hard constraints (storage class, weight, volume, accessibility, uniqueness) enforced at every step.",
    ],
    runtimeMs,
    iterations,
    swapsAccepted,
    converged,
    stopReason,
  };
}

/** Build a deterministic feasible reference assignment without using demand or travel scores. */
function makeFeasibleBaseline(data: DatasetBundle, seed: number): Assignment[] {
  const random = hash(seed || 1);
  const candidates = new Map<string, Location[]>();
  for (const sku of data.skus) {
    const compatibleLocations = data.layout.filter((location) => compatible(sku, location));
    for (let i = compatibleLocations.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [compatibleLocations[i], compatibleLocations[j]] = [compatibleLocations[j], compatibleLocations[i]];
    }
    candidates.set(sku.sku_id, compatibleLocations);
  }

  const locationToSku = new Map<string, string>();
  const place = (skuId: string, visited: Set<string>): boolean => {
    for (const location of candidates.get(skuId) ?? []) {
      if (visited.has(location.location_id)) continue;
      visited.add(location.location_id);
      const occupyingSku = locationToSku.get(location.location_id);
      if (!occupyingSku || place(occupyingSku, visited)) {
        locationToSku.set(location.location_id, skuId);
        return true;
      }
    }
    return false;
  };

  // Most-constrained-first improves matching success; ties use stable SKU IDs.
  const skuOrder = [...data.skus].sort((a, b) => (candidates.get(a.sku_id)?.length ?? 0) - (candidates.get(b.sku_id)?.length ?? 0) || a.sku_id.localeCompare(b.sku_id));
  for (const sku of skuOrder) place(sku.sku_id, new Set());
  const skuToLocation = new Map([...locationToSku].map(([locationId, skuId]) => [skuId, locationId]));
  return data.skus.map((sku) => ({
    sku_id: sku.sku_id,
    location_id: skuToLocation.get(sku.sku_id) ?? "UNASSIGNED",
    score: 0.5,
    reason: skuToLocation.has(sku.sku_id) ? "Deterministic randomized feasible baseline; no demand or travel optimization" : "No compatible unique location available",
  }));
}

function hasFeasibleMatching(skus: Sku[], locations: Location[]) {
  if (skus.length > locations.length) return false;
  const candidates = new Map(skus.map((sku) => [sku.sku_id, locations.filter((location) => compatible(sku, location))]));
  const locationToSku = new Map<string, string>();
  const place = (skuId: string, visited: Set<string>): boolean => {
    for (const location of candidates.get(skuId) ?? []) {
      if (visited.has(location.location_id)) continue;
      visited.add(location.location_id);
      const occupyingSku = locationToSku.get(location.location_id);
      if (!occupyingSku || place(occupyingSku, visited)) {
        locationToSku.set(location.location_id, skuId);
        return true;
      }
    }
    return false;
  };
  const constrainedFirst = [...skus].sort((a, b) => (candidates.get(a.sku_id)?.length ?? 0) - (candidates.get(b.sku_id)?.length ?? 0) || a.sku_id.localeCompare(b.sku_id));
  return constrainedFirst.every((sku) => place(sku.sku_id, new Set()));
}

export function optimize(data: DatasetBundle, parameters = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 1000, seed: 42 }): OptimizationRun {
  const { report, demand } = validateDataset(data, true);
  if (!report.valid) throw new Error("Dataset validation failed. Resolve the reported errors before optimizing.");
  const co = cooccurrence(data);
  const locations = [...data.layout];
  const baselineAssignments = makeFeasibleBaseline(data, parameters.seed);
  const baselineIsFeasible = validateAssignments(data, baselineAssignments).valid;
  const orderedSkus = [...data.skus].sort((a, b) => (demand.get(b.sku_id) ?? 0) - (demand.get(a.sku_id) ?? 0));
  const available = [...locations].sort((a, b) => travelDistance(a) - travelDistance(b));
  const assignments: Assignment[] = [];
  for (const [skuIndex, sku] of orderedSkus.entries()) {
    const candidates = available.filter((location) => compatible(sku, location));
    const rankedCandidates = candidates.sort((left, right) => {
      const leftObjective = computeObjective(data, [...assignments, { sku_id: sku.sku_id, location_id: left.location_id, score: 0, reason: "candidate" }], parameters, demand, co);
      const rightObjective = computeObjective(data, [...assignments, { sku_id: sku.sku_id, location_id: right.location_id, score: 0, reason: "candidate" }], parameters, demand, co);
      return leftObjective - rightObjective;
    });
    const candidate = baselineIsFeasible
      ? rankedCandidates.find((location) => hasFeasibleMatching(orderedSkus.slice(skuIndex + 1), available.filter((slot) => slot.location_id !== location.location_id)))
      : rankedCandidates[0];
    if (!candidate) { assignments.push({ sku_id: sku.sku_id, location_id: "UNASSIGNED", score: 0, reason: "No compatible location found" }); continue; }
    available.splice(available.indexOf(candidate), 1);
    const partner = [...(co.get(sku.sku_id)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    assignments.push({ sku_id: sku.sku_id, location_id: candidate.location_id, score: Number(Math.max(0.5, 1 - travelDistance(candidate) / 100).toFixed(2)), reason: partner ? `Demand-weighted · co-pick affinity with ${partner}` : `Demand-weighted · ${sku.storage_class} compatibility` });
  }
  const optimizedMetrics = assignmentMetrics(data, assignments);
  const baselineMetrics = assignmentMetrics(data, baselineAssignments);
  const assignmentReport = validateAssignments(data, assignments);
  const baselineAssignmentReport = validateAssignments(data, baselineAssignments);
  baselineMetrics.constraintViolations = baselineAssignmentReport.failed;
  const validation: ValidationReport = { valid: report.valid && assignmentReport.valid, checks: report.checks + assignmentReport.checks, passed: report.passed + assignmentReport.passed, failed: report.failed + assignmentReport.failed, issues: [...report.issues, ...assignmentReport.issues] };
  optimizedMetrics.constraintViolations = assignmentReport.failed;
  const timestamp = new Date().toISOString();
  return { runId: `OPT-${timestamp.replace(/\D/g, "").slice(0, 14)}`, timestamp, datasetVersion: `synthetic-e1-v3-${data.layout.length}x${data.skus.length}x${data.orders.length}`, algorithm: "Demand + co-occurrence greedy heuristic", parameters, baseline: baselineMetrics, optimized: optimizedMetrics, assignments, baselineAssignments, validation, reasons: ["Demand frequency ranks high-velocity SKUs closer to the picking station.", "Storage class, handling restrictions, weight, volume, and accessibility are hard constraints.", "Order co-occurrence informs the composite objective; reported routes are evaluated separately using the documented distance model."] };
}

export function metricDelta(baseline: number, optimized: number) { return { absolute: Number((optimized - baseline).toFixed(1)), percent: baseline === 0 ? 0 : Number((((optimized - baseline) / baseline) * 100).toFixed(1)) }; }

export function toCsv<T extends Record<string, unknown>>(rows: T[]) { if (!rows.length) return ""; const headers = Object.keys(rows[0]); return [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n"); }

export function datasetCsv(kind: DatasetKind, data: DatasetBundle) {
  const rows = kind === "layout" ? data.layout : kind === "sku" ? data.skus : data.orders;
  return toCsv(rows as unknown as Record<string, unknown>[]);
}
export function assignmentCsv(run: OptimizationRun, optimized = true) { return toCsv((optimized ? run.assignments : run.baselineAssignments) as unknown as Record<string, unknown>[]); }
export function exportRunCsv(run: OptimizationRun) { return toCsv([{ metric: "total_distance", baseline: run.baseline.totalDistance, optimized: run.optimized.totalDistance, absolute_delta: metricDelta(run.baseline.totalDistance, run.optimized.totalDistance).absolute, percent_delta: metricDelta(run.baseline.totalDistance, run.optimized.totalDistance).percent }, { metric: "average_distance_per_order", baseline: run.baseline.averageDistance, optimized: run.optimized.averageDistance, absolute_delta: metricDelta(run.baseline.averageDistance, run.optimized.averageDistance).absolute, percent_delta: metricDelta(run.baseline.averageDistance, run.optimized.averageDistance).percent }, { metric: "estimated_throughput_per_hour", baseline: run.baseline.throughput, optimized: run.optimized.throughput, absolute_delta: metricDelta(run.baseline.throughput, run.optimized.throughput).absolute, percent_delta: metricDelta(run.baseline.throughput, run.optimized.throughput).percent }, { metric: "slot_utilization", baseline: run.baseline.capacityUtilization, optimized: run.optimized.capacityUtilization, absolute_delta: metricDelta(run.baseline.capacityUtilization, run.optimized.capacityUtilization).absolute, percent_delta: metricDelta(run.baseline.capacityUtilization, run.optimized.capacityUtilization).percent }]); }

/** Run both algorithms on the same data and return comparable benchmark results. */
export function runBenchmark(
  data: DatasetBundle,
  parameters = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 2000, seed: 42, maxIterations: 500 },
): { greedy: BenchmarkResult; localSearch: BenchmarkResult; baseline: BenchmarkResult; greedyRun: OptimizationRun; localSearchRun: OptimizationRun } {
  const { demand } = validateDataset(data, true);
  const co = cooccurrence(data);

  const t0 = performance.now();
  const greedyRun = optimize(data, parameters);
  const greedyTime = Math.round(performance.now() - t0);

  const t1 = performance.now();
  const lsRun = optimizeLocalSearch(data, parameters);
  const lsTime = Math.round(performance.now() - t1);

  const greedyObj = computeObjective(data, greedyRun.assignments, parameters, demand, co);
  const lsObj = computeObjective(data, lsRun.assignments, parameters, demand, co);
  const baselineObj = computeObjective(data, greedyRun.baselineAssignments, parameters, demand, co);

  const baselineReport = validateAssignments(data, greedyRun.baselineAssignments);

  return {
    baseline: {
      algorithmName: baselineReport.valid ? "Deterministic randomized feasible baseline" : "Deterministic randomized baseline (infeasible input)",
      totalDistance: greedyRun.baseline.totalDistance,
      averageDistance: greedyRun.baseline.averageDistance,
      objective: Number(baselineObj.toFixed(4)),
      runtimeMs: 0,
      assignments: greedyRun.baseline.validAssignments,
      constraintViolations: baselineReport.failed,
      feasible: baselineReport.valid,
      improvementOverBaseline: 0,
    },
    greedyRun,
    localSearchRun: lsRun,
    greedy: {
      algorithmName: "Demand + co-occurrence greedy heuristic",
      totalDistance: greedyRun.optimized.totalDistance,
      averageDistance: greedyRun.optimized.averageDistance,
      objective: Number(greedyObj.toFixed(4)),
      runtimeMs: greedyTime,
      assignments: greedyRun.optimized.validAssignments,
      constraintViolations: greedyRun.optimized.constraintViolations,
      feasible: greedyRun.validation.valid,
      improvementOverBaseline: metricDelta(greedyRun.baseline.totalDistance, greedyRun.optimized.totalDistance).percent,
    },
    localSearch: {
      algorithmName: "Greedy + local search (pairwise swap)",
      totalDistance: lsRun.optimized.totalDistance,
      averageDistance: lsRun.optimized.averageDistance,
      objective: Number(lsObj.toFixed(4)),
      runtimeMs: lsTime,
      assignments: lsRun.optimized.validAssignments,
      constraintViolations: lsRun.optimized.constraintViolations,
      feasible: lsRun.validation.valid,
      improvementOverBaseline: metricDelta(greedyRun.baseline.totalDistance, lsRun.optimized.totalDistance).percent,
      iterations: lsRun.iterations,
      swapsAccepted: lsRun.swapsAccepted,
      converged: lsRun.converged,
      stopReason: lsRun.stopReason,
    },
  };
}

/** Explain why a specific SKU was assigned to its location. */
export function explainSku(
  data: DatasetBundle,
  run: OptimizationRun,
  skuId: string,
): SkuExplanation | null {
  const sku = data.skus.find((s) => s.sku_id === skuId);
  if (!sku) return null;

  const optimizedAssignment = run.assignments.find((a) => a.sku_id === skuId);
  const baselineAssignment = run.baselineAssignments.find((a) => a.sku_id === skuId);
  if (!optimizedAssignment) return null;

  const locationById = new Map(data.layout.map((l) => [l.location_id, l]));
  const optimizedLoc = locationById.get(optimizedAssignment.location_id);
  const baselineLoc = baselineAssignment ? locationById.get(baselineAssignment.location_id) : null;

  const co = cooccurrence(data);
  const coPartners = [...(co.get(skuId)?.entries() ?? [])]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ skuId: id, count }));

  const { demand } = validateDataset(data, true);

  // Compute full composite objective for the current assignment
  const currentObjective = computeObjective(data, run.assignments, run.parameters, demand, co);

  let alternativeLocation: string | undefined;
  let alternativeObjectiveDiff: number | undefined;
  let alternativeDistanceDiff: number | undefined;

  if (optimizedLoc) {
    const occupiedLocations = new Set(run.assignments.map((a) => a.location_id));
    const freeAlternatives = data.layout.filter(
      (l) => l.location_id !== optimizedAssignment.location_id && !occupiedLocations.has(l.location_id) && compatible(sku, l)
    );

    let candidateAssignments: Assignment[] | null = null;
    let candidateLoc: Location | null = null;

    if (freeAlternatives.length > 0) {
      // Pick nearest free alternative
      candidateLoc = freeAlternatives.sort((a, b) => travelDistance(a) - travelDistance(b))[0];
      candidateAssignments = run.assignments.map((a) =>
        a.sku_id === skuId ? { ...a, location_id: candidateLoc!.location_id } : { ...a }
      );
    } else {
      // All slots occupied: find a candidate valid pairwise swap with another compatible SKU
      const skuById = new Map(data.skus.map((s) => [s.sku_id, s]));
      const candidateSwaps: { otherSku: Sku; otherLoc: Location; candidateA: Assignment[] }[] = [];

      for (const otherA of run.assignments) {
        if (otherA.sku_id === skuId || otherA.location_id === "UNASSIGNED") continue;
        const otherLoc = locationById.get(otherA.location_id);
        const otherSku = skuById.get(otherA.sku_id);
        if (!otherLoc || !otherSku) continue;

        if (compatible(sku, otherLoc) && compatible(otherSku, optimizedLoc)) {
          const candidateA = run.assignments.map((a) => {
            if (a.sku_id === skuId) return { ...a, location_id: otherLoc.location_id };
            if (a.sku_id === otherSku.sku_id) return { ...a, location_id: optimizedLoc.location_id };
            return { ...a };
          });
          candidateSwaps.push({ otherSku, otherLoc, candidateA });
        }
      }

      if (candidateSwaps.length > 0) {
        const evaluated = candidateSwaps.map((item) => ({
          ...item,
          obj: computeObjective(data, item.candidateA, run.parameters, demand, co),
        })).sort((a, b) => a.obj - b.obj);

        candidateLoc = evaluated[0].otherLoc;
        candidateAssignments = evaluated[0].candidateA;
      }
    }

    if (candidateLoc && candidateAssignments) {
      alternativeLocation = candidateLoc.location_id;
      const candidateObjective = computeObjective(data, candidateAssignments, run.parameters, demand, co);
      // Full composite objective difference (candidate - current). Positive means current assignment is better.
      alternativeObjectiveDiff = Number((candidateObjective - currentObjective).toFixed(4));
      // Station distance difference
      alternativeDistanceDiff = Number((travelDistance(candidateLoc) - travelDistance(optimizedLoc)).toFixed(2));
    }
  }

  return {
    skuId,
    baselineLocation: baselineAssignment?.location_id ?? "UNASSIGNED",
    optimizedLocation: optimizedAssignment.location_id,
    demandFrequency: demand.get(skuId) ?? 0,
    coOrderedSkus: coPartners,
    distanceFromStation: optimizedLoc ? Number(travelDistance(optimizedLoc).toFixed(2)) : 0,
    baselineDistanceFromStation: baselineLoc ? Number(travelDistance(baselineLoc).toFixed(2)) : 0,
    weightCapacity: optimizedLoc?.capacity_weight ?? 0,
    volumeCapacity: optimizedLoc?.capacity_volume ?? 0,
    storageClass: sku.storage_class,
    zone: optimizedLoc?.zone ?? "unknown",
    accessibility: optimizedLoc?.accessibility ?? "unknown",
    assignmentReason: optimizedAssignment.reason,
    alternativeLocation,
    alternativeObjectiveDiff,
    alternativeDistanceDiff,
  };
}

/** Compute route details for a specific order. */
export function computeOrderRoute(
  data: DatasetBundle,
  run: OptimizationRun,
  orderId: string,
): OrderRoute | null {
  const orderLines = data.orders.filter((o) => o.order_id === orderId).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.sku_id.localeCompare(right.sku_id));
  if (orderLines.length === 0) return null;

  const locationById = new Map(data.layout.map((l) => [l.location_id, l]));
  const optimizedBySku = new Map(run.assignments.map((a) => [a.sku_id, a.location_id]));
  const baselineBySku = new Map(run.baselineAssignments.map((a) => [a.sku_id, a.location_id]));

  const skus = orderLines.map((l) => l.sku_id);

  // Compute optimized route
  const locations = orderLines.map((l) => {
    const locId = optimizedBySku.get(l.sku_id) ?? "UNASSIGNED";
    const loc = locationById.get(locId);
    return { skuId: l.sku_id, locationId: locId, x: loc?.x_coordinate ?? 0, y: loc?.y_coordinate ?? 0 };
  });

  let optimizedDistance = 0;
  let prev = { x_coordinate: 0, y_coordinate: 0 };
  for (const loc of locations) {
    const point = locationById.get(loc.locationId);
    if (point) {
      optimizedDistance += euclideanDistance(point, prev);
      prev = point;
    }
  }
  optimizedDistance += euclideanDistance(prev, { x_coordinate: 0, y_coordinate: 0 });

  // Compute baseline route
  let baselineDistance = 0;
  prev = { x_coordinate: 0, y_coordinate: 0 };
  for (const line of orderLines) {
    const locId = baselineBySku.get(line.sku_id) ?? "UNASSIGNED";
    const point = locationById.get(locId);
    if (point) {
      baselineDistance += euclideanDistance(point, prev);
      prev = point;
    }
  }
  baselineDistance += euclideanDistance(prev, { x_coordinate: 0, y_coordinate: 0 });

  return {
    orderId,
    skus,
    locations,
    baselineDistance: Number(baselineDistance.toFixed(2)),
    optimizedDistance: Number(optimizedDistance.toFixed(2)),
    distanceSaved: Number((baselineDistance - optimizedDistance).toFixed(2)),
    note: "Distances are simplified Euclidean estimates from picking station (0,0). Not aisle-constrained routing.",
  };
}

/** Generate a comprehensive evaluation report CSV. */
export function exportEvaluationReportCsv(run: OptimizationRun, data: DatasetBundle): string {
  const rows: Record<string, string | number>[] = [
    { section: "Dataset Summary", field: "locations", value: data.layout.length },
    { section: "Dataset Summary", field: "skus", value: data.skus.length },
    { section: "Dataset Summary", field: "unique_orders", value: new Set(data.orders.map((o) => o.order_id)).size },
    { section: "Dataset Summary", field: "order_lines", value: data.orders.length },
    { section: "Dataset Summary", field: "dataset_version", value: run.datasetVersion },
    { section: "Algorithm", field: "name", value: run.algorithm },
    { section: "Algorithm", field: "runtime_ms", value: run.runtimeMs ?? "N/A" },
    { section: "Algorithm", field: "iterations", value: run.iterations ?? "N/A" },
    { section: "Algorithm", field: "swaps_accepted", value: run.swapsAccepted ?? "N/A" },
    { section: "Algorithm", field: "converged", value: run.converged !== undefined ? String(run.converged) : "N/A" },
    { section: "Algorithm", field: "stop_reason", value: run.stopReason ?? (run.converged ? "converged" : "N/A") },
    { section: "Objective Weights", field: "travel_weight", value: run.parameters.travelWeight },
    { section: "Objective Weights", field: "demand_weight", value: run.parameters.demandWeight },
    { section: "Objective Weights", field: "cooccurrence_weight", value: run.parameters.cooccurrenceWeight },
    { section: "Objective Weights", field: "time_limit_ms", value: run.parameters.timeLimitMs },
    { section: "Objective Weights", field: "seed", value: run.parameters.seed },
    { section: "Distance Model", field: "type", value: "Euclidean from station (0,0)" },
    { section: "Distance Model", field: "routing", value: "Simplified geometric (not aisle-constrained)" },
    { section: "Baseline Metrics", field: "total_distance", value: run.baseline.totalDistance },
    { section: "Baseline Metrics", field: "average_distance", value: run.baseline.averageDistance },
    { section: "Baseline Metrics", field: "estimated_throughput_per_hour", value: run.baseline.throughput },
    { section: "Baseline Metrics", field: "valid_assignments", value: run.baseline.validAssignments },
    { section: "Baseline Metrics", field: "constraint_violations", value: run.baseline.constraintViolations },
    { section: "Baseline Metrics", field: "feasible", value: String(run.baseline.constraintViolations === 0) },
    { section: "Optimized Metrics", field: "total_distance", value: run.optimized.totalDistance },
    { section: "Optimized Metrics", field: "average_distance", value: run.optimized.averageDistance },
    { section: "Optimized Metrics", field: "estimated_throughput_per_hour", value: run.optimized.throughput },
    { section: "Optimized Metrics", field: "valid_assignments", value: run.optimized.validAssignments },
    { section: "Improvement", field: "distance_absolute", value: metricDelta(run.baseline.totalDistance, run.optimized.totalDistance).absolute },
    { section: "Improvement", field: "distance_percent", value: metricDelta(run.baseline.totalDistance, run.optimized.totalDistance).percent },
    { section: "Improvement", field: "estimated_throughput_absolute", value: metricDelta(run.baseline.throughput, run.optimized.throughput).absolute },
    { section: "Improvement", field: "estimated_throughput_percent", value: metricDelta(run.baseline.throughput, run.optimized.throughput).percent },
    { section: "Constraint Validation", field: "checks_total", value: run.validation.checks },
    { section: "Constraint Validation", field: "checks_passed", value: run.validation.passed },
    { section: "Constraint Validation", field: "checks_failed", value: run.validation.failed },
    { section: "Constraint Validation", field: "feasible", value: String(run.validation.valid) },
    { section: "Constraint Validation", field: "violations", value: run.optimized.constraintViolations },
    { section: "Assignment Summary", field: "total_assigned", value: run.optimized.validAssignments },
    { section: "Assignment Summary", field: "unassigned", value: run.assignments.filter((a) => a.location_id === "UNASSIGNED").length },
    { section: "Assignment Summary", field: "slot_utilization", value: run.optimized.capacityUtilization },
    { section: "Assumptions", field: "note_1", value: "Travel uses simplified Euclidean geometry from pick station (0,0)" },
    { section: "Assumptions", field: "note_2", value: "Baseline is a deterministic randomized feasible matching; it does not use demand or travel scores and may be unassigned when no feasible matching exists" },
    { section: "Assumptions", field: "note_3", value: "Route distance not multiplied by order quantity" },
    { section: "Assumptions", field: "note_4", value: "Slot utilization is occupancy, not physical fill" },
    { section: "Assumptions", field: "note_5", value: "Throughput is a proxy derived from estimated pick seconds (55 + average route distance * 0.72), not measured warehouse productivity" },
  ];
  return toCsv(rows);
}

/** Get all unique order IDs from the dataset. */
export function getOrderIds(data: DatasetBundle): string[] {
  return [...new Set(data.orders.map((o) => o.order_id))];
}

/** Read-only compatibility path for an explicit user-initiated legacy import. */
export function loadLegacyDataset(): DatasetBundle | null {
  try {
    const value = localStorage.getItem(LEGACY_DATA_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<DatasetBundle>;
    return Array.isArray(parsed.layout) && Array.isArray(parsed.skus) && Array.isArray(parsed.orders)
      ? parsed as DatasetBundle
      : null;
  } catch {
    return null;
  }
}

export function downloadText(filename: string, content: string, type = "text/csv") { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
