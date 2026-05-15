CREATE TYPE "public"."lang" AS ENUM('en', 'ru');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'personal', 'pro', 'team');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('github', 'jira');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('pending', 'delivered', 'muted', 'snoozed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."mute_scope_type" AS ENUM('source', 'repo', 'project', 'event_type');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"telegram_username" text,
	"lang" "lang" DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"notify_self_actions" boolean DEFAULT false NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"plan_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"encrypted_credentials" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_scope_id" text NOT NULL,
	"display_name" text NOT NULL,
	"webhook_id" text,
	"webhook_secret" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "provider" NOT NULL,
	"source_event_id" text NOT NULL,
	"type" text NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"body_preview" text,
	"url" text NOT NULL,
	"scope" text,
	"actor_username" text,
	"actor_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"telegram_message_id" integer,
	"snoozed_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "mute_scope_type" NOT NULL,
	"scope_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"code_verifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_provider_idx" ON "connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_provider_scope_idx" ON "subscriptions" USING btree ("user_id","provider","provider_scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_user_source_event_idx" ON "events" USING btree ("user_id","source","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mutes_user_scope_idx" ON "mutes" USING btree ("user_id","scope_type","scope_value");