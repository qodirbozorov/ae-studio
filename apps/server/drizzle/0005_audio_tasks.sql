ALTER TABLE "audio_tasks" ALTER COLUMN "job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eleven_cache" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "inputs" jsonb;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "ext" text;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "cached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "eleven_cache" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "eleven_cache" ADD COLUMN "ext" text;--> statement-breakpoint
ALTER TABLE "eleven_cache" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "eleven_cache" ADD COLUMN "credits" integer;--> statement-breakpoint
ALTER TABLE "eleven_cache" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD CONSTRAINT "audio_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tasks" ADD CONSTRAINT "audio_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_tasks_project_idx" ON "audio_tasks" USING btree ("project_id");