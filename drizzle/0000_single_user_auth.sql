CREATE TABLE `auth_user` (
	`id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
	`username` text NOT NULL UNIQUE,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_login_attempt` (
	`client_id` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_started_at` integer NOT NULL
);
