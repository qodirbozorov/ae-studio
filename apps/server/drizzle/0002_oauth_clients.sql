ALTER TABLE "oauth_clients" ADD COLUMN "kind" text DEFAULT 'dcr' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "token_endpoint_auth_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "secret_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;