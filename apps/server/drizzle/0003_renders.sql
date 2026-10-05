ALTER TABLE "renders" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "encoder" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "error" jsonb;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;