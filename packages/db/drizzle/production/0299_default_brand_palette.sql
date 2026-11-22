-- Publish a new revision only for the shipped palette. Keep operator-owned
-- branding, newer drafts and the previous system revision in version history.
DO $$
DECLARE
  previous brand_config%ROWTYPE;
BEGIN
  LOCK TABLE brand_config IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO previous FROM brand_config
  WHERE status = 'active'
    AND created_by = 'system'
    AND version = (SELECT max(version) FROM brand_config)
    AND version < 2147483647
    AND NOT EXISTS (SELECT 1 FROM brand_config WHERE status = 'draft')
    AND NOT config ?| ARRAY['darkPrimaryColor', 'darkSecondaryColor', 'darkAccentColor']
    AND config @> jsonb_build_object(
      'primaryColor', '#176b5b',
      'secondaryColor', '#547467',
      'accentColor', '#d6a74e',
      'backgroundColor', '#f6f7f4',
      'darkBackgroundColor', '#15201c'
    );

  IF FOUND THEN
    UPDATE brand_config SET status = 'superseded' WHERE id = previous.id;
    INSERT INTO brand_config (config, version, status, created_by)
    VALUES (
      previous.config || jsonb_build_object(
        'primaryColor', '#204c80',
        'secondaryColor', '#516783',
        'accentColor', '#eeb04d',
        'darkPrimaryColor', '#a2c7ff',
        'darkSecondaryColor', '#abc1dd',
        'darkAccentColor', '#ffc66a',
        'backgroundColor', '#f4f6f9',
        'darkBackgroundColor', '#121c2b'
      ),
      previous.version + 1, 'active', 'system'
    );
  END IF;
END
$$;
-- Roll back the colors through the branding editor as a new revision.
