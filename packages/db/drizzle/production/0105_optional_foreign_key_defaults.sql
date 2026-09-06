-- An absent optional relationship must remain NULL, never a newly generated nonexistent target.
ALTER TABLE email_suppressions ALTER COLUMN profile_id DROP DEFAULT;
ALTER TABLE email_suppressions ALTER COLUMN source_event_id DROP DEFAULT;
ALTER TABLE email_webhook_events ALTER COLUMN outbox_id DROP DEFAULT;
ALTER TABLE invoices ALTER COLUMN order_id DROP DEFAULT;
