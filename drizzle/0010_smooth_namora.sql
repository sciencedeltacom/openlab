DROP TABLE `programs`;--> statement-breakpoint
DROP TABLE `studies`;--> statement-breakpoint
ALTER TABLE `experiments` DROP COLUMN `studyId`;--> statement-breakpoint
ALTER TABLE `inboxEntries` DROP COLUMN `studyId`;--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `study`;--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `studyId`;--> statement-breakpoint
ALTER TABLE `notes` DROP COLUMN `studyId`;--> statement-breakpoint
ALTER TABLE `notes` DROP COLUMN `programId`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `studyId`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `milestoneId`;