-- Reserve primary usernames and explicitly verified secondary login contacts in one namespace.
-- Legacy email/mobile fields are intentionally not imported as verified identifiers.
CREATE TABLE account_login_identifiers (
  destination text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT account_login_identifiers_kind_check CHECK (kind IN ('primary','email','mobile')),
  CONSTRAINT account_login_identifiers_destination_check CHECK (destination=lower(destination) AND length(destination)>0),
  CONSTRAINT account_login_identifiers_proof_check CHECK ((kind='primary' AND verified_at IS NULL) OR (kind<>'primary' AND verified_at IS NOT NULL)),
  CONSTRAINT account_login_identifiers_user_kind_key UNIQUE(user_id,kind)
);
--> statement-breakpoint
INSERT INTO account_login_identifiers(destination,user_id,kind)
SELECT lower(username),user_id,'primary' FROM users;
--> statement-breakpoint
CREATE FUNCTION validate_account_login_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account users%ROWTYPE;
BEGIN
  SELECT * INTO account FROM users WHERE user_id=NEW.user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Login account is missing' USING ERRCODE='23503'; END IF;
  IF (NEW.kind='primary' AND NEW.destination IS DISTINCT FROM lower(account.username))
     OR (NEW.kind='email' AND NEW.destination IS DISTINCT FROM lower(account.email))
     OR (NEW.kind='mobile' AND NEW.destination IS DISTINCT FROM account.mobile) THEN
    RAISE EXCEPTION 'Login identifier must match the current account destination' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_login_identifier_validate BEFORE INSERT OR UPDATE ON account_login_identifiers
FOR EACH ROW EXECUTE FUNCTION validate_account_login_identifier();
--> statement-breakpoint
CREATE FUNCTION synchronize_account_login_identifiers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.username,NEW.email,NEW.mobile) IS NOT DISTINCT FROM ROW(OLD.username,OLD.email,OLD.mobile) THEN
    RETURN NEW;
  END IF;
  DELETE FROM account_login_identifiers WHERE user_id=NEW.user_id AND (
    (kind='primary' AND destination IS DISTINCT FROM lower(NEW.username)) OR
    (kind='email' AND destination IS DISTINCT FROM lower(NEW.email)) OR
    (kind='mobile' AND destination IS DISTINCT FROM NEW.mobile)
  );
  INSERT INTO account_login_identifiers(destination,user_id,kind)
  VALUES(lower(NEW.username),NEW.user_id,'primary')
  ON CONFLICT(destination) DO UPDATE SET kind='primary',verified_at=NULL
    WHERE account_login_identifiers.user_id=EXCLUDED.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Login destination is already registered' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_login_identifiers AFTER INSERT OR UPDATE OF username,email,mobile ON users
FOR EACH ROW EXECUTE FUNCTION synchronize_account_login_identifiers();
