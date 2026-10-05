ALTER TABLE "jobs" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "aep_version" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "oplist_hash" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_device_active_uq" ON "jobs" USING btree ("device_id") WHERE "jobs"."state" <> 'DONE';--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_aep_version_uq" UNIQUE("project_id","aep_version");