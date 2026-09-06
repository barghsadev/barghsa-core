CREATE TABLE profile_onboarding_drafts (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CONSTRAINT onboarding_draft_version CHECK(version>0),
  data JSONB NOT NULL CONSTRAINT onboarding_draft_object CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
