PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_databases` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`mark` text NOT NULL,
	`purpose` text NOT NULL,
	`recordCount` text NOT NULL,
	`access` text NOT NULL,
	`state` text NOT NULL,
	`authorization` text NOT NULL,
	`endpoint` text NOT NULL,
	`operations` text NOT NULL,
	`defaultHeaders` text NOT NULL,
	`holds` text NOT NULL,
	`updateCadence` text NOT NULL,
	`licence` text NOT NULL,
	`docsUrl` text NOT NULL,
	`sample` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_databases`("id", "position", "name", "family", "mark", "purpose", "recordCount", "access", "state", "authorization", "endpoint", "operations", "defaultHeaders", "holds", "updateCadence", "licence", "docsUrl", "sample") SELECT "id", "position", "name", "family", "mark", "purpose", "recordCount", "access", "state", "authorization", "endpoint", "operations", "defaultHeaders", "holds", "updateCadence", "licence", "docsUrl", "sample" FROM `databases`;--> statement-breakpoint
DROP TABLE `databases`;--> statement-breakpoint
ALTER TABLE `__new_databases` RENAME TO `databases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;