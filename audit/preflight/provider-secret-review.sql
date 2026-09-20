-- Read-only inventory. Reports row/field identities, never credential values.
-- Run against the intended database before a controlled credential migration.
WITH providers AS (
  SELECT 'email' AS channel, id, transport, config FROM email_provider_configs
  UNION ALL
  SELECT 'sms', id, transport, config FROM sms_provider_configs
)
SELECT p.channel, p.id, p.transport, secret.key AS field
FROM providers p
CROSS JOIN LATERAL jsonb_each(p.config) secret
WHERE ((p.transport = 'smtp' AND secret.key = 'password')
    OR (p.transport = 'resend' AND secret.key IN ('api_key', 'webhook_secret'))
    OR (p.transport = 'smsir' AND secret.key = 'api_key'))
  AND jsonb_typeof(secret.value) = 'string'
  AND length(secret.value #>> '{}') > 0
  AND secret.value #>> '{}' NOT LIKE 'v1:%'
ORDER BY p.channel, p.id, secret.key;
