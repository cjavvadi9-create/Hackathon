# OptiStore AI — Neural Forge Evaluation 1 Upgrade Technical Audit

## Executive Summary

OptiStore AI has been upgraded from a single-pass greedy slotting prototype into a rigorous, dual-algorithm warehouse optimization platform with empirical benchmarking, SKU explainability, order route simulation, and a full evaluation report export.

The prior audit recorded 32 passing automated tests. After the present updates, TypeScript checking passes with **0 errors** (`tsc --noEmit`). The current test runner could not load its Vite configuration in the restricted execution environment (esbuild was denied access to `../..`), so the updated test suite and production build still need a normal local run.

---

## 1. Mathematical Objective Function

The warehouse slotting configuration is represented as a bijective assignment $A: S \to L$ mapping SKUs $s \in S$ to storage locations $l \in L$.

The composite objective function $J(A)$ minimizes the same simplified order-route distance reported in benchmark metrics, prioritizes high-demand items closer to the picking depot, and clusters frequently co-ordered items together. Each component is normalized to a comparable scale:

$$J(A) = w_{\text{travel}} \cdot R(A) + w_{\text{demand}} \cdot D(A) + w_{\text{cooccur}} \cdot C(A)$$

Where $R(A)$ is the total order-route distance divided by a fixed upper-bound scale, $D(A)=\sum_i p(s_i)d(l_i)/(\sum_i p(s_i)\cdot d_{\max})$, and $C(A)=\sum_{i<j} C(s_i,s_j)\text{dist}(l_i,l_j)/(\sum_{i<j}C(s_i,s_j)\cdot d_{pair,max})$.

Where:
- $d(l_i) = \text{dist}(l_i, \text{depot})$ is the Euclidean distance from location $l_i$ to picking depot $(0, 0)$.
- $p(s_i)$ is the aggregate quantity demand for SKU $s_i$ derived from order transactions.
- $C(s_i, s_j)$ is the co-occurrence affinity (number of orders containing both $s_i$ and $s_j$).
- $\text{dist}(l_i, l_j) = \sqrt{(x_i - x_j)^2 + (y_i - y_j)^2}$ is the Euclidean distance between rack locations.
- $d_{\max}$ and $d_{pair,max}$ are the maximum depot and pairwise location distances in the layout. Route normalization uses a fixed upper bound based on the maximum possible hop and number of order lines.
- **Single-Counting Symmetry**: Co-occurrence sums only over unordered SKU pairs $i<j$, so each pair contributes exactly once.

### Greedy Constructive Heuristic Placement
During the greedy phase, candidate locations are scored by evaluating the same normalized composite objective on the current partial assignment plus the candidate SKU. The solver builds a feasible initial layout when one exists, then local search evaluates feasible swaps against that same objective.

---

## 2. Algorithms & Local Search Termination

### Greedy Heuristic (`optimize`)
- **Complexity**: demand ordering is $O(N \log N)$; candidate scoring evaluates the route and affinity terms for each compatible slot, so runtime also depends on order-line count, SKU count, and available locations.
- **Workflow**:
  1. Computes total demand frequency $p(s)$ and symmetric co-occurrence matrix $C(s_i, s_j)$.
  2. Ranks SKUs in descending demand order.
  3. Filters available locations by hard constraints (zone, handling restriction, weight, volume, accessibility).
  4. Scores each compatible candidate using the same normalized objective on the current partial assignment.
  5. Checks that remaining SKUs still admit a feasible matching before committing the candidate slot.

### 2-Opt Local Search (`optimizeLocalSearch`)
- **Neighborhood**: Deterministic pairwise swaps $(s_i \leftrightarrow s_j)$ between assigned locations.
- **Feasibility Gate**: Every candidate swap is verified against all hard constraints before objective evaluation:
  - SKU storage class and recognized handling restriction match the target location zone (`ambient`, `cold`, `hazmat`).
  - SKU weight $\le$ target location weight capacity.
  - SKU volume $\le$ target location volume capacity.
  - Target location is accessible (`open`).
  If either SKU violates any constraint in the swapped location, the swap is immediately rejected.
- **Improvement Acceptance**: A swap is accepted if and only if $\Delta J = J(A') - J(A) < -10^{-9}$ (strict descent).
- **Stop Reason Classification**:
  - `converged`: A complete pass through all possible $O(N^2)$ candidate pairs was executed without discovering a single improving swap. The solution is a genuine local optimum with respect to the 2-opt neighborhood.
  - `iteration_limit`: The solver terminated because `iterations >= maxIterations` before a complete non-improving pass finished.
  - `time_limit`: The solver reached the execution budget `timeLimitMs`.

---

## 3. Empirical Benchmark Results (Sample Workload)

Evaluated under identical conditions: 36 SKUs, 36 layout locations, 120 unique orders (300 pick lines), picking depot at $(0, 0)$, default weights $(w_{\text{travel}}=0.55, w_{\text{demand}}=0.20, w_{\text{cooccur}}=0.25)$:

| Metric | Randomized Feasible Baseline | Greedy Heuristic | Greedy + Local Search | Improvement (LS vs Baseline) | Improvement (LS vs Greedy) |
|---|---|---|---|---|---|
| **Total Picking Distance** | 17,373.5 m | 16,134.0 m | **15,878.2 m** | **-8.6%** (-1,495.3 m) | **-1.6%** (-255.8 m) |
| **Average Distance / Order** | 144.8 m | 134.5 m | **132.3 m** | **-8.6%** | **-1.6%** |
| **Objective Value $J(A)$** | 0.3432 | 0.3307 | **0.3216** | **-6.3%** | **-2.8%** |
| **Runtime** | 0 ms (reference) | ~328 ms | **~355 ms** | Interactive | Interactive |
| **Feasible Assignments** | 36 / 36 | 36 / 36 | **36 / 36** | All feasible | All feasible |
| **Constraint Violations** | 0 violations | 0 violations | **0 violations** | Zero violations | Zero violations |
| **Termination Reason** | Reference | Constructive | `iteration_limit` (500 iter, 21 swaps) | Reaches `converged` with budget $\ge 1500$ | Escaped greedy local optimum |

### Benchmark Disclosures:
1. **Distance Calculation**: Picking distances are evaluated across the same 120 orders and exact assignment mappings. The 8.6% reduction is measured on this sample, not hardcoded. Routes use simplified Euclidean geometry and sort stops by transaction timestamp (SKU ID breaks ties).
2. **Baseline Disclosure**: The baseline is a deterministic randomized matching that enforces feasibility but does not use demand, travel, or co-occurrence scores. It is a synthetic reference, not a warehouse's existing WMS assignment.
3. **Objective vs Route Metric**: The composite objective includes the same normalized simplified order-route distance used in the benchmark, plus normalized demand proximity and co-occurrence costs. The secondary terms can trade off against route distance, so every dataset reports its measured route change separately.

---

## 4. SKU Explainability (`explainSku`)

The SKU Explainer provides operational transparency for any selected SKU:
- **Demand Velocity**: Pick count and demand percentiles.
- **Affinity Partners**: Top co-ordered SKUs with specific historical order frequencies.
- **Current Assignment**: Assigned location, rack coordinates, distance to depot, and storage class validation.
- **Counterfactual Swap Evaluation**:
  - **Composite Objective Difference ($\Delta J$)**: Measures the exact net change $J(A') - J(A)$ if the SKU were swapped with candidate locations, confirming optimality under the multi-objective function.
  - **Depot Distance Delta**: Clearly labeled as the station distance difference ($\Delta d = d(l') - d(l)$), avoiding confusion between physical depot proximity and the composite objective score.

---

## 5. Constraint Verification & Hard Gates

All 2,256 counted validation rules pass for the sample run, including dataset and optimized-assignment checks. Optimization strictly enforces:
1. **Zone Compatibility**: 100% of SKUs are stored in zones matching their storage class (`ambient` $\to$ `ambient`, `cold` $\to$ `cold`, `hazmat` $\to$ `hazmat`).
2. **Weight Limit**: SKU item weight $\le$ rack location weight capacity.
3. **Volume Limit**: SKU bounding box volume ($L \times W \times H$) $\le$ rack cubic volume capacity.
4. **Handling Restrictions**: Recognized ambient, cold/temperature-controlled, and hazmat/segregated restrictions are checked. Unmodeled restriction values are rejected.
5. **Accessibility**: All allocated slots have `open` operational status.
6. **Bijective Uniqueness**: Exactly one SKU per slot; zero duplicate assignments.

---

## 6. Automated Test & Build Verification

The current TypeScript check (`tsc --noEmit`) passes. A direct smoke check confirmed the sample baseline and optimized layouts are feasible, all 2,256 counted validation rules pass, route distance is computed from the assignments, quoted CSV fields are parsed, and malformed or unsupported CSV values are rejected.

The full Vitest suite and production bundle were not revalidated in this restricted environment. Vitest's config loader failed when esbuild was denied access to `../..`; rerun `pnpm test` and `pnpm build` in a normal local shell before submission.

---

## 7. Operational Assumptions & Remaining Limitations

1. **Euclidean Routing Model**: Pick routes use Euclidean metric approximations from depot $(0, 0)$, with stops ordered by transaction timestamp and SKU ID as a tie-breaker. Actual picker transit within aisles follows the warehouse's walkable path network, which is not modeled.
2. **Synthetic Randomized Baseline**: The comparative baseline is a deterministic randomized feasible matching that does not use demand or distance scores. It demonstrates the effect of slotting optimization, but does not represent an external enterprise WMS assignment.
3. **Single Picking Depot**: The warehouse layout assumes a single central depot at $(0, 0)$ for all dispatch and consolidation operations.
4. **Bounding Box Volume**: Volume constraints check $L \times W \times H \le V_{\text{rack}}$, which ensures physical capacity but does not solve 3D orientation packing or multi-SKU shelf stacking.
5. **Estimated Productivity**: Throughput is a proxy derived from estimated distance and a fixed time formula, not observed warehouse performance.

---

## 8. College Evaluation Demonstration Checklist

Follow this sequence during the evaluation demonstration:

1. **Dataset Ingestion & Validation** (`#datasets`):
   - Display the three dataset tables: Layout (36 racks), SKUs (36 items), Orders (120 orders, 300 pick lines).
   - Point out the 2,256 counted validation rules passing with 0 errors for the sample dataset and optimized assignment.

2. **Run Local Search Optimization** (`#control`):
   - Select **Greedy + Local Search**.
   - Review weights ($w_{\text{travel}}=0.55, w_{\text{demand}}=0.20, w_{\text{cooccur}}=0.25$).
   - Click **Run local search**. Runtime varies by machine; the sample run accepted 21 swaps, had 0 violations, and stopped at the configured `iteration_limit`.

3. **Head-to-Head Benchmark Review** (`#benchmark`):
   - Review the empirical comparison table:
     - Feasible randomized baseline: 17,373.5 m (0 violations).
     - Greedy: 16,134.0 m (feasible, 0 violations).
     - Local Search: 15,878.2 m (feasible, 0 violations, -8.6% vs baseline, -1.6% vs greedy).
     - Objective value reduction: $0.3307 \to 0.3216$ (-2.8%).

4. **Interactive Map & Decision Explainer** (`#map`):
   - Select `SKU-1001` or click location `A-01`.
   - Review the **Decision Explainer**: demand velocity, co-occurrence partners, validated storage zone, Full Composite Objective Difference ($\Delta J$), and Depot Distance Delta.

5. **Order Route Simulation** (`#simulation`):
   - Select an order (e.g. `ORD-80001`).
   - Demonstrate the round-trip pick sequence $(0,0) \to \text{Loc}_1 \to \text{Loc}_2 \to (0,0)$ and distance savings.

6. **Audit Report Export** (`#results`):
   - Click **Download Evaluation Report CSV**.
   - Show the 10 structured sections including solver parameters, convergence reasons, baseline feasibility disclosure, and explicit mathematical assumptions.
