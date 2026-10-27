# Evaluation 1 outcomes

## Delivered — startup-style judge-facing prototype

- [x] Present the warehouse optimization challenge and the Evaluation 1 scope in a polished startup-style hero.

- [x] Explain the three input types: warehouse layout topography, SKU physical metadata, and order transactional logs.

- [x] Show optimization logic, feasibility constraints, and the operational impact in an auditable narrative.

## Delivered — interactive control room

- [x] Provide sample input datasets with inspectable records and summaries.

- [x] Provide a prominent control to launch the sample optimization demo.

- [x] Show visible processing stages, progress/status feedback, and a completed result state.

- [x] Show baseline-vs-optimized metrics with explicit values, absolute changes, and percentage improvements.

- [x] Provide metric detail inspection and a feasible SKU-to-slot assignment view.

- [x] Highlight honored physical and operational constraints.

## Delivered — evaluation framing

- [x] Mark Evaluation 1 as delivered and show later evaluations/final-system capabilities as upcoming.

- [ ] Connect production persistence, OR-Tools-scale solver options, WMS integrations, and live operational workflows in later evaluations.

## Functional Evaluation 1 upgrade — implemented in-browser

- [x] Generate a deterministic synthetic demonstration dataset with 36 SKUs, 120 historical orders, multi-SKU orders, 36 storage locations, capacities, zones, handling restrictions, and a defined pick station.

- [x] Accept CSV uploads for warehouse layout, SKU metadata, and order transactions using explicit required schemas; reject missing columns, duplicate IDs, invalid references, invalid quantities, and invalid physical values with visible messages.

- [x] Calculate demand frequency and order co-occurrence from the current order set, generate a sequential baseline assignment, and compute a feasible demand-weighted optimized assignment with storage, weight, volume, accessibility, and unique-location constraints.

- [x] Calculate baseline and optimized total travel, average distance per order, estimated pick cycle, throughput, slot utilization proxy, valid assignments, constraint checks, absolute deltas, and percentage deltas using the same order set and route model.

- [x] Provide an interactive warehouse map that reflects the generated assignment, supports optimized/baseline toggling, highlights changed locations, and exposes location/SKU metadata and placement explanations.

- [x] Persist the current datasets and latest successful run in browser local storage, and export optimized assignments, baseline assignments, and performance comparison CSV files.

- [x] Clearly disclose the current limitation: this milestone uses a deterministic TypeScript client-side optimizer and local persistence; OR-Tools, backend persistence, WMS integrations, and production-scale routing remain planned for later evaluations.
