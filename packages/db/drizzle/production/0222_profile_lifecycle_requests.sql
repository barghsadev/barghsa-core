ALTER TABLE tickets ADD CONSTRAINT tickets_category_privacy_valid
  CHECK (category IN ('general','billing','orders','privacy'));
--> statement-breakpoint
ALTER TABLE tickets DROP CONSTRAINT tickets_category_valid;
--> statement-breakpoint
ALTER TABLE tickets RENAME CONSTRAINT tickets_category_privacy_valid TO tickets_category_valid;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN privacy_request_type text;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN privacy_request_key uuid;
--> statement-breakpoint
ALTER TABLE tickets ADD CONSTRAINT tickets_privacy_request_valid CHECK (
  (privacy_request_type IS NULL AND privacy_request_key IS NULL)
  OR (category='privacy' AND profile_id IS NOT NULL
    AND privacy_request_type IN ('export','closure') AND privacy_request_key IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX tickets_privacy_request_idempotency
  ON tickets(user_id,privacy_request_key) WHERE privacy_request_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX tickets_privacy_profile_created
  ON tickets(profile_id,created_at DESC) WHERE privacy_request_type IS NOT NULL;
