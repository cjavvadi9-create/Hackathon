CREATE TABLE `benchmark_results` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`benchmarkSessionId` int unsigned NOT NULL,
	`optimizationRunId` int unsigned NOT NULL,
	`resultScope` enum('baseline','optimized') NOT NULL,
	`algorithmKey` enum('baseline','greedy','local_search') NOT NULL,
	`algorithmName` varchar(191) NOT NULL,
	`totalDistance` double NOT NULL,
	`averageDistance` double NOT NULL,
	`objective` double NOT NULL,
	`runtimeMs` int unsigned NOT NULL,
	`assignments` int unsigned NOT NULL,
	`constraintViolations` int unsigned NOT NULL,
	`feasible` boolean NOT NULL,
	`improvementOverBaseline` double NOT NULL,
	`iterations` int unsigned,
	`swapsAccepted` int unsigned,
	`converged` boolean,
	`stopReason` enum('converged','iteration_limit','time_limit'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `benchmark_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `benchmark_results_session_algorithm_uq` UNIQUE(`benchmarkSessionId`,`algorithmKey`)
);
--> statement-breakpoint
CREATE TABLE `benchmark_sessions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`requestedByUserId` int NOT NULL,
	`parameters` json NOT NULL,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `benchmark_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `benchmark_sessions_version_id_uq` UNIQUE(`datasetVersionId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `dataset_versions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`warehouseId` int unsigned NOT NULL,
	`versionNumber` int unsigned NOT NULL,
	`source` enum('csv','sample') NOT NULL,
	`status` enum('draft','ready','failed') NOT NULL DEFAULT 'draft',
	`createdByUserId` int NOT NULL,
	`layoutCount` int unsigned NOT NULL DEFAULT 0,
	`skuCount` int unsigned NOT NULL DEFAULT 0,
	`orderLineCount` int unsigned NOT NULL DEFAULT 0,
	`validationReport` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`validatedAt` timestamp,
	CONSTRAINT `dataset_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `dataset_versions_warehouse_version_uq` UNIQUE(`warehouseId`,`versionNumber`),
	CONSTRAINT `dataset_versions_warehouse_id_uq` UNIQUE(`warehouseId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `optimization_runs` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`requestedByUserId` int NOT NULL,
	`algorithmKey` enum('greedy','local_search') NOT NULL,
	`algorithmName` varchar(191) NOT NULL,
	`parameters` json NOT NULL,
	`routeAssumptions` json NOT NULL,
	`optimizerVersion` varchar(64) NOT NULL,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`runtimeMs` int unsigned,
	`iterations` int unsigned,
	`swapsAccepted` int unsigned,
	`converged` boolean,
	`stopReason` enum('converged','iteration_limit','time_limit'),
	`reasons` json NOT NULL,
	`validationReport` json,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `optimization_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `optimization_runs_version_id_uq` UNIQUE(`datasetVersionId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`orderId` int unsigned NOT NULL,
	`skuId` int unsigned NOT NULL,
	`quantity` int unsigned NOT NULL,
	`timestamp` varchar(64) NOT NULL,
	CONSTRAINT `order_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_lines_version_order_sku_uq` UNIQUE(`datasetVersionId`,`orderId`,`skuId`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`externalOrderId` varchar(191) NOT NULL,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_version_external_id_uq` UNIQUE(`datasetVersionId`,`externalOrderId`),
	CONSTRAINT `orders_version_id_uq` UNIQUE(`datasetVersionId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `run_assignments` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`optimizationRunId` int unsigned NOT NULL,
	`scope` enum('baseline','optimized') NOT NULL,
	`skuId` int unsigned NOT NULL,
	`locationId` int unsigned,
	`score` double NOT NULL,
	`reason` text NOT NULL,
	CONSTRAINT `run_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `run_assignments_run_scope_sku_uq` UNIQUE(`optimizationRunId`,`scope`,`skuId`),
	CONSTRAINT `run_assignments_run_scope_location_uq` UNIQUE(`optimizationRunId`,`scope`,`locationId`)
);
--> statement-breakpoint
CREATE TABLE `run_metrics` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`optimizationRunId` int unsigned NOT NULL,
	`scope` enum('baseline','optimized') NOT NULL,
	`objective` double NOT NULL,
	`totalDistance` double NOT NULL,
	`averageDistance` double NOT NULL,
	`averagePickSeconds` double NOT NULL,
	`throughput` double NOT NULL,
	`capacityUtilization` double NOT NULL,
	`validAssignments` int unsigned NOT NULL,
	`constraintViolations` int unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `run_metrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `run_metrics_run_scope_uq` UNIQUE(`optimizationRunId`,`scope`)
);
--> statement-breakpoint
CREATE TABLE `skus` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`skuId` varchar(191) NOT NULL,
	`length` double NOT NULL,
	`width` double NOT NULL,
	`height` double NOT NULL,
	`weight` double NOT NULL,
	`demandFrequency` double NOT NULL,
	`storageClass` enum('ambient','cold','hazmat') NOT NULL,
	`handlingRestrictions` text NOT NULL,
	CONSTRAINT `skus_id` PRIMARY KEY(`id`),
	CONSTRAINT `skus_version_sku_uq` UNIQUE(`datasetVersionId`,`skuId`),
	CONSTRAINT `skus_version_id_uq` UNIQUE(`datasetVersionId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `warehouse_locations` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`datasetVersionId` int unsigned NOT NULL,
	`locationId` varchar(191) NOT NULL,
	`xCoordinate` double NOT NULL,
	`yCoordinate` double NOT NULL,
	`aisleId` varchar(191) NOT NULL,
	`capacityWeight` double NOT NULL,
	`capacityVolume` double NOT NULL,
	`zone` enum('ambient','cold','hazmat') NOT NULL,
	`accessibility` enum('open','restricted') NOT NULL,
	CONSTRAINT `warehouse_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `warehouse_locations_version_location_uq` UNIQUE(`datasetVersionId`,`locationId`),
	CONSTRAINT `warehouse_locations_version_id_uq` UNIQUE(`datasetVersionId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(191) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`archivedAt` timestamp,
	CONSTRAINT `warehouses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD CONSTRAINT `benchmark_results_version_session_fk` FOREIGN KEY (`datasetVersionId`,`benchmarkSessionId`) REFERENCES `benchmark_sessions`(`datasetVersionId`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD CONSTRAINT `benchmark_results_version_run_fk` FOREIGN KEY (`datasetVersionId`,`optimizationRunId`) REFERENCES `optimization_runs`(`datasetVersionId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `benchmark_sessions` ADD CONSTRAINT `benchmark_sessions_datasetVersionId_dataset_versions_id_fk` FOREIGN KEY (`datasetVersionId`) REFERENCES `dataset_versions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `benchmark_sessions` ADD CONSTRAINT `benchmark_sessions_requestedByUserId_users_id_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataset_versions` ADD CONSTRAINT `dataset_versions_warehouseId_warehouses_id_fk` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataset_versions` ADD CONSTRAINT `dataset_versions_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `optimization_runs` ADD CONSTRAINT `optimization_runs_datasetVersionId_dataset_versions_id_fk` FOREIGN KEY (`datasetVersionId`) REFERENCES `dataset_versions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `optimization_runs` ADD CONSTRAINT `optimization_runs_requestedByUserId_users_id_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `order_lines_datasetVersionId_dataset_versions_id_fk` FOREIGN KEY (`datasetVersionId`) REFERENCES `dataset_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `order_lines_version_order_fk` FOREIGN KEY (`datasetVersionId`,`orderId`) REFERENCES `orders`(`datasetVersionId`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_lines` ADD CONSTRAINT `order_lines_version_sku_fk` FOREIGN KEY (`datasetVersionId`,`skuId`) REFERENCES `skus`(`datasetVersionId`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_datasetVersionId_dataset_versions_id_fk` FOREIGN KEY (`datasetVersionId`) REFERENCES `dataset_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_assignments` ADD CONSTRAINT `run_assignments_version_run_fk` FOREIGN KEY (`datasetVersionId`,`optimizationRunId`) REFERENCES `optimization_runs`(`datasetVersionId`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_assignments` ADD CONSTRAINT `run_assignments_version_sku_fk` FOREIGN KEY (`datasetVersionId`,`skuId`) REFERENCES `skus`(`datasetVersionId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_assignments` ADD CONSTRAINT `run_assignments_version_location_fk` FOREIGN KEY (`datasetVersionId`,`locationId`) REFERENCES `warehouse_locations`(`datasetVersionId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_metrics` ADD CONSTRAINT `run_metrics_optimizationRunId_optimization_runs_id_fk` FOREIGN KEY (`optimizationRunId`) REFERENCES `optimization_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skus` ADD CONSTRAINT `skus_datasetVersionId_dataset_versions_id_fk` FOREIGN KEY (`datasetVersionId`) REFERENCES `dataset_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_locations` ADD CONSTRAINT `warehouse_locations_datasetVersionId_dataset_versions_id_fk` FOREIGN KEY (`datasetVersionId`) REFERENCES `dataset_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `benchmark_results_version_session_idx` ON `benchmark_results` (`datasetVersionId`,`benchmarkSessionId`);--> statement-breakpoint
CREATE INDEX `benchmark_results_version_run_idx` ON `benchmark_results` (`datasetVersionId`,`optimizationRunId`);--> statement-breakpoint
CREATE INDEX `benchmark_results_run_scope_idx` ON `benchmark_results` (`optimizationRunId`,`resultScope`);--> statement-breakpoint
CREATE INDEX `benchmark_sessions_version_created_idx` ON `benchmark_sessions` (`datasetVersionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `benchmark_sessions_requester_created_idx` ON `benchmark_sessions` (`requestedByUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `dataset_versions_warehouse_created_idx` ON `dataset_versions` (`warehouseId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `dataset_versions_status_created_idx` ON `dataset_versions` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `optimization_runs_version_created_idx` ON `optimization_runs` (`datasetVersionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `optimization_runs_requester_created_idx` ON `optimization_runs` (`requestedByUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `optimization_runs_status_created_idx` ON `optimization_runs` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `order_lines_version_order_idx` ON `order_lines` (`datasetVersionId`,`orderId`);--> statement-breakpoint
CREATE INDEX `order_lines_version_sku_idx` ON `order_lines` (`datasetVersionId`,`skuId`);--> statement-breakpoint
CREATE INDEX `run_assignments_version_run_idx` ON `run_assignments` (`datasetVersionId`,`optimizationRunId`);--> statement-breakpoint
CREATE INDEX `run_assignments_version_sku_idx` ON `run_assignments` (`datasetVersionId`,`skuId`);--> statement-breakpoint
CREATE INDEX `run_assignments_version_location_idx` ON `run_assignments` (`datasetVersionId`,`locationId`);--> statement-breakpoint
CREATE INDEX `skus_version_storage_class_idx` ON `skus` (`datasetVersionId`,`storageClass`);--> statement-breakpoint
CREATE INDEX `warehouse_locations_version_zone_aisle_idx` ON `warehouse_locations` (`datasetVersionId`,`zone`,`aisleId`);--> statement-breakpoint
CREATE INDEX `warehouses_owner_updated_idx` ON `warehouses` (`ownerUserId`,`updatedAt`);