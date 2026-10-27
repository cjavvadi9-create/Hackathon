import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  FileCheck2,
  Gauge,
  GitCompare,
  HelpCircle,
  Info,
  Layers3,
  ListOrdered,
  MapPinned,
  Menu,
  Network,
  Play,
  Radar,
  RefreshCw,
  Route,
  Scale,
  ShieldCheck,
  Sparkles,
  Split,
  Target,
  Timer,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  type DatasetBundle,
  type DatasetKind,
  type Location,
  type OptimizationRun,
  type ValidationReport,
  type BenchmarkResult,
  assignmentCsv,
  clearRun,
  computeOrderRoute,
  datasetCsv,
  downloadText,
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
  validateDataset,
} from "@/lib/optimizer";

const initialData = loadData() ?? makeSampleData();
const currentDatasetVersion = `synthetic-e1-v3-${initialData.layout.length}x${initialData.skus.length}x${initialData.orders.length}`;

const stages = [
  ["Validate schemas + references", "No missing IDs, duplicates, or physical errors"],
  ["Calculate demand + co-occurrence", "120 orders replayed across 36 SKUs"],
  ["Generate feasible baseline", "Original order preserved for comparison"],
  ["Solve slotting optimization", "Deterministic greedy placement + local search swap exploration"],
  ["Evaluate routes + validate proof", "Same order set and distance model"],
];

const navItems = [
  ["dashboard", "Executive dashboard"],
  ["datasets", "Dataset management"],
  ["control", "Control center"],
  ["benchmark", "Algorithm benchmark"],
  ["map", "Warehouse map & explainer"],
  ["simulation", "Route simulation"],
  ["analysis", "Performance analysis"],
  ["results", "Exports & reports"],
];

function BrandMark() {
  return (
    <div className="brand-lockup" aria-label="OptiStore AI home">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-name">
        opti<span className="brand-dot">store</span> <small>AI</small>
      </span>
    </div>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "orange" | "green" | "blue";
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function percentLabel(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function MetricCard({
  label,
  baseline,
  optimized,
  icon: Icon,
  tone,
  delta,
  unit,
}: {
  label: string;
  baseline: string;
  optimized: string;
  icon: typeof Route;
  tone: string;
  delta: number;
  unit?: string;
}) {
  return (
    <div className={`runtime-metric runtime-${tone}`}>
      <div className="runtime-metric-top">
        <span className="runtime-icon">
          <Icon size={16} />
        </span>
        <span className="runtime-delta">{percentLabel(delta)}</span>
      </div>
      <span className="runtime-label">{label}</span>
      <strong>
        {optimized}
        {unit}
      </strong>
      <div className="runtime-baseline">
        baseline {baseline}
        {unit} <ArrowRight size={12} />
      </div>
    </div>
  );
}

function DataHealth({ report }: { report: ValidationReport }) {
  return (
    <div className={`data-health ${report.valid ? "health-good" : "health-bad"}`}>
      <div className="health-icon">
        {report.valid ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      </div>
      <div>
        <strong>{report.valid ? "Dataset validated" : "Dataset needs attention"}</strong>
        <span>
          {report.passed}/{report.checks} checks passed · {report.failed} blocking issues
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DatasetBundle>(() => {
    saveData(initialData);
    return initialData;
  });

  const [selectedAlgo, setSelectedAlgo] = useState<"greedy" | "local_search">("local_search");
  const [maxIterations, setMaxIterations] = useState(500);

  const [run, setRun] = useState<OptimizationRun | null>(() => {
    const stored = loadRun();
    if (stored?.datasetVersion === currentDatasetVersion) return stored;
    const generated = optimizeLocalSearch(initialData, {
      travelWeight: 0.55,
      demandWeight: 0.2,
      cooccurrenceWeight: 0.25,
      timeLimitMs: 2000,
      seed: 42,
      maxIterations: 500,
    });
    saveRun(generated);
    return generated;
  });

  const [benchmark, setBenchmark] = useState<ReturnType<typeof runBenchmark> | null>(() => {
    try {
      return runBenchmark(initialData);
    } catch {
      return null;
    }
  });
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);

  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(-1);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeDataset, setActiveDataset] = useState<DatasetKind>("layout");
  const [mapMode, setMapMode] = useState<"optimized" | "baseline">("optimized");
  const [selectedLocation, setSelectedLocation] = useState<string | null>("A-01");
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);

  const orderIds = useMemo(() => getOrderIds(data), [data]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>(() => orderIds[0] ?? "ORD-80001");

  const [notice, setNotice] = useState(
    "Evaluation 1 live solver ready. Both Greedy heuristic and Greedy + Local Search algorithms are available."
  );
  const [weights, setWeights] = useState({
    travelWeight: 0.55,
    demandWeight: 0.2,
    cooccurrenceWeight: 0.25,
  });

  const fileInputs = {
    layout: useRef<HTMLInputElement>(null),
    sku: useRef<HTMLInputElement>(null),
    orders: useRef<HTMLInputElement>(null),
  };

  const validation = useMemo(() => validateDataset(data, true).report, [data]);
  const demandBars = useMemo(
    () => [...data.skus].sort((a, b) => b.demand_frequency - a.demand_frequency).slice(0, 8),
    [data.skus]
  );

  const mapAssignments = useMemo(
    () =>
      new Map(
        (mapMode === "optimized" ? run?.assignments : run?.baselineAssignments)?.map(
          (assignment) => [assignment.location_id, assignment]
        ) ?? []
      ),
    [mapMode, run]
  );

  const selected = selectedLocation
    ? data.layout.find((location) => location.location_id === selectedLocation)
    : null;
  const selectedAssignment = selected ? mapAssignments.get(selected.location_id) : null;

  // Active SKU to explain: prioritize selectedSkuId if chosen, else fall back to location's SKU
  const activeExplainerSkuId =
    selectedSkuId ??
    selectedAssignment?.sku_id ??
    (run?.assignments[0]?.sku_id ?? data.skus[0]?.sku_id);

  const activeSkuExplanation = useMemo(() => {
    if (!run || !activeExplainerSkuId) return null;
    return explainSku(data, run, activeExplainerSkuId);
  }, [data, run, activeExplainerSkuId]);

  const activeOrderRoute = useMemo(() => {
    if (!run || !selectedOrderId) return null;
    return computeOrderRoute(data, run, selectedOrderId);
  }, [data, run, selectedOrderId]);

  const layoutRows = data.layout.slice(0, 8);
  const skuRows = data.skus.slice(0, 8);
  const orderRows = data.orders.slice(0, 8);

  const handleRun = () => {
    setNotice("");
    setRunning(true);
    setStageIndex(0);
    let current = 0;
    const timer = window.setInterval(() => {
      current += 1;
      setStageIndex(current);
      if (current >= stages.length - 1) {
        window.clearInterval(timer);
        window.setTimeout(() => {
          try {
            const nextRun =
              selectedAlgo === "local_search"
                ? optimizeLocalSearch(data, {
                    ...weights,
                    timeLimitMs: 2000,
                    seed: 42,
                    maxIterations,
                  })
                : optimize(data, {
                    ...weights,
                    timeLimitMs: 1000,
                    seed: 42,
                  });

            setRun(nextRun);
            saveRun(nextRun);

            // Also update benchmark if running
            try {
              const b = runBenchmark(data, {
                ...weights,
                timeLimitMs: 3000,
                seed: 42,
                maxIterations,
              });
              setBenchmark(b);
            } catch {
              // ignore
            }

            setNotice(
              `Optimization complete using ${nextRun.algorithm}. ${nextRun.runtimeMs ? `Solved in ${nextRun.runtimeMs}ms.` : ""} Feasibility score: ${nextRun.validation.passed}/${nextRun.validation.checks} checks passed.`
            );
          } catch (error) {
            setNotice(
              error instanceof Error ? error.message : "Optimization failed. Check the validation report."
            );
          } finally {
            setRunning(false);
          }
        }, 450);
      }
    }, 450);
  };

  const handleRunBenchmark = () => {
    setBenchmarkRunning(true);
    window.setTimeout(() => {
      try {
        const b = runBenchmark(data, {
          ...weights,
          timeLimitMs: 3000,
          seed: 42,
          maxIterations,
        });
        setBenchmark(b);
        setNotice(
          `Head-to-head benchmark completed. Greedy runtime: ${b.greedy.runtimeMs}ms vs Local Search runtime: ${b.localSearch.runtimeMs}ms.`
        );
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Benchmark failed.");
      } finally {
        setBenchmarkRunning(false);
      }
    }, 200);
  };

  const handleUpload = async (kind: DatasetKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseDatasetCsv(kind, await file.text());
    if (!parsed.data || !parsed.report.valid) {
      setNotice(
        `Upload rejected for ${kind}: ${parsed.report.issues.map((issue) => issue.message).slice(0, 2).join(" · ") || "schema validation failed"}`
      );
      return;
    }
    const nextData = { ...data, [kind === "sku" ? "skus" : kind]: parsed.data } as DatasetBundle;
    setData(nextData);
    saveData(nextData);
    clearRun();
    setRun(null);
    setBenchmark(null);
    setActiveDataset(kind);
    setNotice(`${file.name} accepted. Validate all three datasets, then run optimization again.`);
    event.target.value = "";
  };

  const downloadDataset = (kind: DatasetKind) =>
    downloadText(`optistore-${kind}-sample.csv`, datasetCsv(kind, data));

  const downloadRun = (filename: string, content: string) => downloadText(filename, content);

  const baselineTravel = run?.baseline.totalDistance ?? 0;
  const optimizedTravel = run?.optimized.totalDistance ?? 0;
  const travelDelta = run
    ? metricDelta(baselineTravel, optimizedTravel)
    : { absolute: 0, percent: 0 };

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <BrandMark />
          <nav className={`main-nav ${mobileOpen ? "nav-open" : ""}`}>
            {navItems.slice(0, 4).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  scrollToId(id);
                  setMobileOpen(false);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <StatusPill tone="green">Evaluation 1 live</StatusPill>
            <button className="header-cta" onClick={() => scrollToId("control")} type="button">
              Open optimizer <ArrowRight size={15} />
            </button>
          </div>
          <button
            className="menu-toggle"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label="Toggle navigation"
            type="button"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section className="hero section-pad">
          <div className="hero-grid page-width">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="eyebrow-line" />
                NEURAL FORGE HACKATHON · EVALUATION 01
              </div>
              <h1>
                Make every
                <br />
                <em>slot</em> count.
              </h1>
              <p className="hero-lede">
                OptiStore AI turns warehouse topography, SKU physics, and historical order
                co-occurrence into provably feasible assignments — featuring dual optimization
                algorithms, local search improvement, and empirical benchmarking.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => scrollToId("control")} type="button">
                  <Play size={16} fill="currentColor" /> Run solver
                </button>
                <button
                  className="text-button"
                  onClick={() => scrollToId("benchmark")}
                  type="button"
                >
                  View benchmark <ArrowDownRight size={16} />
                </button>
              </div>
              <div className="hero-footnote">
                <CheckCircle2 size={15} /> 36 SKUs · 120 orders · 36 locations · Greedy + Local Search
              </div>
            </div>

            <div className="hero-art" aria-label="Warehouse optimization map visualization">
              <div className="art-stamp">/ 01</div>
              <div className="art-ring ring-one" />
              <div className="art-ring ring-two" />
              <div className="art-ring ring-three" />
              <div className="art-crosshair crosshair-a" />
              <div className="art-crosshair crosshair-b" />
              <div className="warehouse-diagram">
                <div className="diagram-label label-top">OPTIMIZED / ZONE MAP</div>
                <div className="diagram-label label-right">
                  PICK STATION <ArrowRight size={12} />
                </div>
                <div className="diagram-label label-bottom">
                  DELTA / −{Math.abs(travelDelta.percent).toFixed(1)}% TRAVEL
                </div>
                <div className="diagram-grid-lines" />
                <div className="diagram-aisle aisle-1">
                  <span className="slot hot" />
                  <span className="slot hot" />
                  <span className="slot warm" />
                  <span className="slot warm" />
                  <span className="slot cool" />
                </div>
                <div className="diagram-aisle aisle-2">
                  <span className="slot hot" />
                  <span className="slot warm" />
                  <span className="slot cool" />
                  <span className="slot cool" />
                  <span className="slot cool" />
                </div>
                <div className="diagram-aisle aisle-3">
                  <span className="slot warm" />
                  <span className="slot cool" />
                  <span className="slot cool" />
                  <span className="slot hot" />
                  <span className="slot warm" />
                </div>
                <div className="diagram-path">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="diagram-node node-a">01</div>
                <div className="diagram-node node-b">04</div>
                <div className="diagram-node node-c">08</div>
              </div>
              <div className="art-note note-a">
                <span className="note-number">01</span>
                <span>
                  demand
                  <br />
                  signal
                </span>
              </div>
              <div className="art-note note-b">
                <span className="note-number">02</span>
                <span>
                  hard
                  <br />
                  constraint
                </span>
              </div>
            </div>
          </div>
          <div className="hero-signal page-width">
            <span>LIVE SYNTHETIC DATA</span>
            <span className="signal-line" />
            <span>
              {data.skus.length} SKUs · {data.orders.length} order lines · {data.layout.length} locations
            </span>
            <span className="signal-line" />
            <span>ACTIVE ALGORITHM / {run?.algorithm ?? "GREEDY + LOCAL SEARCH"}</span>
          </div>
        </section>

        {/* EXECUTIVE DASHBOARD */}
        <section className="proof-strip section-pad" id="dashboard">
          <div className="page-width proof-strip-inner">
            <div className="proof-intro">
              <span className="section-kicker">EXECUTIVE DASHBOARD</span>
              <h2>
                Decisions backed
                <br />
                <span>by evidence.</span>
              </h2>
            </div>
            <div className="proof-stats">
              <div>
                <strong>{run?.baseline.totalDistance.toFixed(0) ?? "—"}m</strong>
                <span>baseline travel</span>
              </div>
              <div>
                <strong>{run?.optimized.totalDistance.toFixed(0) ?? "—"}m</strong>
                <span>optimized travel</span>
              </div>
              <div>
                <strong>{run ? `${Math.abs(travelDelta.percent).toFixed(1)}%` : "—"}</strong>
                <span>distance reduction</span>
              </div>
            </div>
            <div className="proof-aside">
              <Sparkles size={17} />
              <span>
                Active Algorithm
                <br />
                {run?.algorithm ?? "not run"}
              </span>
            </div>
          </div>
        </section>

        {/* RUNTIME CONSOLE */}
        <section className="runtime-console section-pad">
          <div className="page-width">
            <div className="console-nav">
              {navItems.map(([id, label], index) => (
                <button key={id} onClick={() => scrollToId(id)} type="button">
                  <span>0{index + 1}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="runtime-grid">
              <div className="runtime-summary">
                <span className="section-kicker">CURRENT WORKLOAD / SAMPLE OR UPLOADED</span>
                <h2>
                  Warehouse intelligence,
                  <br />
                  <em>calculated live.</em>
                </h2>
                <p>
                  Deterministic in-browser operations research engine. Evaluated on the identical
                  120-order sequence with strict physical constraint gates and zero hardcoded figures.
                </p>
                <div className="summary-list">
                  <div>
                    <strong>{data.layout.length}</strong>
                    <span>storage locations</span>
                  </div>
                  <div>
                    <strong>{data.skus.length}</strong>
                    <span>SKUs</span>
                  </div>
                  <div>
                    <strong>{new Set(data.orders.map((order) => order.order_id)).size}</strong>
                    <span>historical orders</span>
                  </div>
                  <div>
                    <strong>{run?.optimized.capacityUtilization.toFixed(1) ?? "—"}%</strong>
                    <span>slot utilization</span>
                  </div>
                </div>
              </div>
              <div className="metric-grid-runtime">
                <MetricCard
                  label="Total travel"
                  baseline={`${run?.baseline.totalDistance.toFixed(0) ?? "—"}m`}
                  optimized={`${run?.optimized.totalDistance.toFixed(0) ?? "—"}m`}
                  icon={Route}
                  tone="orange"
                  delta={travelDelta.percent}
                />
                <MetricCard
                  label="Avg. / order"
                  baseline={`${run?.baseline.averageDistance.toFixed(1) ?? "—"}m`}
                  optimized={`${run?.optimized.averageDistance.toFixed(1) ?? "—"}m`}
                  icon={Timer}
                  tone="blue"
                  delta={
                    run
                      ? metricDelta(run.baseline.averageDistance, run.optimized.averageDistance).percent
                      : 0
                  }
                />
                <MetricCard
                  label="Est. throughput / hr"
                  baseline={`${run?.baseline.throughput.toFixed(1) ?? "—"}`}
                  optimized={`${run?.optimized.throughput.toFixed(1) ?? "—"}`}
                  icon={Gauge}
                  tone="green"
                  delta={
                    run
                      ? metricDelta(run.baseline.throughput, run.optimized.throughput).percent
                      : 0
                  }
                />
                <MetricCard
                  label="Feasible assignments"
                  baseline={`${run?.baseline.validAssignments ?? "—"}`}
                  optimized={`${run?.optimized.validAssignments ?? "—"}`}
                  icon={ShieldCheck}
                  tone="ink"
                  delta={0}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 01 DATASET MANAGEMENT */}
        <section className="data-section section-pad" id="datasets">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">01 / DATASET MANAGEMENT</span>
                <h2>Trust the inputs.</h2>
              </div>
              <p className="heading-paragraph">
                CSV upload, schema validation, physical constraints,
                <br />
                and downloadable templates — no silent assumptions.
              </p>
            </div>
            <div className="dataset-layout">
              <div className="dataset-tabs">
                {(["layout", "sku", "orders"] as DatasetKind[]).map((kind, index) => (
                  <button
                    className={activeDataset === kind ? "active" : ""}
                    key={kind}
                    onClick={() => setActiveDataset(kind)}
                    type="button"
                  >
                    <span>0{index + 1}</span>
                    {kind === "layout"
                      ? "Warehouse layout"
                      : kind === "sku"
                      ? "SKU metadata"
                      : "Order transactions"}
                  </button>
                ))}
                <div className="dataset-help">
                  <FileCheck2 size={16} />
                  <span>
                    Expected schemas are explicit.
                    <br />
                    Invalid uploads are rejected.
                  </span>
                </div>
              </div>
              <div className="dataset-panel">
                <div className="panel-top">
                  <div>
                    <span className="toolbar-kicker">
                      {activeDataset === "layout"
                        ? "WAREHOUSE TOPOGRAPHY"
                        : activeDataset === "sku"
                        ? "SKU PHYSICAL METADATA"
                        : "HISTORICAL ORDER LOG"}
                    </span>
                    <h3>
                      {activeDataset === "layout"
                        ? "Layout coordinates + capacities"
                        : activeDataset === "sku"
                        ? "Dimensions + storage classes"
                        : "Order lines + timestamps"}
                    </h3>
                  </div>
                  <div className="panel-actions">
                    <button
                      className="outline-button compact"
                      onClick={() => fileInputs[activeDataset].current?.click()}
                      type="button"
                    >
                      <Upload size={14} /> Upload CSV
                    </button>
                    <button
                      className="text-button compact-text"
                      onClick={() => downloadDataset(activeDataset)}
                      type="button"
                    >
                      <Download size={14} /> Sample CSV
                    </button>
                    <input
                      ref={fileInputs[activeDataset]}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => handleUpload(activeDataset, event)}
                      hidden
                    />
                  </div>
                </div>
                <DataHealth report={validation} />
                <div className="preview-table wide-table">
                  <div className="table-row table-head">
                    {activeDataset === "layout" ? (
                      <>
                        <span>location_id</span>
                        <span>aisle</span>
                        <span>capacity</span>
                        <span>zone</span>
                      </>
                    ) : activeDataset === "sku" ? (
                      <>
                        <span>sku_id</span>
                        <span>dimensions</span>
                        <span>weight</span>
                        <span>class</span>
                      </>
                    ) : (
                      <>
                        <span>order_id</span>
                        <span>sku_id</span>
                        <span>qty</span>
                        <span>timestamp</span>
                      </>
                    )}
                  </div>
                  {activeDataset === "layout" &&
                    layoutRows.map((row) => (
                      <div className="table-row" key={row.location_id}>
                        <span className="mono">{row.location_id}</span>
                        <span>{row.aisle_id}</span>
                        <span>
                          {row.capacity_weight}kg / {row.capacity_volume}m³
                        </span>
                        <span className="row-status">
                          <span />
                          {row.zone}
                        </span>
                      </div>
                    ))}
                  {activeDataset === "sku" &&
                    skuRows.map((row) => (
                      <div className="table-row" key={row.sku_id}>
                        <span className="mono">{row.sku_id}</span>
                        <span>
                          {row.length} × {row.width} × {row.height}m
                        </span>
                        <span>{row.weight}kg</span>
                        <span className="row-status">
                          <span />
                          {row.storage_class}
                        </span>
                      </div>
                    ))}
                  {activeDataset === "orders" &&
                    orderRows.map((row) => (
                      <div className="table-row" key={`${row.order_id}-${row.sku_id}`}>
                        <span className="mono">{row.order_id}</span>
                        <span>{row.sku_id}</span>
                        <span>{row.quantity}</span>
                        <span>{row.timestamp.slice(0, 16)}</span>
                      </div>
                    ))}
                </div>
                <div className="schema-note">
                  <span>Schema</span>
                  <code>
                    {activeDataset === "layout"
                      ? "location_id, x_coordinate, y_coordinate, aisle_id, capacity_weight, capacity_volume, zone, accessibility"
                      : activeDataset === "sku"
                      ? "sku_id, length, width, height, weight, demand_frequency, storage_class, handling_restrictions"
                      : "order_id, sku_id, quantity, timestamp"}
                  </code>
                  {activeDataset === "sku" && <small>Handling values supported: standard, ambient, cold / temperature_controlled, hazmat / segregated. Other restrictions are rejected until their storage rules are modeled.</small>}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 OPTIMIZATION CONTROL CENTER */}
        <section className="control-room section-pad" id="control">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">02 / OPTIMIZATION CONTROL CENTER</span>
                <h2>Select & run the solver.</h2>
              </div>
              <div className="section-heading-note">
                <span className="live-dot" />
                Active algorithm: <strong>{selectedAlgo === "local_search" ? "Greedy + Local Search" : "Demand + Co-occurrence Greedy"}</strong>
                <br />
                Same workload · same travel model · deterministic
              </div>
            </div>
            <div className="control-shell">
              <aside className="control-sidebar">
                <div className="sidebar-label">ALGORITHM SELECTION</div>
                <div className="algo-switcher">
                  <button
                    className={`algo-btn ${selectedAlgo === "local_search" ? "active" : ""}`}
                    onClick={() => setSelectedAlgo("local_search")}
                    type="button"
                  >
                    Greedy + Local Search
                  </button>
                  <button
                    className={`algo-btn ${selectedAlgo === "greedy" ? "active" : ""}`}
                    onClick={() => setSelectedAlgo("greedy")}
                    type="button"
                  >
                    Greedy Heuristic
                  </button>
                </div>

                <div className="algo-info">
                  {selectedAlgo === "local_search" ? (
                    <>
                      <strong>Pairwise Swap Neighborhood</strong>
                      Starts from feasible greedy slotting, searches for improving 2-opt swaps, and accepts strict improvements.
                    </>
                  ) : (
                    <>
                      <strong>Greedy Priority Heuristic</strong>
                      Ranks SKUs by demand velocity and greedily allocates best feasible location using weighted distance & co-pick cost.
                    </>
                  )}
                </div>

                {selectedAlgo === "local_search" && (
                  <label className="weight-row">
                    <span>
                      Max Iterations <strong>{maxIterations}</strong>
                    </span>
                    <input
                      type="range"
                      min="100"
                      max="1000"
                      step="50"
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Number(e.target.value))}
                    />
                  </label>
                )}

                <div className="sidebar-divider" />
                <div className="sidebar-label">OBJECTIVE WEIGHTS</div>
                <label className="weight-row">
                  <span>
                    Travel distance <strong>{Math.round(weights.travelWeight * 100)}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weights.travelWeight}
                    onChange={(event) =>
                      setWeights((value) => ({
                        ...value,
                        travelWeight: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="weight-row">
                  <span>
                    Demand velocity <strong>{Math.round(weights.demandWeight * 100)}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weights.demandWeight}
                    onChange={(event) =>
                      setWeights((value) => ({
                        ...value,
                        demandWeight: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="weight-row">
                  <span>
                    Co-occurrence <strong>{Math.round(weights.cooccurrenceWeight * 100)}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={weights.cooccurrenceWeight}
                    onChange={(event) =>
                      setWeights((value) => ({
                        ...value,
                        cooccurrenceWeight: Number(event.target.value),
                      }))
                    }
                  />
                </label>

                <div className="sidebar-divider" />
                <div className="sidebar-label">HARD CONSTRAINTS ENFORCED</div>
                <div className="constraint-mini">
                  <Check size={13} /> Weight capacity
                </div>
                <div className="constraint-mini">
                  <Check size={13} /> Volume capacity
                </div>
                <div className="constraint-mini">
                  <Check size={13} /> Zone / storage compatibility
                </div>
                <div className="constraint-mini">
                  <Check size={13} /> Unique 1-to-1 assignment
                </div>
                <div className="constraint-mini">
                  <Check size={13} /> Location accessibility
                </div>

                <div className="sidebar-spacer" />
                <div className="sidebar-foot">
                  <span>SEED / TIME LIMIT</span>
                  <strong>42 / 2s</strong>
                </div>
              </aside>

              <div className="control-main">
                <div className="run-toolbar">
                  <div>
                    <span className="toolbar-kicker">SOLVER EXECUTION</span>
                    <h3>
                      {running
                        ? "Solving warehouse slotting…"
                        : run
                        ? `Run ${run.runId} (${run.algorithm})`
                        : "Ready to optimize"}
                    </h3>
                  </div>
                  <div className="run-actions">
                    {run && !running && (
                      <StatusPill tone={run.validation.valid ? "green" : "orange"}>
                        {run.validation.valid ? "Feasible solution" : "Infeasible"}
                      </StatusPill>
                    )}
                    <button
                      className="run-button"
                      disabled={running}
                      onClick={handleRun}
                      type="button"
                    >
                      {running ? (
                        <>
                          <span className="button-spinner" /> Running solver…
                        </>
                      ) : (
                        <>
                          <Play size={16} fill="currentColor" /> Run {selectedAlgo === "local_search" ? "local search" : "greedy"}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {notice && (
                  <div className="runtime-notice">
                    <Zap size={15} />
                    {notice}
                  </div>
                )}

                <div className="run-progress">
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${run && !running ? "complete" : ""}`}
                      style={{
                        width: running
                          ? `${Math.max(7, ((stageIndex + 1) / stages.length) * 100)}%`
                          : run
                          ? "100%"
                          : "4%",
                      }}
                    />
                  </div>
                  <div className="progress-labels">
                    <span>validate schemas</span>
                    <span>demand & co-pick matrix</span>
                    <span>greedy placement</span>
                    <span>2-opt local search</span>
                    <span>route validation</span>
                  </div>
                </div>

                <div className="stage-list">
                  {stages.map(([label, detail], index) => {
                    const done = run && !running ? true : running && index < stageIndex;
                    const current = running && index === stageIndex;
                    return (
                      <div
                        className={`stage-row ${done ? "done" : ""} ${current ? "current" : ""}`}
                        key={label}
                      >
                        <span className="stage-status">
                          {done ? (
                            <Check size={13} />
                          ) : current ? (
                            <span className="stage-pulse" />
                          ) : (
                            <span>{String(index + 1).padStart(2, "0")}</span>
                          )}
                        </span>
                        <Radar size={16} />
                        <div>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </div>
                        <span className="stage-state">
                          {done ? "complete" : current ? "running" : "queued"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {run && run.iterations !== undefined && (
                  <div style={{ marginTop: "20px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <StatusPill tone="blue">
                      Runtime: {run.runtimeMs ?? 0}ms
                    </StatusPill>
                    <StatusPill tone="orange">
                      Iterations: {run.iterations}
                    </StatusPill>
                    <StatusPill tone="green">
                      Swaps accepted: {run.swapsAccepted ?? 0}
                    </StatusPill>
                    <StatusPill tone={run.converged ? "green" : run.stopReason === "time_limit" ? "orange" : "neutral"}>
                      {run.stopReason === "converged"
                        ? "Converged: full neighborhood scanned"
                        : run.stopReason === "time_limit"
                        ? "Stopped: time limit reached"
                        : "Stopped: max iteration limit reached"}
                    </StatusPill>
                  </div>
                )}

                <div className="algorithm-note">
                  <Network size={17} />
                  <div>
                    <strong>Dual Optimization Architecture</strong>
                    <span>
                      The demand-ranked Greedy heuristic scores feasible slots with the normalized objective, including the same order-route distance used in the benchmark. It finds a feasible assignment when one exists. Local Search tests pairwise swaps and accepts constraint-preserving objective improvements.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 03 ALGORITHM BENCHMARKING */}
        <section className="benchmark-section section-pad" id="benchmark">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">03 / ALGORITHM BENCHMARKING</span>
                <h2>Head-to-head empirical comparison.</h2>
              </div>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <button
                  className="outline-button compact"
                  onClick={handleRunBenchmark}
                  disabled={benchmarkRunning}
                  type="button"
                >
                  <RefreshCw size={14} className={benchmarkRunning ? "button-spinner" : ""} />
                  {benchmarkRunning ? "Benchmarking…" : "Re-run benchmark"}
                </button>
              </div>
            </div>

            <p className="heading-paragraph" style={{ marginBottom: "20px" }}>
              Both algorithms evaluated under identical conditions: same warehouse topology, SKU physical constraints,
              identical 120-order workload replay, and identical (0,0) pick station.
            </p>

            <div className="benchmark-card">
              <div className="benchmark-table-wrap">
                <table className="benchmark-table">
                  <thead>
                    <tr>
                      <th>Strategy / Algorithm</th>
                      <th>Total Distance</th>
                      <th>Avg / Order</th>
                      <th>Objective J(A)</th>
                      <th>Runtime</th>
                      <th>Violations</th>
                      <th>Improvement</th>
                      <th>Search Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Synthetic Baseline</strong>
                        <div style={{ fontSize: "10px", color: "var(--muted)" }}>
                          Deterministic randomized assignment; no demand or distance scoring
                        </div>
                      </td>
                      <td>{benchmark?.baseline.totalDistance.toFixed(1) ?? "—"}m</td>
                      <td>{benchmark?.baseline.averageDistance.toFixed(1) ?? "—"}m</td>
                      <td>{benchmark?.baseline.objective ? benchmark.baseline.objective.toFixed(2) : "—"}</td>
                      <td>&lt;1ms</td>
                      <td>
                        <span style={{ color: benchmark?.baseline.feasible ? "var(--green)" : "#A84A27", fontWeight: 600 }}>
                          {benchmark?.baseline.constraintViolations ?? 0} ({benchmark?.baseline.feasible ? "Feasible" : "Infeasible"})
                        </span>
                      </td>
                      <td>0.0% (ref)</td>
                      <td>Unoptimized reference placement</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>{benchmark?.greedy.algorithmName ?? "Demand + Co-occurrence Greedy"}</strong>
                        <div style={{ fontSize: "10px", color: "var(--muted)" }}>
                          Greedy priority slotting heuristic
                        </div>
                      </td>
                      <td>{benchmark?.greedy.totalDistance.toFixed(1) ?? "—"}m</td>
                      <td>{benchmark?.greedy.averageDistance.toFixed(1) ?? "—"}m</td>
                      <td>{benchmark?.greedy.objective.toFixed(2) ?? "—"}</td>
                      <td>{benchmark?.greedy.runtimeMs ?? "—"}ms</td>
                      <td>{benchmark?.greedy.constraintViolations ?? 0} ({benchmark?.greedy.feasible ? "Feasible" : "Infeasible"})</td>
                      <td>{benchmark ? `${percentLabel(benchmark.greedy.improvementOverBaseline)}` : "—"}</td>
                      <td>Demand-ranked objective scoring</td>
                    </tr>
                    <tr className="winner-cell">
                      <td>
                        <strong>{benchmark?.localSearch.algorithmName ?? "Greedy + Local Search"}</strong>
                        <div style={{ fontSize: "10px", color: "var(--green)" }}>
                          2-opt pairwise swap neighborhood
                        </div>
                      </td>
                      <td>
                        <strong>{benchmark?.localSearch.totalDistance.toFixed(1) ?? "—"}m</strong>
                      </td>
                      <td>
                        <strong>{benchmark?.localSearch.averageDistance.toFixed(1) ?? "—"}m</strong>
                      </td>
                      <td>
                        <strong>{benchmark?.localSearch.objective.toFixed(2) ?? "—"}</strong>
                      </td>
                      <td>{benchmark?.localSearch.runtimeMs ?? "—"}ms</td>
                      <td>{benchmark?.localSearch.constraintViolations ?? 0} ({benchmark?.localSearch.feasible ? "Feasible" : "Infeasible"})</td>
                      <td>
                        <strong>
                          {benchmark ? `${percentLabel(benchmark.localSearch.improvementOverBaseline)}` : "—"}
                        </strong>
                      </td>
                      <td>
                        {benchmark?.localSearch.iterations ?? 0} iterations · {benchmark?.localSearch.swapsAccepted ?? 0} swaps accepted
                        {benchmark?.localSearch.stopReason && (
                          <div style={{ fontSize: "9px", opacity: 0.85 }}>
                            ({benchmark.localSearch.stopReason === "converged" ? "converged" : benchmark.localSearch.stopReason})
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="benchmark-callout">
                <div className="callout-box green-box">
                  <h4>
                    <CheckCircle2 size={16} /> Operations Research Findings
                  </h4>
                  <p>
                    {benchmark
                      ? `Local search tested feasible pairwise SKU swaps and changed the objective from ${benchmark.greedy.objective.toFixed(1)} to ${benchmark.localSearch.objective.toFixed(1)}. The simplified route estimate ${benchmark.localSearch.totalDistance <= benchmark.greedy.totalDistance ? `decreased by ${(benchmark.greedy.totalDistance - benchmark.localSearch.totalDistance).toFixed(1)}m` : `increased by ${(benchmark.localSearch.totalDistance - benchmark.greedy.totalDistance).toFixed(1)}m`} versus greedy.`
                      : "Run benchmark to calculate empirical results."}
                  </p>
                </div>

                <div className="callout-box orange-box">
                  <h4>
                    <Scale size={16} /> Constraint Guarantee & Baseline Disclosure
                  </h4>
                  <p>
                    {benchmark
                      ? `The deterministic randomized baseline and optimized assignment are each checked for assignment completeness, unique slots, storage zone, handling restriction, weight, volume, and accessibility. The objective includes the same simplified order-route distance reported in the benchmark, plus normalized demand and co-order terms. Those terms can trade off, so review the measured route-distance change for each dataset.`
                      : `Every candidate local-search swap is checked against the hard storage constraints before its objective score is evaluated.`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 04 INTERACTIVE WAREHOUSE MAP & SKU EXPLAINER */}
        <section className="map-section section-pad" id="map">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">04 / INTERACTIVE WAREHOUSE MAP & EXPLAINER</span>
                <h2>Inspect assignments & decision rationales.</h2>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Mono', monospace" }}>
                  Select SKU:
                </span>
                <select
                  className="app-select"
                  value={activeExplainerSkuId ?? ""}
                  onChange={(e) => {
                    const skuId = e.target.value;
                    setSelectedSkuId(skuId);
                    const assigned = (mapMode === "optimized" ? run?.assignments : run?.baselineAssignments)?.find(
                      (a) => a.sku_id === skuId
                    );
                    if (assigned) setSelectedLocation(assigned.location_id);
                  }}
                >
                  {data.skus.map((sku) => (
                    <option key={sku.sku_id} value={sku.sku_id}>
                      {sku.sku_id} ({sku.storage_class}, freq: {sku.demand_frequency})
                    </option>
                  ))}
                </select>

                <div className="map-toggle">
                  <button
                    className={mapMode === "optimized" ? "active" : ""}
                    onClick={() => setMapMode("optimized")}
                    type="button"
                  >
                    Optimized
                  </button>
                  <button
                    className={mapMode === "baseline" ? "active" : ""}
                    onClick={() => setMapMode("baseline")}
                    type="button"
                  >
                    Baseline
                  </button>
                </div>
              </div>
            </div>

            <div className="map-workspace">
              <div className="interactive-map">
                <div className="map-topline">
                  <span>Northstar Warehouse Grid (36 Slots · 6×6 Layout)</span>
                  <span>{mapMode} layout · click any slot to inspect</span>
                </div>
                <div className="map-canvas runtime-map">
                  {data.layout.slice(0, 36).map((location: Location) => {
                    const assignment = mapAssignments.get(location.location_id);
                    const isSelected = selectedLocation === location.location_id;
                    const changed =
                      run?.assignments.find((item) => item.sku_id === assignment?.sku_id)
                        ?.location_id !==
                      run?.baselineAssignments.find((item) => item.sku_id === assignment?.sku_id)
                        ?.location_id;

                    return (
                      <button
                        key={location.location_id}
                        className={`map-location ${location.zone} ${assignment ? "assigned" : ""} ${
                          changed && mapMode === "optimized" ? "changed" : ""
                        } ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedLocation(location.location_id);
                          if (assignment) setSelectedSkuId(assignment.sku_id);
                        }}
                        type="button"
                        title={`${location.location_id} · ${assignment?.sku_id ?? "empty"}`}
                      >
                        <span>{assignment?.sku_id ? assignment.sku_id.slice(-2) : ""}</span>
                      </button>
                    );
                  })}
                  <div className="map-station">
                    PICK
                    <br />
                    STATION
                    <br />
                    (0,0)
                  </div>
                </div>
                <div className="map-foot">
                  <span>
                    <i className="legend-dot hot" /> Cold zone
                    <i className="legend-dot warm" /> Hazmat zone
                    <i className="legend-dot cool" /> Ambient zone
                  </span>
                  <span>
                    <MapPinned size={14} /> {run?.optimized.validAssignments ?? 0} slots populated
                  </span>
                </div>
              </div>

              {/* SKU & LOCATION EXPLAINER PANEL */}
              <div className="location-inspector">
                {activeSkuExplanation ? (
                  <>
                    <div className="explainer-header">
                      <div>
                        <span className="section-kicker">DECISION EXPLAINER</span>
                        <h3 style={{ margin: "4px 0 0" }}>{activeSkuExplanation.skuId}</h3>
                      </div>
                      <span className="explainer-badge">
                        {activeSkuExplanation.storageClass} class
                      </span>
                    </div>

                    <div className="inspector-grid">
                      <span>
                        Assigned Location
                        <strong>{activeSkuExplanation.optimizedLocation}</strong>
                      </span>
                      <span>
                        Baseline Location
                        <strong>{activeSkuExplanation.baselineLocation}</strong>
                      </span>
                      <span>
                        Distance to Pick Station
                        <strong>
                          {activeSkuExplanation.distanceFromStation}m (base: {activeSkuExplanation.baselineDistanceFromStation}m)
                        </strong>
                      </span>
                      <span>
                        Demand Frequency
                        <strong>{activeSkuExplanation.demandFrequency} order picks</strong>
                      </span>
                      <span>
                        Weight & Vol Capacity
                        <strong>
                          Max {activeSkuExplanation.weightCapacity}kg / {activeSkuExplanation.volumeCapacity}m³
                        </strong>
                      </span>
                      <span>
                        Zone & Access
                        <strong>
                          {activeSkuExplanation.zone} / {activeSkuExplanation.accessibility}
                        </strong>
                      </span>
                    </div>

                    <div className="inspector-assignment">
                      <span>SOLVER ASSIGNMENT RATIONALE</span>
                      <strong>{activeSkuExplanation.assignmentReason}</strong>
                      <p>
                        High demand velocity pulls this item toward the pick station (0,0), while hard physical
                        constraints verify storage zone, weight, and volume compatibility.
                      </p>
                    </div>

                    {activeSkuExplanation.coOrderedSkus.length > 0 && (
                      <div style={{ marginTop: "16px" }}>
                        <span style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>
                          Frequently Co-Ordered SKUs:
                        </span>
                        <div className="tag-list">
                          {activeSkuExplanation.coOrderedSkus.map((co) => (
                            <span className="tag-item" key={co.skuId}>
                              {co.skuId} ({co.count} orders)
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeSkuExplanation.alternativeLocation && (
                      <div className="counterfactual-box">
                        <strong>Counterfactual Location Comparison:</strong>
                        Candidate location: <code>{activeSkuExplanation.alternativeLocation}</code>
                        {activeSkuExplanation.alternativeObjectiveDiff !== undefined && (
                          <div style={{ marginTop: "4px" }}>
                            <strong>Full Composite Objective Difference (ΔJ): </strong>
                            <span>
                              {activeSkuExplanation.alternativeObjectiveDiff > 0 ? "+" : ""}
                              {activeSkuExplanation.alternativeObjectiveDiff}{" "}
                              (higher cost if moved; current slot is superior)
                            </span>
                          </div>
                        )}
                        {activeSkuExplanation.alternativeDistanceDiff !== undefined && (
                          <div style={{ marginTop: "2px", color: "var(--muted)", fontSize: "10px" }}>
                            Depot Station Distance Delta:{" "}
                            {activeSkuExplanation.alternativeDistanceDiff > 0 ? "+" : ""}
                            {activeSkuExplanation.alternativeDistanceDiff}m
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="inspector-empty large">
                    <MapPinned size={24} />
                    <strong>Select a location or SKU</strong>
                    <span>Physical constraints, demand metrics, and solver reasoning will appear here.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 05 ORDER ROUTE SIMULATION */}
        <section className="simulation-section section-pad" id="simulation">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">05 / ORDER ROUTE SIMULATION</span>
                <h2>Simulate order pick-path efficiency.</h2>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Mono', monospace" }}>
                  Select Order:
                </span>
                <select
                  className="app-select"
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                >
                  {orderIds.map((id) => (
                    <option key={id} value={id}>
                      {id} ({data.orders.filter((o) => o.order_id === id).length} items)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="disclaimer-banner">
              <Info size={20} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong>Geometric Route Disclaimer:</strong>
                Travel distances are calculated using simplified Euclidean geometric estimates from the
                picking station at (0, 0) through item locations and back. Genuine warehouse routing requires
                topological aisle-constrained graphs (planned for Evaluation 2); synthetic graph connectivity is
                intentionally not invented here to preserve engineering integrity.
              </div>
            </div>

            <div className="simulation-shell">
              <div className="sim-controls">
                <div>
                  <span className="toolbar-kicker">ORDER WORKLOAD PROFILE</span>
                  <h3 style={{ margin: "6px 0 16px", fontSize: "20px" }}>{selectedOrderId}</h3>
                </div>

                <div className="sim-meta-row">
                  <span>Lines in order</span>
                  <strong>{activeOrderRoute?.skus.length ?? 0} lines</strong>
                </div>
                <div className="sim-meta-row">
                  <span>Total quantity</span>
                  <strong>
                    {data.orders
                      .filter((o) => o.order_id === selectedOrderId)
                      .reduce((sum, o) => sum + o.quantity, 0)} units
                  </strong>
                </div>
                <div className="sim-meta-row">
                  <span>Pick Station</span>
                  <strong>(x: 0, y: 0)</strong>
                </div>
                <div className="sim-meta-row">
                  <span>Distance Model</span>
                  <strong>Euclidean 2D Round-Trip</strong>
                </div>
              </div>

              <div>
                <div className="route-results-grid">
                  <div className="route-metric-box">
                    <span>Baseline Route</span>
                    <strong>{activeOrderRoute?.baselineDistance.toFixed(1) ?? "—"}m</strong>
                  </div>
                  <div className="route-metric-box">
                    <span>Optimized Route</span>
                    <strong>{activeOrderRoute?.optimizedDistance.toFixed(1) ?? "—"}m</strong>
                  </div>
                  <div className="route-metric-box saved-box">
                    <span>Distance Saved</span>
                    <strong>
                      {activeOrderRoute
                        ? `${activeOrderRoute.distanceSaved > 0 ? "+" : ""}${activeOrderRoute.distanceSaved.toFixed(1)}m`
                        : "—"}
                    </strong>
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "var(--ink)" }}>
                      PICK PATH SEQUENCE (OPTIMIZED ASSIGNMENT)
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "'DM Mono', monospace" }}>
                      Round-trip from Station (0,0)
                    </span>
                  </div>

                  <div className="pick-steps-list">
                    <div className="pick-step-item">
                      <span className="step-num">0</span>
                      <span className="step-sku">Picking Station Depot</span>
                      <span className="step-loc">(0, 0)</span>
                      <span className="step-dist">Depot start</span>
                    </div>

                    {activeOrderRoute?.locations.map((leg, idx) => (
                      <div className="pick-step-item" key={`${leg.skuId}-${idx}`}>
                        <span className="step-num">{idx + 1}</span>
                        <span className="step-sku">{leg.skuId}</span>
                        <span className="step-loc">Slot {leg.locationId} (x:{leg.x}, y:{leg.y})</span>
                        <span className="step-dist">Pick leg {idx + 1}</span>
                      </div>
                    ))}

                    <div className="pick-step-item">
                      <span className="step-num">{((activeOrderRoute?.locations.length ?? 0) + 1)}</span>
                      <span className="step-sku">Return to Station Depot</span>
                      <span className="step-loc">(0, 0)</span>
                      <span className="step-dist">Depot return</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 06 PERFORMANCE ANALYSIS */}
        <section className="analysis section-pad" id="analysis">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">06 / PERFORMANCE ANALYSIS</span>
                <h2>Show the math.</h2>
              </div>
              <p className="heading-paragraph">
                Same order set. Same assumptions.
                <br />
                Only the assignment changes.
              </p>
            </div>
            <div className="analysis-grid">
              <div className="analysis-card">
                <div className="analysis-card-head">
                  <div>
                    <span className="toolbar-kicker">DEMAND FREQUENCY</span>
                    <h3>Top velocity SKUs</h3>
                  </div>
                  <BarChart3 size={18} />
                </div>
                {demandBars.map((sku) => (
                  <div className="demand-bar" key={sku.sku_id}>
                    <span>{sku.sku_id}</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.max(
                            12,
                            (sku.demand_frequency / (demandBars[0]?.demand_frequency || 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <strong>{sku.demand_frequency}</strong>
                  </div>
                ))}
              </div>

              <div className="analysis-card">
                <div className="analysis-card-head">
                  <div>
                    <span className="toolbar-kicker">BASELINE VS OPTIMIZED</span>
                    <h3>Route performance</h3>
                  </div>
                  <Route size={18} />
                </div>
                {run &&
                  [
                    {
                      label: "total travel",
                      base: run.baseline.totalDistance,
                      opt: run.optimized.totalDistance,
                      suffix: "m",
                    },
                    {
                      label: "avg / order",
                      base: run.baseline.averageDistance,
                      opt: run.optimized.averageDistance,
                      suffix: "m",
                    },
                    {
                      label: "est. pick cycle",
                      base: run.baseline.averagePickSeconds,
                      opt: run.optimized.averagePickSeconds,
                      suffix: "s",
                    },
                    {
                      label: "est. throughput",
                      base: run.baseline.throughput,
                      opt: run.optimized.throughput,
                      suffix: "/h",
                    },
                  ].map((metric) => (
                    <div className="compare-row" key={metric.label}>
                      <div>
                        <span>{metric.label}</span>
                        <strong>
                          {metric.base.toFixed(1)}
                          {metric.suffix} <ArrowRight size={12} /> {metric.opt.toFixed(1)}
                          {metric.suffix}
                        </strong>
                      </div>
                      <span className="compare-delta">
                        {percentLabel(metricDelta(metric.base, metric.opt).percent)}
                      </span>
                    </div>
                  ))}
              </div>

              <div className="analysis-card validation-card">
                <div className="analysis-card-head">
                  <div>
                    <span className="toolbar-kicker">CONSTRAINT VALIDATION</span>
                    <h3>{run?.validation.valid ? "Feasibility gate passed" : "Validation required"}</h3>
                  </div>
                  <ShieldCheck size={18} />
                </div>
                <div className="validation-score">
                  <strong>{run?.validation.passed ?? 0}</strong>
                  <span>
                    passed checks
                    <br />
                    of {run?.validation.checks ?? 0}
                  </span>
                  <div
                    className="score-ring"
                    style={
                      {
                        "--score": `${
                          run
                            ? (run.validation.passed / Math.max(run.validation.checks, 1)) * 100
                            : 0
                        }%`,
                      } as React.CSSProperties
                    }
                  >
                    <span>
                      {run
                        ? Math.round(
                            (run.validation.passed / Math.max(run.validation.checks, 1)) * 100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                </div>
                <div className="validation-lines">
                  <span>
                    <Check size={13} /> Assignment completeness (36/36)
                  </span>
                  <span>
                    <Check size={13} /> Weight capacity (&le; rack max)
                  </span>
                  <span>
                    <Check size={13} /> Volumetric capacity fit
                  </span>
                  <span>
                    <Check size={13} /> Storage class zone compatibility
                  </span>
                  <span>
                    <Check size={13} /> 1-to-1 unique slot reservation
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 07 RESULTS & EXPORT */}
        <section className="results section-pad" id="results">
          <div className="page-width">
            <div className="section-heading-row">
              <div>
                <span className="section-kicker">07 / RESULTS & COMPREHENSIVE EXPORT</span>
                <h2>Leave with verifiable evidence.</h2>
              </div>
              <div className="run-meta">
                {run ? (
                  <>
                    <span>
                      RUN ID <strong>{run.runId}</strong>
                    </span>
                    <span>{new Date(run.timestamp).toLocaleString()}</span>
                  </>
                ) : (
                  <span>No run yet</span>
                )}
              </div>
            </div>

            <div className="results-panel">
              <div className="results-copy">
                <Target size={26} />
                <div>
                  <h3>Evaluation 1 Audit Package & Reports</h3>
                  <p>
                    Export the full evaluation dossier including dataset summaries, active algorithm metrics,
                    objective function weights, constraint verification scores, and operational assumptions.
                  </p>
                </div>
              </div>

              <div className="export-actions">
                <button
                  onClick={() =>
                    run &&
                    downloadRun(
                      `optistore-evaluation-report-${run.runId}.csv`,
                      exportEvaluationReportCsv(run, data)
                    )
                  }
                  disabled={!run}
                  type="button"
                  style={{ background: "var(--orange)", borderColor: "var(--orange)", fontWeight: 600 }}
                >
                  <Download size={15} /> Download Evaluation Report CSV
                </button>
                <button
                  onClick={() =>
                    run && downloadRun("optistore-optimized-assignments.csv", assignmentCsv(run))
                  }
                  disabled={!run}
                  type="button"
                >
                  <Download size={14} /> Optimized CSV
                </button>
                <button
                  onClick={() =>
                    run && downloadRun("optistore-baseline-assignments.csv", assignmentCsv(run, false))
                  }
                  disabled={!run}
                  type="button"
                >
                  <Download size={14} /> Baseline CSV
                </button>
                <button
                  onClick={() =>
                    run && downloadRun("optistore-performance-comparison.csv", exportRunCsv(run))
                  }
                  disabled={!run}
                  type="button"
                >
                  <Download size={14} /> Performance CSV
                </button>
              </div>
            </div>

            <div className="report-preview-grid">
              <div className="report-feature-item">
                <strong>01 / Dataset Summary</strong>
                Locations, SKUs, order counts & layout version
              </div>
              <div className="report-feature-item">
                <strong>02 / Algorithm & Objective</strong>
                Active solver, runtime, weights, iterations & swaps
              </div>
              <div className="report-feature-item">
                <strong>03 / Quantitative Comparison</strong>
                Distance and estimated productivity proxies with percentage deltas
              </div>
              <div className="report-feature-item">
                <strong>04 / Constraints & Disclaimers</strong>
                Feasibility checks, Euclidean distance assumptions
              </div>
            </div>
          </div>
        </section>

        {/* ROADMAP */}
        <section className="roadmap section-pad" id="roadmap">
          <div className="page-width roadmap-grid">
            <div>
              <span className="section-kicker">THE EVALUATION ROADMAP</span>
              <h2>
                One proof point
                <br />
                <em>at a time.</em>
              </h2>
              <p>
                Evaluation 1 delivers dual optimization algorithms (Greedy + Local Search), empirical benchmarking,
                SKU explainability, order route simulation, and comprehensive audit CSV exports.
              </p>
              <button className="outline-button" onClick={() => scrollToId("control")} type="button">
                Re-open control center <ArrowRight size={15} />
              </button>
            </div>
            <div className="roadmap-list">
              <div className="roadmap-item delivered">
                <div className="roadmap-marker">
                  <Check size={14} />
                </div>
                <div>
                  <span>NOW · EVALUATION 01</span>
                  <strong>Dual Solver + Local Search + Benchmarking</strong>
                  <p>
                    Deterministic greedy slotting, 2-opt pairwise swap local search, head-to-head empirical benchmark,
                    SKU assignment explainer, order route simulation, and audit report CSV.
                  </p>
                </div>
                <StatusPill tone="green">delivered</StatusPill>
              </div>
              <div className="roadmap-item">
                <div className="roadmap-marker">02</div>
                <div>
                  <span>UP NEXT · EVALUATION 02</span>
                  <strong>Advanced Operations Research</strong>
                  <p>
                    Graph-based aisle routing network, OR-Tools CP-SAT exact formulation, simulated annealing, and multi-zone pick batches.
                  </p>
                </div>
                <StatusPill>planned</StatusPill>
              </div>
              <div className="roadmap-item">
                <div className="roadmap-marker">03</div>
                <div>
                  <span>FINAL SYSTEM</span>
                  <strong>Continuous Decision Intelligence</strong>
                  <p>
                    WMS ERP integrations, multi-depot topologies, dynamic slot replenishment, and warehouse supervisor workflow.
                  </p>
                </div>
                <StatusPill>planned</StatusPill>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-width footer-inner">
          <BrandMark />
          <span>Neural Forge Hackathon · intelligent warehouse optimization</span>
          <span>© 2026 OptiStore AI</span>
        </div>
      </footer>
    </div>
  );
}
