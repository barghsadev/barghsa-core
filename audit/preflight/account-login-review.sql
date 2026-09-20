-- Read-only preflight before migration 0111. Run with authorized production access.
-- Duplicate normalized usernames block the migration; do not pick an owner automatically.
SELECT lower(username) AS normalized_username, array_agg(user_id ORDER BY user_id) AS account_ids
FROM users GROUP BY lower(username) HAVING count(*) > 1;

-- Historical secondary values are not proof of ownership and are not imported as login aliases.
SELECT user_id, email, mobile
FROM users
WHERE (email IS NOT NULL AND lower(email) <> lower(username))
   OR (mobile IS NOT NULL AND mobile <> username)
ORDER BY user_id;
