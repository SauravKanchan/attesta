CREATE TABLE `deployments` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`t` integer NOT NULL,
	`status` text NOT NULL,
	`action` text,
	`target_weights_bps` text,
	`reason` text,
	`pnl_applied` text,
	`tx_hash` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `executions_strategy_t_idx` ON `executions` (`strategy_id`,`t`);--> statement-breakpoint
CREATE INDEX `executions_status_idx` ON `executions` (`status`);--> statement-breakpoint
CREATE TABLE `nav_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`t` integer NOT NULL,
	`nav_per_share` text NOT NULL,
	`total_assets` text NOT NULL,
	`total_shares` text NOT NULL,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `nav_snapshots_strategy_t_idx` ON `nav_snapshots` (`strategy_id`,`t`);--> statement-breakpoint
CREATE TABLE `position_events` (
	`id` text PRIMARY KEY NOT NULL,
	`position_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` text NOT NULL,
	`shares` text NOT NULL,
	`tx_hash` text,
	`t` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `position_events_position_t_idx` ON `position_events` (`position_id`,`t`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`shares` text DEFAULT '0' NOT NULL,
	`cost_basis` text DEFAULT '0' NOT NULL,
	`first_allocated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_user_strategy_unique` ON `positions` (`user_id`,`strategy_id`);--> statement-breakpoint
CREATE INDEX `positions_strategy_id_idx` ON `positions` (`strategy_id`);--> statement-breakpoint
CREATE INDEX `positions_user_id_idx` ON `positions` (`user_id`);--> statement-breakpoint
CREATE TABLE `price_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`t` integer NOT NULL,
	`price` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_ticks_symbol_t_unique` ON `price_ticks` (`symbol`,`t`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text,
	`strategy_id` text,
	`key` text NOT NULL,
	`ciphertext` text NOT NULL,
	`scheme` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_submission_key_unique` ON `secrets` (`submission_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_strategy_key_unique` ON `secrets` (`strategy_id`,`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`ticker` text NOT NULL,
	`types` text NOT NULL,
	`risk_level` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`creator_id` text NOT NULL,
	`vault_address` text,
	`agent_wallet_address` text,
	`agent_wallet_key` text,
	`source_code` text,
	`binary_hash` text,
	`config_hash` text,
	`workflow_id` text,
	`assets` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strategies_slug_unique` ON `strategies` (`slug`);--> statement-breakpoint
CREATE INDEX `strategies_status_idx` ON `strategies` (`status`);--> statement-breakpoint
CREATE INDEX `strategies_creator_id_idx` ON `strategies` (`creator_id`);--> statement-breakpoint
CREATE INDEX `strategies_risk_level_idx` ON `strategies` (`risk_level`);--> statement-breakpoint
CREATE INDEX `strategies_status_created_at_idx` ON `strategies` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`ticker` text DEFAULT '' NOT NULL,
	`types` text NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source_code` text DEFAULT '' NOT NULL,
	`checks` text NOT NULL,
	`simulation_log` text NOT NULL,
	`binary_hash` text,
	`config_hash` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`strategy_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `submissions_creator_id_idx` ON `submissions` (`creator_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE INDEX `submissions_created_at_idx` ON `submissions` (`created_at`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`t` integer NOT NULL,
	`pair` text NOT NULL,
	`side` text NOT NULL,
	`size` text NOT NULL,
	`price` text NOT NULL,
	`pnl` text DEFAULT '0' NOT NULL,
	`tx_hash` text,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trades_strategy_t_idx` ON `trades` (`strategy_id`,`t`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`wallet_address` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_wallet_address_unique` ON `users` (`wallet_address`);