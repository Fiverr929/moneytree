CREATE TABLE `agent_message` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`project_key` text NOT NULL,
	`session_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_message_owner_project_session_created`
ON `agent_message` (`owner_key`, `project_key`, `session_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `agent_checkpoint` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`project_key` text NOT NULL,
	`session_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_checkpoint_owner_project_session_updated`
ON `agent_checkpoint` (`owner_key`, `project_key`, `session_id`, `updated_at`);
