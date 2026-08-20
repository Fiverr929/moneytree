ALTER TABLE `cloud_reference` ADD `visual_read_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `cloud_reference` ADD `visual_read_version` text;
--> statement-breakpoint
PRAGMA optimize;
