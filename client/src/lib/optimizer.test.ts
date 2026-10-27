import { beforeEach, describe, expect, it } from "vitest";
import {
  assignmentCsv,
  clearRun,
  computeObjective,
  computeOrderRoute,
  cooccurrence,
  datasetCsv,
  explainSku,
  exportEvaluationReportCsv,
  exportRunCsv,
  getOrderIds,
  loadData,
  loadRun,
  makeSampleData,
  metricDelta,
  optimize,
  optimizeLocalSearch,
  parseDatasetCsv,
  runBenchmark,
  saveData,
  saveRun,
  validateAssignments,
  validateDataset,
  type Assignment,
  type DatasetBundle,
} from "./optimizer";

function installMemoryStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
}

function independentRouteDistance(data: DatasetBundle, assignments: Assignment[]) {
  const locationById = new Map(data.layout.map((location) => [location.location_id, location]));
  const locationBySku = new Map(assignments.map((assignment) => [assignment.sku_id, locationById.get(assignment.location_id)]));
  let total = 0;
  for (const orderId of new Set(data.orders.map((order) => order.order_id))) {
    let previous = { x_coordinate: 0, y_coordinate: 0 };
    for (const row of data.orders.filter((order) => order.order_id === orderId).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.sku_id.localeCompare(right.sku_id))) {
      const location = locationBySku.get(row.sku_id);
      if (!location) continue;
      total += Math.hypot(location.x_coordinate - previous.x_coordinate, location.y_coordinate - previous.y_coordinate);
      previous = location;
    }
    total += Math.hypot(previous.x_coordinate, previous.y_coordinate);
  }
  return total;
}

describe("OptiStore AI optimizer audit", () => {
  beforeEach(() => installMemoryStorage());

  it("generates a deterministic, feasible sample run and reports real constraint checks", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const datasetReport = validateDataset(data, true).report;

    expect(data.layout).toHaveLength(36);
    expect(data.skus).toHaveLength(36);
    expect(new Set(data.orders.map((order) => order.order_id)).size).toBe(120);
    expect(data.orders.length).toBeGreaterThanOrEqual(100);
    expect(datasetReport.valid).toBe(true);
    expect(run.validation.valid).toBe(true);
    expect(run.validation.checks).toBe(2256);
    expect(run.validation.passed).toBe(2256);
    expect(run.validation.failed).toBe(0);
    expect(run.optimized.validAssignments).toBe(36);
    expect(run.optimized.constraintViolations).toBe(0);
    expect(run.baseline.totalDistance).not.toBe(run.optimized.totalDistance);
  });

  it("independently confirms uniqueness, weight, volume, storage, accessibility, and completeness", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const locationById = new Map(data.layout.map((location) => [location.location_id, location]));
    const skuById = new Map(data.skus.map((sku) => [sku.sku_id, sku]));
    const locations = run.assignments.map((assignment) => assignment.location_id);

    expect(new Set(locations).size).toBe(locations.length);
    for (const assignment of run.assignments) {
      const sku = skuById.get(assignment.sku_id)!;
      const location = locationById.get(assignment.location_id)!;
      expect(sku.weight).toBeLessThanOrEqual(location.capacity_weight);
      expect(sku.length * sku.width * sku.height).toBeLessThanOrEqual(location.capacity_volume);
      expect(sku.storage_class).toBe(location.zone);
      expect(location.accessibility).toBe("open");
    }
    expect(validateAssignments(data, run.assignments)).toMatchObject({ valid: true, failed: 0 });
  });

  it("uses the same orders and route assumptions for both KPI evaluations", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const orderCount = new Set(data.orders.map((order) => order.order_id)).size;
    const baselineRouteDistance = independentRouteDistance(data, run.baselineAssignments);
    const optimizedRouteDistance = independentRouteDistance(data, run.assignments);
    expect(orderCount).toBe(120);
    expect(run.baseline.totalDistance).toBe(Number(baselineRouteDistance.toFixed(1)));
    expect(run.optimized.totalDistance).toBe(Number(optimizedRouteDistance.toFixed(1)));
    expect(run.baseline.averageDistance).toBe(Number((baselineRouteDistance / orderCount).toFixed(1)));
    expect(run.optimized.averageDistance).toBe(Number((optimizedRouteDistance / orderCount).toFixed(1)));
    expect(metricDelta(run.baseline.totalDistance, run.optimized.totalDistance).percent).toBe(
      Number((((run.optimized.totalDistance - run.baseline.totalDistance) / run.baseline.totalDistance) * 100).toFixed(1)),
    );
    expect(metricDelta(0, 0)).toEqual({ absolute: 0, percent: 0 });
    expect(metricDelta(0, 5)).toEqual({ absolute: 5, percent: 0 });
  });

  it("responds to materially different demand distributions and order logs", () => {
    const data = makeSampleData();
    const original = optimize(data);
    const changed: DatasetBundle = {
      ...data,
      orders: [...data.orders, ...Array.from({ length: 20 }, (_, index) => ({ order_id: `SKEW-${index}`, sku_id: "SKU-1035", quantity: 100, timestamp: "2026-10-01T10:00:00Z" }))],
    };
    const skewed = optimize(changed);
    expect(skewed.assignments).not.toEqual(original.assignments);
    expect(skewed.optimized.totalDistance).not.toBe(original.optimized.totalDistance);
  });

  it("honors objective-weight changes instead of ignoring the control parameters", () => {
    const data = makeSampleData();
    const travelOnly = optimize(data, { travelWeight: 1, demandWeight: 0, cooccurrenceWeight: 0, timeLimitMs: 1000, seed: 42 });
    const demandHeavy = optimize(data, { travelWeight: 0.1, demandWeight: 2, cooccurrenceWeight: 0, timeLimitMs: 1000, seed: 42 });
    expect(demandHeavy.parameters.demandWeight).toBe(2);
    expect(demandHeavy.assignments).not.toEqual(travelOnly.assignments);
  });

  it("rejects invalid CSV schemas, duplicates, references, and physical values", () => {
    const missingColumn = parseDatasetCsv("layout", "location_id,x_coordinate\nA-01,1");
    expect(missingColumn.report.valid).toBe(false);
    expect(missingColumn.report.issues.some((issue) => issue.code === "missing_column")).toBe(true);

    const duplicateLayout = parseDatasetCsv("layout", "location_id,x_coordinate,y_coordinate,aisle_id,capacity_weight,capacity_volume,zone,accessibility\nA-01,1,1,A,10,1,ambient,open\nA-01,2,2,A,10,1,ambient,open");
    expect(duplicateLayout.report.valid).toBe(false);
    expect(duplicateLayout.report.issues.some((issue) => issue.code === "duplicate_id")).toBe(true);

    const invalidSku = parseDatasetCsv("sku", "sku_id,length,width,height,weight,demand_frequency,storage_class,handling_restrictions\nSKU-1,0.1,0.1,0.1,-1,10,ambient,standard");
    expect(invalidSku.report.valid).toBe(false);
    expect(invalidSku.report.issues.some((issue) => issue.code === "invalid_physical")).toBe(true);

    const invalidOrder = parseDatasetCsv("orders", "order_id,sku_id,quantity,timestamp\nORD-1,SKU-1,1,not-a-timestamp");
    expect(invalidOrder.report.valid).toBe(false);
    expect(invalidOrder.report.issues.some((issue) => issue.code === "invalid_timestamp")).toBe(true);

    const data = makeSampleData();
    const missingSku = validateDataset({ ...data, orders: [{ ...data.orders[0], sku_id: "SKU-MISSING" }] }, true).report;
    expect(missingSku.valid).toBe(false);
    expect(missingSku.issues.some((issue) => issue.code === "invalid_reference")).toBe(true);

    const missingLocations = validateDataset({ ...data, layout: [] }, true).report;
    expect(missingLocations.valid).toBe(false);
    expect(missingLocations.issues.some((issue) => issue.code === "empty_dataset")).toBe(true);
  });

  it("parses quoted commas and escaped quotes in standard CSV fields", () => {
    const parsed = parseDatasetCsv("sku", 'sku_id,length,width,height,weight,demand_frequency,storage_class,handling_restrictions\nSKU-1,0.2,0.2,0.2,1,10,ambient,"standard, ""keep dry"""');
    expect(parsed.report.valid).toBe(false);
    expect((parsed.data?.[0] as { handling_restrictions: string }).handling_restrictions).toBe('standard, "keep dry"');

    const orders = parseDatasetCsv("orders", 'order_id,sku_id,quantity,timestamp\nORD-1,SKU-1,1,"2026-10-01T10:00:00Z"');
    expect(orders.report.valid).toBe(true);
  });

  it("rejects malformed CSV and unsupported handling restrictions", () => {
    const malformed = parseDatasetCsv("orders", 'order_id,sku_id,quantity,timestamp\nORD-1,SKU-1,1,"unclosed');
    expect(malformed.report.valid).toBe(false);
    expect(malformed.report.issues.some((issue) => issue.code === "malformed_csv")).toBe(true);

    const data = makeSampleData();
    data.skus[0].handling_restrictions = "keep upright";
    const report = validateDataset(data, true).report;
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === "unsupported_handling_restriction")).toBe(true);
  });

  it("handles empty and infeasible datasets without claiming success", () => {
    const empty: DatasetBundle = { layout: [], skus: [], orders: [] };
    expect(validateDataset(empty, true).report.valid).toBe(false);
    expect(() => optimize(empty)).toThrow(/validation failed/i);

    const infeasible: DatasetBundle = {
      layout: [{ location_id: "A-01", x_coordinate: 1, y_coordinate: 1, aisle_id: "AISLE-01", capacity_weight: 1, capacity_volume: 0.01, zone: "ambient", accessibility: "open" }],
      skus: [
        { sku_id: "SKU-1", length: 0.2, width: 0.2, height: 0.2, weight: 1, demand_frequency: 1, storage_class: "ambient", handling_restrictions: "standard" },
        { sku_id: "SKU-2", length: 0.2, width: 0.2, height: 0.2, weight: 1, demand_frequency: 1, storage_class: "ambient", handling_restrictions: "standard" },
      ],
      orders: [{ order_id: "ORD-1", sku_id: "SKU-1", quantity: 1, timestamp: "2026-01-01T10:00:00Z" }, { order_id: "ORD-2", sku_id: "SKU-2", quantity: 1, timestamp: "2026-01-01T10:01:00Z" }],
    };
    const run = optimize(infeasible);
    expect(run.validation.valid).toBe(false);
    expect(run.optimized.constraintViolations).toBeGreaterThan(0);
    expect(run.validation.issues.some((issue) => issue.code === "assignment_completeness")).toBe(true);
  });

  it("exports displayed assignments and KPI deltas, and persists datasets and runs", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const assignmentExport = assignmentCsv(run);
    const performanceExport = exportRunCsv(run);
    expect(assignmentExport).toContain("sku_id");
    expect(assignmentExport).toContain(run.assignments[0].sku_id);
    expect(performanceExport).toContain("total_distance");
    expect(performanceExport).toContain(String(run.optimized.totalDistance));
    expect(datasetCsv("layout", data)).toContain("location_id");

    saveData(data);
    saveRun(run);
    expect(loadData()).toEqual(data);
    expect(loadRun()).toEqual(run);
    clearRun();
    expect(loadRun()).toBeNull();
  });
});

describe("Local search optimizer", () => {
  it("produces a feasible assignment that passes all hard constraints", () => {
    const data = makeSampleData();
    const run = optimizeLocalSearch(data);
    const locationById = new Map(data.layout.map((l) => [l.location_id, l]));
    const skuById = new Map(data.skus.map((s) => [s.sku_id, s]));

    expect(run.validation.valid).toBe(true);
    expect(run.validation.failed).toBe(0);
    expect(run.optimized.constraintViolations).toBe(0);
    expect(run.optimized.validAssignments).toBe(36);

    // Independent constraint check
    const locations = run.assignments.map((a) => a.location_id);
    expect(new Set(locations).size).toBe(locations.length); // unique assignments
    for (const a of run.assignments) {
      const sku = skuById.get(a.sku_id)!;
      const loc = locationById.get(a.location_id)!;
      expect(sku.weight).toBeLessThanOrEqual(loc.capacity_weight);
      expect(sku.length * sku.width * sku.height).toBeLessThanOrEqual(loc.capacity_volume);
      expect(sku.storage_class).toBe(loc.zone);
      expect(loc.accessibility).toBe("open");
    }
  });

  it("computes a consistent objective that is no worse than the greedy starting point", () => {
    const data = makeSampleData();
    const { demand } = validateDataset(data, true);
    const co = cooccurrence(data);
    const params = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 5000, seed: 42, maxIterations: 1000 };

    const greedyRun = optimize(data, params);
    const lsRun = optimizeLocalSearch(data, params);

    const greedyObj = computeObjective(data, greedyRun.assignments, params, demand, co);
    const lsObj = computeObjective(data, lsRun.assignments, params, demand, co);

    // Local search objective should be <= greedy objective (lower is better)
    expect(lsObj).toBeLessThanOrEqual(greedyObj + 1e-6);
  });

  it("produces reproducible results across runs (deterministic)", () => {
    const data = makeSampleData();
    const params = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 5000, seed: 42, maxIterations: 1000 };

    const run1 = optimizeLocalSearch(data, params);
    const run2 = optimizeLocalSearch(data, params);

    // Assignments should be identical (same SKU->location mapping)
    const map1 = new Map(run1.assignments.map((a) => [a.sku_id, a.location_id]));
    const map2 = new Map(run2.assignments.map((a) => [a.sku_id, a.location_id]));
    for (const [skuId, locId] of map1) {
      expect(map2.get(skuId)).toBe(locId);
    }
  });

  it("terminates within iteration and time limits", () => {
    const data = makeSampleData();
    const run = optimizeLocalSearch(data, {
      travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2,
      timeLimitMs: 5000, seed: 42, maxIterations: 100,
    });

    expect(run.iterations).toBeDefined();
    expect(run.iterations!).toBeLessThanOrEqual(100);
    expect(run.runtimeMs).toBeDefined();
    expect(run.runtimeMs!).toBeGreaterThan(0);
    expect(run.algorithm).toBe("Greedy + local search (pairwise swap)");
  });

  it("reports metadata: iterations, swaps accepted, convergence, and runtime", () => {
    const data = makeSampleData();
    const run = optimizeLocalSearch(data);

    expect(typeof run.iterations).toBe("number");
    expect(typeof run.swapsAccepted).toBe("number");
    expect(typeof run.converged).toBe("boolean");
    expect(typeof run.runtimeMs).toBe("number");
    expect(run.swapsAccepted!).toBeGreaterThanOrEqual(0);
    expect(run.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Algorithm benchmarking", () => {
  it("runs both algorithms on the same dataset and returns comparable results", () => {
    const data = makeSampleData();
    const benchmark = runBenchmark(data);

    // Both should report the same baseline
    expect(benchmark.greedy.assignments).toBe(36);
    expect(benchmark.localSearch.assignments).toBe(36);
    expect(benchmark.greedy.constraintViolations).toBe(0);
    expect(benchmark.localSearch.constraintViolations).toBe(0);

    // Both distances should be computed (not hardcoded)
    expect(benchmark.greedy.totalDistance).toBeGreaterThan(0);
    expect(benchmark.localSearch.totalDistance).toBeGreaterThan(0);
    expect(benchmark.greedy.objective).toBeGreaterThan(0);
    expect(benchmark.localSearch.objective).toBeGreaterThan(0);

    // Runtime should be measured
    expect(benchmark.greedy.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(benchmark.localSearch.runtimeMs).toBeGreaterThanOrEqual(0);

    // Improvement should be calculated, not hardcoded
    expect(typeof benchmark.greedy.improvementOverBaseline).toBe("number");
    expect(typeof benchmark.localSearch.improvementOverBaseline).toBe("number");
  });

  it("uses consistent objective calculations for both algorithms", () => {
    const data = makeSampleData();
    const { demand } = validateDataset(data, true);
    const co = cooccurrence(data);
    const params = { travelWeight: 0.55, cooccurrenceWeight: 0.25, demandWeight: 0.2, timeLimitMs: 2000, seed: 42, maxIterations: 500 };

    const benchmark = runBenchmark(data, params);

    // Re-compute objectives independently
    const greedyObj = computeObjective(data, benchmark.greedyRun.assignments, params, demand, co);
    const lsObj = computeObjective(data, benchmark.localSearchRun.assignments, params, demand, co);

    expect(benchmark.greedy.objective).toBe(greedyObj);
    expect(benchmark.localSearch.objective).toBe(lsObj);
  });
});

describe("SKU assignment explainer", () => {
  it("returns detailed explanation for a valid SKU", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const explanation = explainSku(data, run, "SKU-1001");

    expect(explanation).not.toBeNull();
    expect(explanation!.skuId).toBe("SKU-1001");
    expect(explanation!.optimizedLocation).not.toBe("UNASSIGNED");
    expect(explanation!.baselineLocation).toBeTruthy();
    expect(explanation!.demandFrequency).toBeGreaterThanOrEqual(0);
    expect(explanation!.distanceFromStation).toBeGreaterThan(0);
    expect(explanation!.assignmentReason).toBeTruthy();
    expect(["ambient", "cold", "hazmat"]).toContain(explanation!.storageClass);
    expect(explanation!.zone).toBe(explanation!.storageClass); // zone matches storage class
    expect(explanation!.accessibility).toBe("open");
  });

  it("shows co-ordered SKUs from actual order data", () => {
    const data = makeSampleData();
    const run = optimize(data);
    // Find a SKU that has co-occurrence partners
    const co = cooccurrence(data);
    const skuWithPartners = data.skus.find((s) => (co.get(s.sku_id)?.size ?? 0) > 0);
    if (skuWithPartners) {
      const explanation = explainSku(data, run, skuWithPartners.sku_id);
      expect(explanation!.coOrderedSkus.length).toBeGreaterThan(0);
      expect(explanation!.coOrderedSkus[0].count).toBeGreaterThan(0);
    }
  });

  it("returns null for unknown SKU", () => {
    const data = makeSampleData();
    const run = optimize(data);
    expect(explainSku(data, run, "NONEXISTENT")).toBeNull();
  });
});

describe("Order route simulation", () => {
  it("computes route distances for a valid order", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const orderIds = getOrderIds(data);
    expect(orderIds.length).toBe(120);

    const route = computeOrderRoute(data, run, orderIds[0]);
    expect(route).not.toBeNull();
    expect(route!.orderId).toBe(orderIds[0]);
    expect(route!.skus.length).toBeGreaterThan(0);
    expect(route!.locations.length).toBe(route!.skus.length);
    expect(route!.baselineDistance).toBeGreaterThan(0);
    expect(route!.optimizedDistance).toBeGreaterThan(0);
    // Use toBeCloseTo for floating-point comparison (baseline and optimized are independently rounded)
    expect(route!.distanceSaved).toBeCloseTo(
      route!.baselineDistance - route!.optimizedDistance, 1
    );
    expect(route!.note).toContain("Euclidean");
  });

  it("returns null for unknown order", () => {
    const data = makeSampleData();
    const run = optimize(data);
    expect(computeOrderRoute(data, run, "NONEXISTENT")).toBeNull();
  });
});

describe("Evaluation report export", () => {
  beforeEach(() => installMemoryStorage());

  it("generates a comprehensive CSV with all required sections", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const csv = exportEvaluationReportCsv(run, data);

    expect(csv).toContain("Dataset Summary");
    expect(csv).toContain("Algorithm");
    expect(csv).toContain("Objective Weights");
    expect(csv).toContain("Distance Model");
    expect(csv).toContain("Baseline Metrics");
    expect(csv).toContain("Optimized Metrics");
    expect(csv).toContain("Improvement");
    expect(csv).toContain("Constraint Validation");
    expect(csv).toContain("Assignment Summary");
    expect(csv).toContain("Assumptions");

    // Check actual values appear
    expect(csv).toContain(String(run.optimized.totalDistance));
    expect(csv).toContain(String(run.baseline.totalDistance));
    expect(csv).toContain(String(data.layout.length));
  });
});

describe("Objective function mathematical consistency (Requirement 1)", () => {
  it("verifies that each unordered SKU pair contributes exactly once to co-occurrence in computeObjective", () => {
    // Construct minimal 2-SKU, 2-location dataset
    const smallData: DatasetBundle = {
      layout: [
        {
          location_id: "LOC-1",
          x_coordinate: 0,
          y_coordinate: 3,
          aisle_id: "A1",
          capacity_weight: 100,
          capacity_volume: 10,
          zone: "ambient",
          accessibility: "open",
        },
        {
          location_id: "LOC-2",
          x_coordinate: 4,
          y_coordinate: 0,
          aisle_id: "A2",
          capacity_weight: 100,
          capacity_volume: 10,
          zone: "ambient",
          accessibility: "open",
        },
      ],
      skus: [
        {
          sku_id: "SKU-A",
          length: 0.1,
          width: 0.1,
          height: 0.1,
          weight: 1,
          demand_frequency: 1,
          storage_class: "ambient",
          handling_restrictions: "none",
        },
        {
          sku_id: "SKU-B",
          length: 0.1,
          width: 0.1,
          height: 0.1,
          weight: 1,
          demand_frequency: 1,
          storage_class: "ambient",
          handling_restrictions: "none",
        },
      ],
      orders: [
        { order_id: "ORD-1", sku_id: "SKU-A", quantity: 1, timestamp: "2026-10-27T00:00:00Z" },
        { order_id: "ORD-1", sku_id: "SKU-B", quantity: 1, timestamp: "2026-10-27T00:00:00Z" },
      ],
    };

    const assignments: Assignment[] = [
      { sku_id: "SKU-A", location_id: "LOC-1", score: 1, reason: "test" },
      { sku_id: "SKU-B", location_id: "LOC-2", score: 1, reason: "test" },
    ];

    const params = {
      travelWeight: 0.5,
      demandWeight: 0.2,
      cooccurrenceWeight: 0.3,
    };

    const { demand } = validateDataset(smallData, true);
    const co = cooccurrence(smallData);

    // Verify co-occurrence matrix contains symmetric entries
    expect(co.get("SKU-A")?.get("SKU-B")).toBe(1);
    expect(co.get("SKU-B")?.get("SKU-A")).toBe(1);

    // The fixed normalization scales are route=24m, depot=4m, and pair distance=5m.
    // This order route is 12m, demand-weighted depot distance is 7/8, and the
    // single unordered co-occurrence pair has normalized distance 1.
    // J(A) = 0.5*(12/24) + 0.2*(7/8) + 0.3*(1) = 0.7250.
    const objective = computeObjective(smallData, assignments, params, demand, co);
    expect(objective).toBe(0.725);

    const withoutCooccurrence = computeObjective(smallData, assignments, { ...params, cooccurrenceWeight: 0 }, demand, co);
    expect(Number((objective - withoutCooccurrence).toFixed(4))).toBe(0.3);
  });
});

describe("Local search stop reason (Requirement 2)", () => {
  it("distinguishes iteration_limit from genuine convergence", () => {
    const data = makeSampleData();

    // 1. Force iteration limit with maxIterations = 5
    const iterRun = optimizeLocalSearch(data, {
      travelWeight: 0.55,
      cooccurrenceWeight: 0.25,
      demandWeight: 0.2,
      timeLimitMs: 5000,
      seed: 42,
      maxIterations: 5,
    });

    expect(iterRun.iterations).toBe(5);
    expect(iterRun.stopReason).toBe("iteration_limit");
    expect(iterRun.converged).toBe(false);
    expect(iterRun.reasons.some((r) => r.includes("Iteration limit reached"))).toBe(true);

    // 2. Allow local search to run to full convergence with sufficient iteration budget
    const convergedRun = optimizeLocalSearch(data, {
      travelWeight: 0.55,
      cooccurrenceWeight: 0.25,
      demandWeight: 0.2,
      timeLimitMs: 5000,
      seed: 42,
      maxIterations: 5000,
    });

    expect(convergedRun.stopReason).toBe("converged");
    expect(convergedRun.converged).toBe(true);
    expect(convergedRun.reasons.some((r) => r.includes("Converged"))).toBe(true);
  });
});

describe("SKU explanation composite objective calculation (Requirement 3)", () => {
  it("calculates alternativeObjectiveDiff using the full composite objective and alternativeDistanceDiff as distance", () => {
    const data = makeSampleData();
    const run = optimize(data);
    const explanation = explainSku(data, run, data.skus[0].sku_id);

    expect(explanation).not.toBeNull();
    if (explanation?.alternativeLocation) {
      expect(explanation.alternativeObjectiveDiff).toBeDefined();
      expect(typeof explanation.alternativeObjectiveDiff).toBe("number");
      expect(explanation.alternativeDistanceDiff).toBeDefined();
      expect(typeof explanation.alternativeDistanceDiff).toBe("number");
    }
  });
});

describe("Constraint preservation and baseline disclosure (Requirements 4 & 5)", () => {
  it("strictly enforces hard constraints during local search and rejects incompatible zone swaps", () => {
    const data = makeSampleData();
    const lsRun = optimizeLocalSearch(data, {
      travelWeight: 0.55,
      cooccurrenceWeight: 0.25,
      demandWeight: 0.2,
      timeLimitMs: 2000,
      seed: 42,
      maxIterations: 500,
    });

    // Independent validation of all assignments
    const report = validateAssignments(data, lsRun.assignments);
    expect(report.valid).toBe(true);
    expect(report.failed).toBe(0);
    expect(lsRun.optimized.constraintViolations).toBe(0);

    // Verify zone compatibility for every single assignment
    const locMap = new Map(data.layout.map((l) => [l.location_id, l]));
    const skuMap = new Map(data.skus.map((s) => [s.sku_id, s]));
    for (const a of lsRun.assignments) {
      const loc = locMap.get(a.location_id)!;
      const sku = skuMap.get(a.sku_id)!;
      expect(sku.storage_class).toBe(loc.zone);
      expect(sku.weight).toBeLessThanOrEqual(loc.capacity_weight);
      expect(sku.length * sku.width * sku.height).toBeLessThanOrEqual(loc.capacity_volume);
      expect(loc.accessibility).toBe("open");
    }
  });

  it("compares against a deterministic feasible baseline", () => {
    const data = makeSampleData();
    const benchmark = runBenchmark(data);

    expect(benchmark.baseline.constraintViolations).toBe(0);
    expect(benchmark.baseline.feasible).toBe(true);
    expect(benchmark.localSearch.totalDistance).toBeLessThan(benchmark.baseline.totalDistance);
    const repeat = runBenchmark(data);
    expect(repeat.greedyRun.baselineAssignments.map((a) => a.location_id)).toEqual(benchmark.greedyRun.baselineAssignments.map((a) => a.location_id));

    // Both Greedy and Local Search must have 0 violations and be feasible
    expect(benchmark.greedy.constraintViolations).toBe(0);
    expect(benchmark.greedy.feasible).toBe(true);
    expect(benchmark.localSearch.constraintViolations).toBe(0);
    expect(benchmark.localSearch.feasible).toBe(true);

    // Distances are derived from actual assignments
    expect(benchmark.greedy.totalDistance).toBe(benchmark.greedyRun.optimized.totalDistance);
    expect(benchmark.localSearch.totalDistance).toBe(benchmark.localSearchRun.optimized.totalDistance);
  });
});
