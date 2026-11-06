-- Forward repair for installs where 0216 published a default above an older draft.
-- Preserve every config, version, creator and creation time. Only obsolete draft
-- status changes, using the existing updated_at trigger and migration ledger.
-- Newer drafts remain editable and the active publication does not change.
LOCK TABLE brand_config IN SHARE ROW EXCLUSIVE MODE;
UPDATE brand_config AS draft
SET status = 'superseded'
WHERE draft.status = 'draft'
  AND EXISTS (
    SELECT 1 FROM brand_config AS active
    WHERE active.status = 'active' AND active.version > draft.version
  );
-- Rollback: retain the superseded history. Re-activating an obsolete draft would
-- recreate the invalid state; any later publication uses a new reviewed version.
