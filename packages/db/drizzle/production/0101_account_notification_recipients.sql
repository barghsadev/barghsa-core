ALTER TABLE notification_outbox ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE notification_outbox ALTER COLUMN profile_id DROP DEFAULT;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_recipient_check CHECK (profile_id IS NOT NULL OR user_id IS NOT NULL);
