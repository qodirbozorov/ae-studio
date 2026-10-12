ALTER TABLE "telegram_logins" ADD COLUMN "match_code" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "chat_id" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "message_id" integer;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "reject_reason" text;