CREATE TABLE "stock_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"photo_id" text NOT NULL,
	"asset_key" text NOT NULL,
	"local_path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"author" text NOT NULL,
	"author_url" text NOT NULL,
	"photo_url" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"download_tracked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_photos_project_photo_uq" UNIQUE("project_id","provider","photo_id")
);
--> statement-breakpoint
ALTER TABLE "stock_photos" ADD CONSTRAINT "stock_photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;