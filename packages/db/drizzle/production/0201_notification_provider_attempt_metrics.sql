-- Keep the provider identity on every delivery attempt. The receipt row only
-- records the latest attempt, so it cannot attribute historical failures.
ALTER TABLE notification_delivery_log ADD COLUMN provider_id uuid;
CREATE INDEX idx_ndl_provider_created ON notification_delivery_log (provider_id, created_at);
