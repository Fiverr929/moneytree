CREATE TABLE `agent_memory` (
	`owner_key` text NOT NULL,
	`id` text NOT NULL,
	`scope` text NOT NULL CHECK (`scope` IN ('user', 'project')),
	`project_key` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`confidence` real NOT NULL,
	`pinned` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_used_at` text,
	`use_count` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`owner_key`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_memory_owner_scope` ON `agent_memory` (`owner_key`, `scope`);
--> statement-breakpoint
CREATE INDEX `idx_agent_memory_owner_project` ON `agent_memory` (`owner_key`, `project_key`);
