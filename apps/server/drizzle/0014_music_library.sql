CREATE TABLE "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_s" double precision NOT NULL,
	"bpm" integer,
	"loopable" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'public' NOT NULL,
	"owner_user_id" uuid,
	"audio_task_id" uuid,
	"prompt" text,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"ext" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_audio_task_id_audio_tasks_id_fk" FOREIGN KEY ("audio_task_id") REFERENCES "public"."audio_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "music_tracks_sha_uq" ON "music_tracks" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "music_tracks_status_idx" ON "music_tracks" USING btree ("status","category");