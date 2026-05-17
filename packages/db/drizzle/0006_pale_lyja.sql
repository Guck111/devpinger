CREATE TABLE "preorders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"stripe_session_id" text,
	"email" text NOT NULL,
	"telegram_username" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preorders_stripe_event_id_unique" UNIQUE("stripe_event_id"),
	CONSTRAINT "preorders_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
