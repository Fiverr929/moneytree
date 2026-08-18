CREATE TABLE `cloud_generation` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	PRIMARY KEY (`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_generation_owner_project_updated` ON `cloud_generation` (`owner_key`, `project_id`, `updated_at`);
--> statement-breakpoint
PRAGMA optimize;
