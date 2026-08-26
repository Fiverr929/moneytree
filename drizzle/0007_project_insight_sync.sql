CREATE TABLE `cloud_agent_insight` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`insight_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_agent_insight_owner_project_updated` ON `cloud_agent_insight` (`owner_key`,`project_id`,`updated_at`);
