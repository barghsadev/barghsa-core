-- Expand the lifecycle before API/MANUAL onboarding can persist pending profiles.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS baseline_profiles_533deeb6;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED', 'SUSPENDED'));
-- Pending submissions reserve an identity just like active profiles.
DROP INDEX IF EXISTS idx_profiles_national_id;
CREATE UNIQUE INDEX idx_profiles_national_id ON profiles (national_id)
  WHERE national_id IS NOT NULL AND status IN ('ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED');
