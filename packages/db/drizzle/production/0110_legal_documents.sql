ALTER TABLE legal_profiles ADD COLUMN documents JSONB NOT NULL DEFAULT '[]'::jsonb;
