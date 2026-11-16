ALTER TABLE `databases` ADD COLUMN `operations` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `databases` DROP COLUMN `defaultPath`;--> statement-breakpoint
ALTER TABLE `databases` DROP COLUMN `defaultMethod`;--> statement-breakpoint
ALTER TABLE `databases` DROP COLUMN `methods`;--> statement-breakpoint
ALTER TABLE `databases` DROP COLUMN `takesBody`;--> statement-breakpoint
ALTER TABLE `databases` DROP COLUMN `body`;--> statement-breakpoint
