CREATE TABLE "usage_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"audio_task_id" uuid,
	"kind" text NOT NULL,
	"item" text NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"amount_micros" bigint NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "balance_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_audio_task_id_audio_tasks_id_fk" FOREIGN KEY ("audio_task_id") REFERENCES "public"."audio_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_ledger_user_idx" ON "usage_ledger" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_task_uq" ON "usage_ledger" USING btree ("audio_task_id") WHERE audio_task_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_timeline_uq" ON "usage_ledger" USING btree ("job_id") WHERE item = 'timeline';