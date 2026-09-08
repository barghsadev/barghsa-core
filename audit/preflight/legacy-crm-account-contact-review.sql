-- Read-only operator review; do not use these events to auto-revert accounts.
-- Old CRM edits could change account contacts without OTP verification.
-- The current profile owner may differ from the owner when the event occurred.
-- Metadata is historical text: malformed JSON is excluded and must be reviewed
-- separately, rather than making this inspection fail.
WITH events AS (
  SELECT id, user_id AS actor_user_id, created_at,
    CASE WHEN pg_input_is_valid(metadata, 'jsonb') THEN metadata::jsonb END AS detail
  FROM audit_log WHERE event = 'profile_updated'
)
SELECT e.id, e.created_at, e.actor_user_id,
  e.detail->>'profileId' AS profile_id,
  p.user_id AS current_profile_owner_user_id,
  e.detail->'before' AS recorded_before,
  e.detail->'after' AS recorded_after
FROM events e
LEFT JOIN profiles p ON p.id::text = e.detail->>'profileId'
WHERE e.detail->>'scope' IS DISTINCT FROM 'profile_contact'
  AND (e.detail->'after' ? 'email' OR e.detail->'after' ? 'mobile')
ORDER BY e.created_at, e.id;
