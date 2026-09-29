-- Keep configured English names and add the current support details to live and draft settings.
-- The defaults are stored in brand_config so public reads do not depend on translations.
UPDATE brand_config
SET config = config || jsonb_build_object(
  'appTitleFa', COALESCE(config->>'appTitleFa', 'برقسا'),
  'supportEmail', COALESCE(config->>'supportEmail', 'info@barghsa.com'),
  'supportPhone', COALESCE(config->>'supportPhone', '021-26658042'),
  'supportMobile', COALESCE(config->>'supportMobile', '09002550292')
)
WHERE status IN ('active', 'draft');

-- Fresh installs and older installs without a published revision need a DB-backed default.
INSERT INTO brand_config (config, version, status, created_by)
SELECT jsonb_build_object(
  'appTitle', 'Barghsa',
  'appTitleFa', 'برقسا',
  'supportEmail', 'info@barghsa.com',
  'supportPhone', '021-26658042',
  'supportMobile', '09002550292',
  'slogan', '',
  'primaryColor', '#176b5b',
  'secondaryColor', '#547467',
  'accentColor', '#d6a74e',
  'backgroundColor', '#f6f7f4',
  'darkBackgroundColor', '#15201c',
  'fontFamily', 'vazirmatn',
  'borderRadiusRem', 0.75,
  'spacingScale', 1,
  'logoUrl', NULL::text,
  'faviconUrl', NULL::text,
  'darkMode', false,
  'numberStyle', 'locale'
), COALESCE((SELECT MAX(version) FROM brand_config), 0) + 1, 'active', 'system'
WHERE NOT EXISTS (SELECT 1 FROM brand_config WHERE status = 'active');
