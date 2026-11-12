-- Read-only inventory for an authorized operator. The result contains access metadata.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path TO pg_catalog;
SET LOCAL TIME ZONE 'UTC';

WITH staff_assignments AS (
  SELECT u.user_id, u.is_staff, u.is_admin, u.disabled_at,
         grant_row.role_id, role_definition.name AS role_name, grant_row.created_at AS assigned_at
  FROM public.users u
  LEFT JOIN public.user_roles grant_row ON grant_row.user_id = u.user_id
  LEFT JOIN public.staff_roles role_definition ON role_definition.role_id = grant_row.role_id
  WHERE u.is_staff OR u.is_admin OR grant_row.role_id IS NOT NULL
), notification_configs AS (
  SELECT 'email' AS family, id, transport, status, config, created_at, updated_at, delivery_verified_at
  FROM public.email_provider_configs
  UNION ALL
  SELECT 'sms', id, transport, status, config, created_at, updated_at, delivery_verified_at
  FROM public.sms_provider_configs
), credentials AS (
  SELECT n.family, n.id::text AS config_id, n.transport, n.status, field.name AS credential_kind,
         n.created_at AS config_created_at, n.updated_at AS config_updated_at,
         CASE WHEN field.name <> 'webhook_secret' THEN n.delivery_verified_at END AS last_verified_at
  FROM notification_configs n
  CROSS JOIN LATERAL (VALUES
    ('password', n.transport = 'smtp'),
    ('api_key', n.transport IN ('resend', 'smsir')),
    ('webhook_secret', n.transport = 'resend')
  ) AS field(name, expected)
  WHERE field.expected AND jsonb_typeof(n.config->field.name) = 'string'
    AND n.config->>field.name <> ''
  UNION ALL
  SELECT 'ai', id::text, provider_type,
         CASE WHEN is_enabled AND last_test_status = 'passed' THEN 'enabled'
              WHEN is_enabled THEN 'awaiting_test' ELSE 'disabled' END,
         'api_token', created_at, updated_at,
         CASE WHEN last_test_status = 'passed' THEN last_tested_at END
  FROM public.ai_models
  WHERE api_token <> ''
  UNION ALL
  SELECT 'storage', key, 's3', 'active', 'secret_access_key',
         NULL::timestamptz, updated_at, NULL::timestamptz
  FROM public.app_config
  WHERE key = 'storage.active' AND jsonb_typeof(value->'encryptedSecret') = 'string'
    AND value->>'encryptedSecret' <> ''
  UNION ALL
  SELECT 'verification', key, 'verification',
         CASE WHEN value->'enabled' = 'true'::jsonb THEN 'enabled' ELSE 'disabled' END,
         'settings_bundle', NULL::timestamptz, updated_at, NULL::timestamptz
  FROM public.app_config
  WHERE starts_with(key, 'verification_provider_') AND (
    (jsonb_typeof(value->'settingsCiphertext') = 'string' AND value->>'settingsCiphertext' <> '')
    OR (jsonb_typeof(value->'settings') = 'object' AND value->'settings' <> '{}'::jsonb)
  )
), database_logins AS (
  SELECT r.rolname AS role_name, r.rolsuper AS superuser, r.rolcreaterole AS can_create_role,
         r.rolcreatedb AS can_create_database, r.rolreplication AS replication,
         r.rolbypassrls AS bypasses_row_security, r.rolvaliduntil AS password_expires_at,
         ARRAY(
           SELECT DISTINCT parent.rolname
           FROM pg_auth_members membership
           JOIN pg_roles parent ON parent.oid = membership.roleid
           WHERE membership.member = r.oid
           ORDER BY parent.rolname
         ) AS direct_member_of
  FROM pg_roles r
  WHERE r.rolcanlogin
)
SELECT jsonb_build_object(
  'schema_version', 1,
  'database', current_database(),
  'captured_at', transaction_timestamp(),
  'read_only', current_setting('transaction_read_only') = 'on',
  'staff_assignments', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.user_id, s.role_id) FROM staff_assignments s
  ), '[]'::jsonb),
  'credential_metadata', COALESCE((
    SELECT jsonb_agg(
      to_jsonb(c) || jsonb_build_object('masked_value', '********', 'issued_at', NULL, 'last_used_at', NULL)
      ORDER BY c.family, c.config_id, c.credential_kind
    ) FROM credentials c
  ), '[]'::jsonb),
  'database_logins', COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.role_name) FROM database_logins r
  ), '[]'::jsonb)
) AS report;

COMMIT;
