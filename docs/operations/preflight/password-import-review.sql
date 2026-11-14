-- Run with authorized read access to the Barghsa-format import snapshot or deployment.
-- Report format counts only. A well-formed prefix and encoding do not prove login compatibility.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH credential_rows AS (
  SELECT 'current' AS source, password_hash FROM public.users
  UNION ALL
  SELECT 'history', password_hash FROM public.password_history
), classified AS (
  SELECT source,
    CASE
      WHEN password_hash IS NULL OR password_hash = '' THEN 'missing'
      WHEN password_hash ~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
        THEN 'argon2id_v19_shape'
      WHEN left(password_hash, 7) = '$argon2' THEN 'other_argon2_or_invalid'
      ELSE 'unrecognized'
    END AS format
  FROM credential_rows
), totals AS (
  SELECT source, format, count(*) AS rows
  FROM classified
  GROUP BY source, format
)
SELECT jsonb_build_object(
  'schema_version', 1,
  'read_only', current_setting('transaction_read_only')::boolean,
  'counts', COALESCE(jsonb_agg(to_jsonb(totals) ORDER BY source, format), '[]'::jsonb)
) AS report
FROM totals;

ROLLBACK;
