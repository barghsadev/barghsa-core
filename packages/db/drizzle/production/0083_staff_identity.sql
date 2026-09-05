-- Staff membership is separate from platform administrator authority.
-- Preserve all existing administrator flags for an explicit account review.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE users u SET is_staff=true
WHERE u.is_admin=true OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id=u.user_id);
