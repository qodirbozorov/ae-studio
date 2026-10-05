CREATE TABLE "pronunciation_dicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"el_id" text NOT NULL,
	"version_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pronunciation_dicts_user_slug_uq" UNIQUE("user_id","slug")
);
--> statement-breakpoint
ALTER TABLE "pronunciation_dicts" ADD CONSTRAINT "pronunciation_dicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;