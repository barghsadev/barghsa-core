CREATE TABLE "telegram_link_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"telegram_user_id" bigint,
	"chat_id" bigint,
	"claimed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmation_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "telegram_intent_hash" CHECK ("telegram_link_intents"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "telegram_intent_status" CHECK ("telegram_link_intents"."status" IN ('pending','claimed','confirmed','cancelled')),
	CONSTRAINT "telegram_intent_expiry" CHECK ("telegram_link_intents"."expires_at">"telegram_link_intents"."created_at" AND "telegram_link_intents"."expires_at"<="telegram_link_intents"."created_at"+INTERVAL '10 minutes'),
	CONSTRAINT "telegram_intent_attempts" CHECK ("telegram_link_intents"."confirmation_attempts" BETWEEN 0 AND 5),
	CONSTRAINT "telegram_intent_private" CHECK (("telegram_link_intents"."telegram_user_id" IS NULL AND "telegram_link_intents"."chat_id" IS NULL AND "telegram_link_intents"."claimed_at" IS NULL) OR ("telegram_link_intents"."telegram_user_id" IS NOT NULL AND "telegram_link_intents"."chat_id" IS NOT NULL AND "telegram_link_intents"."telegram_user_id" BETWEEN 1 AND 4503599627370495 AND "telegram_link_intents"."chat_id"="telegram_link_intents"."telegram_user_id" AND "telegram_link_intents"."claimed_at" IS NOT NULL)),
	CONSTRAINT "telegram_intent_state_proof" CHECK (("telegram_link_intents"."status"='pending' AND "telegram_link_intents"."telegram_user_id" IS NULL AND "telegram_link_intents"."confirmed_at" IS NULL) OR ("telegram_link_intents"."status"='claimed' AND "telegram_link_intents"."telegram_user_id" IS NOT NULL AND "telegram_link_intents"."confirmed_at" IS NULL) OR ("telegram_link_intents"."status"='confirmed' AND "telegram_link_intents"."telegram_user_id" IS NOT NULL AND "telegram_link_intents"."confirmed_at" IS NOT NULL) OR ("telegram_link_intents"."status"='cancelled' AND "telegram_link_intents"."confirmed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "telegram_link_private" CHECK ("telegram_links"."telegram_user_id" BETWEEN 1 AND 4503599627370495 AND "telegram_links"."chat_id"="telegram_links"."telegram_user_id"),
	CONSTRAINT "telegram_link_revocation" CHECK ("telegram_links"."revoked_at" IS NULL OR "telegram_links"."revoked_at">="telegram_links"."verified_at")
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"update_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"intent_id" uuid,
	"link_id" uuid,
	"request_hash" text NOT NULL,
	"message" text,
	"answer" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_message_id" bigint,
	"last_error" text,
	CONSTRAINT "telegram_update_identity" CHECK ("telegram_updates"."update_id" BETWEEN 0 AND 9007199254740991 AND "telegram_updates"."message_id">0 AND "telegram_updates"."telegram_user_id" BETWEEN 1 AND 4503599627370495 AND "telegram_updates"."chat_id"="telegram_updates"."telegram_user_id"),
	CONSTRAINT "telegram_update_hash" CHECK ("telegram_updates"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "telegram_update_kind" CHECK (("telegram_updates"."kind"='link_confirmation' AND "telegram_updates"."intent_id" IS NOT NULL AND "telegram_updates"."link_id" IS NULL AND "telegram_updates"."message" IS NULL) OR ("telegram_updates"."kind"='question' AND "telegram_updates"."link_id" IS NOT NULL AND "telegram_updates"."intent_id" IS NULL AND "telegram_updates"."message" IS NOT NULL AND char_length("telegram_updates"."message") BETWEEN 1 AND 1000)),
	CONSTRAINT "telegram_update_status" CHECK ("telegram_updates"."status" IN ('queued','processing','ready','sending','sent','denied','failed','unknown')),
	CONSTRAINT "telegram_update_attempts" CHECK ("telegram_updates"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "telegram_update_lease" CHECK (("telegram_updates"."status" IN ('processing','sending') AND "telegram_updates"."lease_token" IS NOT NULL AND "telegram_updates"."lease_until" IS NOT NULL) OR ("telegram_updates"."status" NOT IN ('processing','sending') AND "telegram_updates"."lease_token" IS NULL AND "telegram_updates"."lease_until" IS NULL)),
	CONSTRAINT "telegram_update_receipt" CHECK (("telegram_updates"."status"='sent' AND "telegram_updates"."sent_message_id" IS NOT NULL AND "telegram_updates"."sent_message_id">0) OR ("telegram_updates"."status"<>'sent' AND "telegram_updates"."sent_message_id" IS NULL)),
	CONSTRAINT "telegram_update_answer" CHECK ("telegram_updates"."answer" IS NULL OR (jsonb_typeof("telegram_updates"."answer")='object' AND octet_length("telegram_updates"."answer"::text)<=32768))
);
--> statement-breakpoint
ALTER TABLE "telegram_link_intents" ADD CONSTRAINT "telegram_link_intents_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_intents" ADD CONSTRAINT "telegram_link_intents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_intent_id_telegram_link_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."telegram_link_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_intent_id_telegram_link_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."telegram_link_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_link_id_telegram_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."telegram_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_intent_token_unique" ON "telegram_link_intents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_intent_owner_idx" ON "telegram_link_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_intent_unique" ON "telegram_links" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_active_user_unique" ON "telegram_links" USING btree ("user_id") WHERE "telegram_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_active_chat_unique" ON "telegram_links" USING btree ("telegram_user_id") WHERE "telegram_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "telegram_link_profile_idx" ON "telegram_links" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_update_id_unique" ON "telegram_updates" USING btree ("update_id");--> statement-breakpoint
CREATE INDEX "telegram_update_work_idx" ON "telegram_updates" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "telegram_update_link_idx" ON "telegram_updates" USING btree ("link_id","created_at");
--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON telegram_link_intents
  FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON telegram_links
  FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON telegram_updates
  FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
--> statement-breakpoint
CREATE FUNCTION guard_telegram_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Telegram linking history is retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' OR NEW.confirmation_attempts<>0 THEN
      RAISE EXCEPTION 'Telegram link intents begin pending' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.created_at,NEW.user_id,NEW.profile_id,NEW.session_id,NEW.token_hash,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.user_id,OLD.profile_id,OLD.session_id,OLD.token_hash,OLD.expires_at)
    OR OLD.status IN ('confirmed','cancelled')
    OR NEW.confirmation_attempts<OLD.confirmation_attempts
    OR NEW.confirmation_attempts>OLD.confirmation_attempts+1 THEN
    RAISE EXCEPTION 'Telegram intent identity and terminal evidence are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='pending' AND NEW.status NOT IN ('claimed','cancelled') THEN
    RAISE EXCEPTION 'Telegram intent must be claimed before confirmation' USING ERRCODE='23514';
  END IF;
  IF OLD.status='claimed' AND (
    NEW.status NOT IN ('claimed','confirmed','cancelled')
    OR ROW(NEW.telegram_user_id,NEW.chat_id,NEW.claimed_at)
      IS DISTINCT FROM ROW(OLD.telegram_user_id,OLD.chat_id,OLD.claimed_at)
  ) THEN
    RAISE EXCEPTION 'Claimed Telegram identity cannot be rebound' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('claimed','confirmed') AND NEW.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Telegram link intent expired' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER telegram_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON telegram_link_intents
  FOR EACH ROW EXECUTE FUNCTION guard_telegram_intent();
--> statement-breakpoint
CREATE FUNCTION guard_telegram_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Telegram link history is retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM telegram_link_intents i WHERE i.id=NEW.intent_id AND i.status='confirmed'
        AND i.user_id=NEW.user_id AND i.profile_id=NEW.profile_id
        AND i.telegram_user_id=NEW.telegram_user_id AND i.chat_id=NEW.chat_id
        AND i.confirmed_at=NEW.verified_at
    ) THEN
      RAISE EXCEPTION 'Telegram link requires exact confirmed intent evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
    ROW(NEW.id,NEW.created_at,NEW.user_id,NEW.profile_id,NEW.intent_id,
        NEW.telegram_user_id,NEW.chat_id,NEW.verified_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.user_id,OLD.profile_id,OLD.intent_id,
        OLD.telegram_user_id,OLD.chat_id,OLD.verified_at) THEN
    RAISE EXCEPTION 'Only permanent revocation may change a Telegram link' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER telegram_link_guard BEFORE INSERT OR UPDATE OR DELETE ON telegram_links
  FOR EACH ROW EXECUTE FUNCTION guard_telegram_link();
--> statement-breakpoint
CREATE FUNCTION guard_telegram_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Telegram update and delivery history is retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'queued' OR NEW.attempts<>0 OR NEW.answer IS NOT NULL THEN
      RAISE EXCEPTION 'Telegram updates begin queued' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='question' AND NOT EXISTS (
      SELECT 1 FROM telegram_links l WHERE l.id=NEW.link_id AND l.revoked_at IS NULL
        AND l.telegram_user_id=NEW.telegram_user_id AND l.chat_id=NEW.chat_id
    ) THEN
      RAISE EXCEPTION 'Telegram question requires its exact private binding' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='link_confirmation' AND NOT EXISTS (
      SELECT 1 FROM telegram_link_intents i WHERE i.id=NEW.intent_id AND i.status='claimed'
        AND i.expires_at>clock_timestamp()
        AND i.telegram_user_id=NEW.telegram_user_id AND i.chat_id=NEW.chat_id
    ) THEN
      RAISE EXCEPTION 'Telegram confirmation requires its exact live claim' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.created_at,NEW.update_id,NEW.message_id,NEW.telegram_user_id,NEW.chat_id,
      NEW.kind,NEW.intent_id,NEW.link_id,NEW.request_hash,NEW.message)
    IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.update_id,OLD.message_id,OLD.telegram_user_id,OLD.chat_id,
      OLD.kind,OLD.intent_id,OLD.link_id,OLD.request_hash,OLD.message)
    OR OLD.status IN ('sent','denied','failed','unknown')
    OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
    OR (OLD.answer IS NOT NULL AND NEW.answer IS DISTINCT FROM OLD.answer) THEN
    RAISE EXCEPTION 'Telegram update identity, answer and terminal delivery are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (OLD.status='queued' AND NEW.status IN ('processing','denied','failed')) OR
    (OLD.status='processing' AND NEW.status IN ('ready','denied','failed')) OR
    (OLD.status='ready' AND NEW.status IN ('sending','denied','failed')) OR
    (OLD.status='sending' AND NEW.status IN ('sent','unknown','failed')) OR
    (OLD.status='sending' AND NEW.status='ready' AND NEW.last_error='telegram_rate_limited')
  ) THEN
    RAISE EXCEPTION 'Telegram delivery transition is not permitted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER telegram_update_guard BEFORE INSERT OR UPDATE OR DELETE ON telegram_updates
  FOR EACH ROW EXECUTE FUNCTION guard_telegram_update();
