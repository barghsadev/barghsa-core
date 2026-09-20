-- Expand only. Existing representative identity is unknown and must not be invented.
ALTER TABLE legal_profiles
  ADD COLUMN representative_honorific TEXT,
  ADD COLUMN representative_first_name TEXT,
  ADD COLUMN representative_last_name TEXT,
  ADD COLUMN representative_national_id TEXT,
  ADD COLUMN representative_province_id UUID REFERENCES provinces(id) ON DELETE RESTRICT,
  ADD COLUMN representative_city_id UUID REFERENCES cities(id) ON DELETE RESTRICT,
  ADD COLUMN representative_full_address TEXT,
  ADD COLUMN representative_postal_code TEXT;
