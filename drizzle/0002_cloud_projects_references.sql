CREATE TABLE `cloud_project` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	PRIMARY KEY (`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_project_owner_updated` ON `cloud_project` (`owner_key`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `cloud_project_state` (
	`owner_key` text NOT NULL,
	`project_id` text NOT NULL,
	`folders_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`owner_key`, `project_id`)
);
--> statement-breakpoint
CREATE TABLE `cloud_reference` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`folder` text,
	`kind` text NOT NULL,
	`size` text NOT NULL,
	`dims` text NOT NULL,
	`modified` text NOT NULL,
	`eye` integer NOT NULL,
	`strength` real NOT NULL,
	`mode` text NOT NULL,
	`visual_read` text,
	`visual_read_source` text,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	PRIMARY KEY (`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_reference_owner_project` ON `cloud_reference` (`owner_key`, `project_id`);
--> statement-breakpoint
CREATE INDEX `idx_cloud_reference_owner_updated` ON `cloud_reference` (`owner_key`, `updated_at`);
--> statement-breakpoint
PRAGMA optimize;
