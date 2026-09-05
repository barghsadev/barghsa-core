ALTER TABLE "auth_delivery_outbox" ALTER COLUMN "challenge_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD COLUMN "kind" text DEFAULT 'otp' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD CONSTRAINT "auth_delivery_outbox_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD CONSTRAINT "auth_delivery_binding_check" CHECK (("auth_delivery_outbox"."kind"='otp' AND "auth_delivery_outbox"."challenge_id" IS NOT NULL AND "auth_delivery_outbox"."user_id" IS NULL) OR ("auth_delivery_outbox"."kind"='staff_activation' AND "auth_delivery_outbox"."challenge_id" IS NULL AND "auth_delivery_outbox"."user_id" IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_user_auth_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.password_hash,NEW.username,NEW.email,NEW.mobile,NEW.disabled_at,NEW.must_change_password)
     IS DISTINCT FROM ROW(OLD.password_hash,OLD.username,OLD.email,OLD.mobile,OLD.disabled_at,OLD.must_change_password) THEN
    NEW.auth_version := OLD.auth_version + 1;
    IF NEW.activation_token IS NOT DISTINCT FROM OLD.activation_token THEN
      NEW.activation_token := NULL;
      NEW.activation_token_expires_at := NULL;
    END IF;
    IF NEW.password_change_token IS NOT DISTINCT FROM OLD.password_change_token THEN
      NEW.password_change_token := NULL;
      NEW.password_change_token_expires_at := NULL;
    END IF;
  ELSE
    NEW.auth_version := OLD.auth_version;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE INDEX users_activation_token_idx ON users(activation_token) WHERE activation_token IS NOT NULL;
