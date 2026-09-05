-- Foundation behavior from createRateLimitCountersTable

  CREATE TABLE IF NOT EXISTS rate_limit_counters (
    key TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    window_ms INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_counters_pk
    ON rate_limit_counters (key, window_start);

--> statement-breakpoint
-- Foundation behavior from createSecurityRateLimitCountersTable

  CREATE TABLE IF NOT EXISTS security_rate_limit_counters (
    key TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    window_ms INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS security_rate_limit_counters_pk
    ON security_rate_limit_counters (key, window_start);

--> statement-breakpoint
-- Foundation behavior from createAppConfigTable

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

--> statement-breakpoint
-- Foundation behavior from createConfigVersionTable

  CREATE TABLE IF NOT EXISTS config_version (
    id TEXT PRIMARY KEY DEFAULT 'global',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO config_version (id, version)
  VALUES ('global', 1)
  ON CONFLICT (id) DO NOTHING;

--> statement-breakpoint
-- Foundation behavior from createStorageRecordsTable

  CREATE TABLE IF NOT EXISTS storage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    storage_key TEXT NOT NULL UNIQUE,
    file_name TEXT,
    content_type TEXT,
    file_size BIGINT,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'immutable', 'removed')),
    metadata JSONB,
    signed_at TIMESTAMPTZ,
    signed_by TEXT,
    removed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_storage_records_status ON storage_records (status);
  CREATE INDEX IF NOT EXISTS idx_storage_records_category ON storage_records (category);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='storage_records'::regclass AND conname='baseline_storage_records_3337202a') THEN
ALTER TABLE storage_records ADD CONSTRAINT baseline_storage_records_3337202a CHECK (status IN ('active', 'immutable', 'removed'));
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createOtpChallengesTable

  CREATE TABLE IF NOT EXISTS otp_challenges (
    challenge_id TEXT PRIMARY KEY,
    destination TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    attempts_remaining INTEGER NOT NULL DEFAULT 5,
    resend_count INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    tos_version_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_otp_challenges_destination
    ON otp_challenges (destination);

  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'otp_challenges' AND column_name = 'password_hash'
    ) THEN
      ALTER TABLE otp_challenges ADD COLUMN password_hash TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'otp_challenges' AND column_name = 'tos_version_id'
    ) THEN
      ALTER TABLE otp_challenges ADD COLUMN tos_version_id TEXT;
    END IF;
  END $$;

  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'otp_challenges' AND column_name = 'user_id'
    ) THEN
      ALTER TABLE otp_challenges ADD COLUMN user_id TEXT REFERENCES users(user_id);
    END IF;
  END $$;

--> statement-breakpoint
-- Foundation behavior from createUsersTable

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    mobile TEXT,
    password_hash TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'fa',
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    last_accepted_tos_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'email'
    ) THEN
      ALTER TABLE users ADD COLUMN email TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'mobile'
    ) THEN
      ALTER TABLE users ADD COLUMN mobile TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'notification_preferences'
    ) THEN
      ALTER TABLE users ADD COLUMN notification_preferences TEXT NOT NULL DEFAULT 'IN_APP';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'timezone'
    ) THEN
      ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tehran';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'activation_token'
    ) THEN
      ALTER TABLE users ADD COLUMN activation_token TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'activation_token_expires_at'
    ) THEN
      ALTER TABLE users ADD COLUMN activation_token_expires_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'disabled_at'
    ) THEN
      ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'last_login_at'
    ) THEN
      ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
    END IF;
  END $$;

--> statement-breakpoint
-- Foundation behavior from createSessionsTable

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    refresh_token_hash TEXT,
    family_id TEXT,
    device_info JSONB,
    step_up_verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    idle_deadline TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_idle_deadline ON sessions (idle_deadline);
  CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON sessions (family_id);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sessions'::regclass AND conname='baseline_sessions_user_id_fk') THEN
ALTER TABLE sessions ADD CONSTRAINT baseline_sessions_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from migrateSessionsTable

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'refresh_token_hash') THEN
      ALTER TABLE sessions ADD COLUMN refresh_token_hash TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'family_id') THEN
      ALTER TABLE sessions ADD COLUMN family_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'device_info') THEN
      ALTER TABLE sessions ADD COLUMN device_info JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'step_up_verified_at') THEN
      ALTER TABLE sessions ADD COLUMN step_up_verified_at TIMESTAMPTZ;
    END IF;
  END $$;

--> statement-breakpoint
-- Foundation behavior from createPasswordHistoryTable

  CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_password_history_user_version
    ON password_history (user_id, version DESC);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='password_history'::regclass AND conname='baseline_password_history_user_id_fk') THEN
ALTER TABLE password_history ADD CONSTRAINT baseline_password_history_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createProfilesTable

  CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (profile_type IN ('INDIVIDUAL', 'LEGAL')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'VERIFIED', 'SUSPENDED')),
    title TEXT,
    first_name TEXT,
    last_name TEXT,
    national_id TEXT,
    archived BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMPTZ,
    archived_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_default_per_user ON profiles (user_id) WHERE is_default = true;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_national_id ON profiles (national_id) WHERE national_id IS NOT NULL AND status IN ('ACTIVE', 'VERIFIED');
  CREATE INDEX IF NOT EXISTS idx_profiles_archived ON profiles (archived) WHERE archived = true;

  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS national_id TEXT;

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profiles'::regclass AND conname='baseline_profiles_b4095e54') THEN
ALTER TABLE profiles ADD CONSTRAINT baseline_profiles_b4095e54 CHECK (profile_type IN ('INDIVIDUAL', 'LEGAL'));
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profiles'::regclass AND conname='baseline_profiles_533deeb6') THEN
ALTER TABLE profiles ADD CONSTRAINT baseline_profiles_533deeb6 CHECK (status IN ('DRAFT', 'ACTIVE', 'VERIFIED', 'SUSPENDED'));
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profiles'::regclass AND conname='baseline_profiles_user_id_fk') THEN
ALTER TABLE profiles ADD CONSTRAINT baseline_profiles_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createDeviceTrustsTable

  CREATE TABLE IF NOT EXISTS device_trusts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    user_agent_hint TEXT,
    trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_device_trusts_user_id ON device_trusts (user_id);
  CREATE INDEX IF NOT EXISTS idx_device_trusts_fingerprint
    ON device_trusts (user_id, device_fingerprint);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_device_trusts_unique
    ON device_trusts (user_id, device_fingerprint);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='device_trusts'::regclass AND conname='baseline_device_trusts_user_id_fk') THEN
ALTER TABLE device_trusts ADD CONSTRAINT baseline_device_trusts_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createRefreshTokensTable

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens (family_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON refresh_tokens (session_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_consumed_at ON refresh_tokens (consumed_at);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='refresh_tokens'::regclass AND conname='baseline_refresh_tokens_user_id_fk') THEN
ALTER TABLE refresh_tokens ADD CONSTRAINT baseline_refresh_tokens_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='refresh_tokens'::regclass AND conname='baseline_refresh_tokens_session_id_fk') THEN
ALTER TABLE refresh_tokens ADD CONSTRAINT baseline_refresh_tokens_session_id_fk FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createAddressesTable

  CREATE TABLE IF NOT EXISTS addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    province_id UUID NOT NULL REFERENCES provinces(id) ON DELETE RESTRICT,
    city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    full_address TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    main_address BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_addresses_profile_id ON addresses (profile_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_main_per_profile ON addresses (profile_id) WHERE main_address = true;

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='addresses'::regclass AND conname='baseline_addresses_profile_id_fk') THEN
ALTER TABLE addresses ADD CONSTRAINT baseline_addresses_profile_id_fk FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='addresses'::regclass AND conname='addresses_province_id_provinces_id_fk') THEN
ALTER TABLE addresses ADD CONSTRAINT addresses_province_id_provinces_id_fk FOREIGN KEY (province_id) REFERENCES provinces(id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='addresses'::regclass AND conname='addresses_city_id_cities_id_fk') THEN
ALTER TABLE addresses ADD CONSTRAINT addresses_city_id_cities_id_fk FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createVerificationCasesTable

  CREATE TABLE IF NOT EXISTS verification_cases (
    id TEXT PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    field_name TEXT NOT NULL,
    current_value TEXT,
    requested_value TEXT NOT NULL,
    evidence_urls TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Under Review', 'Approved', 'Rejected')),
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    reviewed_by TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_verification_cases_profile_id ON verification_cases (profile_id);
  CREATE INDEX IF NOT EXISTS idx_verification_cases_status ON verification_cases (status);
  CREATE INDEX IF NOT EXISTS idx_verification_cases_created_by ON verification_cases (created_by);
  CREATE INDEX IF NOT EXISTS idx_verification_cases_reviewed_by ON verification_cases (reviewed_by);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='verification_cases'::regclass AND conname='baseline_verification_cases_265614ef') THEN
ALTER TABLE verification_cases ADD CONSTRAINT baseline_verification_cases_265614ef CHECK (status IN ('Open', 'Under Review', 'Approved', 'Rejected'));
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='verification_cases'::regclass AND conname='baseline_verification_cases_profile_id_fk') THEN
ALTER TABLE verification_cases ADD CONSTRAINT baseline_verification_cases_profile_id_fk FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='verification_cases'::regclass AND conname='baseline_verification_cases_created_by_fk') THEN
ALTER TABLE verification_cases ADD CONSTRAINT baseline_verification_cases_created_by_fk FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='verification_cases'::regclass AND conname='baseline_verification_cases_reviewed_by_fk') THEN
ALTER TABLE verification_cases ADD CONSTRAINT baseline_verification_cases_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createLegalProfilesTables

  CREATE TABLE IF NOT EXISTS company_types (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_fa TEXT NOT NULL
  );

  INSERT INTO company_types (id, name_en, name_fa) VALUES
    ('private-joint-stock', 'Private Joint Stock', 'سهامی خاص'),
    ('public-joint-stock', 'Public Joint Stock', 'سهامی عام'),
    ('limited-liability', 'Limited Liability', 'مسئولیت محدود'),
    ('non-profit', 'Non-Profit', 'غیر تجاری'),
    ('cooperative', 'Cooperative', 'تعاونی'),
    ('sole-proprietorship', 'Sole Proprietorship', 'شخص حقیقی')
  ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS legal_profiles (
    id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    legal_name TEXT NOT NULL,
    national_identifier TEXT NOT NULL,
    registration_number TEXT NOT NULL,
    company_type_id TEXT REFERENCES company_types(id) ON DELETE RESTRICT,
    registration_date TEXT,
    economic_code TEXT,
    official_phone TEXT,
    official_email TEXT,
    official_province_id TEXT,
    official_city_id TEXT,
    official_full_address TEXT,
    official_postal_code TEXT,
    representative_title TEXT NOT NULL,
    representative_relationship TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_profiles_national_identifier
    ON legal_profiles (national_identifier)
    WHERE national_identifier IS NOT NULL;

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='legal_profiles'::regclass AND conname='baseline_legal_profiles_id_fk') THEN
ALTER TABLE legal_profiles ADD CONSTRAINT baseline_legal_profiles_id_fk FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='legal_profiles'::regclass AND conname='baseline_legal_profiles_company_type_id_fk') THEN
ALTER TABLE legal_profiles ADD CONSTRAINT baseline_legal_profiles_company_type_id_fk FOREIGN KEY (company_type_id) REFERENCES company_types(id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createProfileAgentsTable

  CREATE TABLE IF NOT EXISTS profile_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_agents_profile_user
    ON profile_agents (profile_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_profile_agents_user
    ON profile_agents (user_id);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_agents'::regclass AND conname='baseline_profile_agents_profile_id_fk') THEN
ALTER TABLE profile_agents ADD CONSTRAINT baseline_profile_agents_profile_id_fk FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createProfileInvitationsTable

  CREATE TABLE IF NOT EXISTS profile_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Withdrawn', 'Declined', 'Expired')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_profile_invitations_profile
    ON profile_invitations (profile_id);

  CREATE INDEX IF NOT EXISTS idx_profile_invitations_status
    ON profile_invitations (status);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_invitations'::regclass AND conname='baseline_profile_invitations_72d6d4e5') THEN
ALTER TABLE profile_invitations ADD CONSTRAINT baseline_profile_invitations_72d6d4e5 CHECK (status IN ('Pending', 'Accepted', 'Withdrawn', 'Declined', 'Expired'));
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_invitations'::regclass AND conname='baseline_profile_invitations_profile_id_fk') THEN
ALTER TABLE profile_invitations ADD CONSTRAINT baseline_profile_invitations_profile_id_fk FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
-- Foundation behavior from createProfileOwnershipTransfersTable

  CREATE TABLE IF NOT EXISTS profile_ownership_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    from_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    to_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Declined', 'Expired', 'Cancelled')),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_pending_profile
    ON profile_ownership_transfers (profile_id) WHERE status = 'Pending';

  CREATE INDEX IF NOT EXISTS idx_ownership_transfers_to_user
    ON profile_ownership_transfers (to_user_id);

  CREATE INDEX IF NOT EXISTS idx_ownership_transfers_status
    ON profile_ownership_transfers (status);

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_ownership_transfers'::regclass AND conname='baseline_profile_ownership_transfers_90fde1bc') THEN
ALTER TABLE profile_ownership_transfers ADD CONSTRAINT baseline_profile_ownership_transfers_90fde1bc CHECK (status IN ('Pending', 'Completed', 'Declined', 'Expired', 'Cancelled'));
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_ownership_transfers'::regclass AND conname='baseline_profile_ownership_transfers_profile_id_fk') THEN
ALTER TABLE profile_ownership_transfers ADD CONSTRAINT baseline_profile_ownership_transfers_profile_id_fk FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_ownership_transfers'::regclass AND conname='baseline_profile_ownership_transfers_from_user_id_fk') THEN
ALTER TABLE profile_ownership_transfers ADD CONSTRAINT baseline_profile_ownership_transfers_from_user_id_fk FOREIGN KEY (from_user_id) REFERENCES users(user_id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='profile_ownership_transfers'::regclass AND conname='baseline_profile_ownership_transfers_to_user_id_fk') THEN
ALTER TABLE profile_ownership_transfers ADD CONSTRAINT baseline_profile_ownership_transfers_to_user_id_fk FOREIGN KEY (to_user_id) REFERENCES users(user_id) ON DELETE RESTRICT;
END IF; END $baseline$;
--> statement-breakpoint

    CREATE TABLE IF NOT EXISTS staff_roles (
      role_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);

    INSERT INTO staff_roles (role_id, name, description, permissions)
    VALUES
      ('role-customer-support', 'Customer Support', 'Handle customer inquiries, complaints, and support tickets.', '["tickets:read","tickets:write","users:read","profiles:read"]'),
    ('role-crm-verification', 'CRM & Verification', 'Manage customer relationships, verification of profiles and addresses.', '["crm:read","crm:write","verification:read","verification:write","profiles:read","profiles:write"]'),
    ('role-finance', 'Finance', 'Manage billing, invoices, payments, and financial reports.', '["finance:read","finance:write","invoices:read","invoices:write","payments:read","payments:write","reports:read"]'),
    ('role-legal-contracts', 'Legal & Contracts', 'Manage legal documents, contracts, and compliance.', '["legal:read","legal:write","contracts:read","contracts:write","compliance:read"]'),
    ('role-operations', 'Operations', 'Manage operational workflows, orders, and service delivery.', '["operations:read","operations:write","orders:read","orders:write","scheduling:read","scheduling:write"]'),
    ('role-admin', 'Admin', 'Full system access with all administrative privileges.', '["admin:users:create","admin:users:edit","admin:roles:edit","admin:config:read","admin:config:write","*"]')
    ON CONFLICT (role_id) DO NOTHING;

--> statement-breakpoint
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='user_roles'::regclass AND conname='user_roles_pkey') THEN
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);
END IF; END $baseline$;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cities_province_id ON cities(province_id);
DO $baseline$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='cities'::regclass AND conname='cities_province_id_provinces_id_fk') THEN
ALTER TABLE cities ADD CONSTRAINT cities_province_id_provinces_id_fk FOREIGN KEY(province_id) REFERENCES provinces(id) ON DELETE RESTRICT;
END IF; END $baseline$;
