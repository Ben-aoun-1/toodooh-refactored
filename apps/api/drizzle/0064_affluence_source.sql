CREATE TYPE "public"."affluence_source" AS ENUM('measured', 'backup');--> statement-breakpoint
ALTER TABLE "screenhost_affluence" ADD COLUMN "source" "affluence_source";