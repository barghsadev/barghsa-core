ALTER TABLE "sessions" ADD COLUMN "operating_context" text;--> statement-breakpoint
UPDATE sessions s
SET operating_context=CASE
  WHEN u.is_admin OR u.is_staff OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id=u.user_id)
    THEN 'staff'
  ELSE 'customer'
END
FROM users u WHERE u.user_id=s.user_id;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_operating_context_valid"
  CHECK (operating_context IN ('staff','customer'));--> statement-breakpoint
CREATE FUNCTION set_session_operating_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operating_context IS NULL THEN
    SELECT CASE
      WHEN u.is_admin OR u.is_staff OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id=u.user_id)
        THEN 'staff'
      ELSE 'customer'
    END INTO NEW.operating_context
    FROM users u WHERE u.user_id=NEW.user_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER sessions_operating_context_default
  BEFORE INSERT ON sessions FOR EACH ROW
  EXECUTE FUNCTION set_session_operating_context();--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "operating_context" SET NOT NULL;
