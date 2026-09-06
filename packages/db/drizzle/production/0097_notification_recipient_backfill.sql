-- Restore explicit outbox recipient privacy where durable delivery identity proves the source.
-- Read state, content and unlinked legacy history remain unchanged.
UPDATE in_app_notifications n SET recipient_user_id=o.user_id
FROM notification_outbox o WHERE n.delivery_key='outbox:'||o.id::text
  AND n.profile_id=o.profile_id AND n.recipient_user_id IS NULL AND o.user_id IS NOT NULL;
