CREATE TABLE `auth_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_address_idx` ON `auth_challenges` (`address`);--> statement-breakpoint
CREATE INDEX `auth_challenges_expires_at_idx` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `private_key`;