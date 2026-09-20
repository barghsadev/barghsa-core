ALTER TABLE "otp_challenges" ADD COLUMN "auth_version" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Existing account codes have no reliable credential snapshot. Retain and invalidate them.
UPDATE otp_challenges SET consumed_at=COALESCE(consumed_at,NOW()),attempts_remaining=0
WHERE user_id IS NOT NULL AND auth_version IS NULL;
--> statement-breakpoint
CREATE FUNCTION bump_user_auth_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.password_hash,NEW.username,NEW.email,NEW.mobile,NEW.disabled_at,NEW.must_change_password)
     IS DISTINCT FROM ROW(OLD.password_hash,OLD.username,OLD.email,OLD.mobile,OLD.disabled_at,OLD.must_change_password) THEN
    NEW.auth_version := OLD.auth_version + 1;
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
CREATE TRIGGER users_auth_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION bump_user_auth_version();
--> statement-breakpoint
CREATE FUNCTION bind_otp_auth_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.auth_version IS NULL THEN
    SELECT auth_version INTO NEW.auth_version FROM users WHERE user_id=NEW.user_id;
    IF NEW.auth_version IS NULL THEN RAISE EXCEPTION 'OTP account unavailable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER otp_auth_version BEFORE INSERT ON otp_challenges FOR EACH ROW EXECUTE FUNCTION bind_otp_auth_version();
