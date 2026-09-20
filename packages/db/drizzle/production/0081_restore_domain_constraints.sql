-- Retained behavior from 0005_create_audit_log.sql

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  event TEXT NOT NULL,
  metadata TEXT,
  correlation_id TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
--> statement-breakpoint
-- Retained behavior from 0006_create_orders.sql

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  order_type TEXT NOT NULL CHECK (order_type IN ('electricity', 'savings', 'solar')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED')),
  snapshot_province_id TEXT NOT NULL,
  snapshot_city_id TEXT NOT NULL,
  snapshot_full_address TEXT NOT NULL,
  snapshot_postal_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_profile_id ON orders(profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
-- Retained behavior from 0007_create_tos_versions.sql

CREATE TABLE IF NOT EXISTS tos_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  version_id TEXT NOT NULL UNIQUE,
  content_fa TEXT NOT NULL,
  content_en TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tos_versions_is_active ON tos_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_tos_versions_version_id ON tos_versions(version_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tos_versions_updated_at ON tos_versions;
CREATE TRIGGER trg_tos_versions_updated_at
  BEFORE UPDATE ON tos_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
-- Retained behavior from 0008_create_tos_acceptances.sql

CREATE TABLE IF NOT EXISTS tos_acceptances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES tos_versions(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_tos_acceptances_user_id ON tos_acceptances(user_id);
--> statement-breakpoint
-- Retained behavior from 0010_create_tickets.sql

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    related_entity_type TEXT CHECK (related_entity_type IN ('order', 'contract', 'invoice')),
    related_entity_id TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_profile_id ON tickets (profile_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets (priority);
--> statement-breakpoint
-- Retained behavior from 0011_create_ticket_comments.sql

CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_author_id ON ticket_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_visibility ON ticket_comments (visibility);
--> statement-breakpoint
-- Retained behavior from 0015_create_product_price_versions.sql

CREATE TABLE IF NOT EXISTS product_price_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price BIGINT NOT NULL,
  vat_category_override UUID,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_price_versions'::regclass AND conname = 'chk_product_price_versions_price_non_negative') THEN
ALTER TABLE product_price_versions
  ADD CONSTRAINT chk_product_price_versions_price_non_negative
  CHECK (price >= 0);
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_price_versions'::regclass AND conname = 'chk_product_price_versions_effective_range') THEN
ALTER TABLE product_price_versions
  ADD CONSTRAINT chk_product_price_versions_effective_range
  CHECK (effective_until IS NULL OR effective_from < effective_until);
  END IF;
END $baseline$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_price_versions'::regclass AND conname = 'excl_product_price_versions_no_overlap') THEN
ALTER TABLE product_price_versions
  ADD CONSTRAINT excl_product_price_versions_no_overlap
  EXCLUDE USING GIST (
    product_id WITH =,
    tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
  );
  END IF;
END $baseline$;

CREATE INDEX IF NOT EXISTS idx_product_price_versions_product_id
  ON product_price_versions (product_id);
CREATE INDEX IF NOT EXISTS idx_product_price_versions_effective_from
  ON product_price_versions (effective_from);
CREATE INDEX IF NOT EXISTS idx_product_price_versions_effective_until
  ON product_price_versions (effective_until);

CREATE OR REPLACE FUNCTION update_product_price_versions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_price_versions_updated_at ON product_price_versions;
CREATE TRIGGER trg_product_price_versions_updated_at
  BEFORE UPDATE ON product_price_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_product_price_versions_updated_at();

--> statement-breakpoint
-- Retained behavior from 0016_create_notifications.sql

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'verification_status',
    'profile_verified',
    'profile_unverified',
    'profile_pending',
    'general'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type notification_type NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read)
  WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);

CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications;
CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notifications_updated_at();

--> statement-breakpoint
-- Retained behavior from 0017_create_product_categories.sql

DO $$ BEGIN
  CREATE TYPE product_category AS ENUM (
    'electricity_generation_station_consultation',
    'electricity_saving_certificate_consultation',
    'thermal_electricity',
    'green_electricity',
    'free_market_electricity',
    'energy_saving_electricity'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  category product_category NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_categories_product_id
  ON product_categories (product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category
  ON product_categories (category);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_unique_product_category
  ON product_categories (product_id, category);

CREATE OR REPLACE FUNCTION update_product_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_categories_updated_at ON product_categories;
CREATE TRIGGER trg_product_categories_updated_at
  BEFORE UPDATE ON product_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_product_categories_updated_at();

--> statement-breakpoint
-- Retained behavior from 0018_create_electricity_product_limits.sql

CREATE TABLE IF NOT EXISTS electricity_product_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  min_kwh BIGINT NOT NULL DEFAULT 0,
  max_kwh BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'electricity_product_limits'::regclass AND conname = 'chk_electricity_product_limits_range') THEN
ALTER TABLE electricity_product_limits
  ADD CONSTRAINT chk_electricity_product_limits_range
  CHECK (max_kwh = 0 OR min_kwh <= max_kwh);
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'electricity_product_limits'::regclass AND conname = 'chk_electricity_product_limits_at_least_one') THEN
ALTER TABLE electricity_product_limits
  ADD CONSTRAINT chk_electricity_product_limits_at_least_one
  CHECK (min_kwh > 0 OR max_kwh > 0);
  END IF;
END $baseline$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_electricity_product_limits_product_id
  ON electricity_product_limits (product_id);

CREATE INDEX IF NOT EXISTS idx_electricity_product_limits_min_kwh
  ON electricity_product_limits (min_kwh);
CREATE INDEX IF NOT EXISTS idx_electricity_product_limits_max_kwh
  ON electricity_product_limits (max_kwh);

CREATE OR REPLACE FUNCTION update_electricity_product_limits_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_electricity_product_limits_updated_at ON electricity_product_limits;
CREATE TRIGGER trg_electricity_product_limits_updated_at
  BEFORE UPDATE ON electricity_product_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_electricity_product_limits_updated_at();

--> statement-breakpoint
-- Retained behavior from 0020_create_brand_config.sql

DO $$ BEGIN
  CREATE TYPE brand_config_status AS ENUM ('draft', 'active');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS brand_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER NOT NULL DEFAULT 1,
  status      brand_config_status NOT NULL DEFAULT 'draft',
  created_by  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_config_active
  ON brand_config (status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_brand_config_version
  ON brand_config (version DESC);

CREATE OR REPLACE FUNCTION update_brand_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brand_config_updated_at ON brand_config;
DROP TRIGGER IF EXISTS trg_brand_config_updated_at ON brand_config;
CREATE TRIGGER trg_brand_config_updated_at
  BEFORE UPDATE ON brand_config
  FOR EACH ROW
  EXECUTE FUNCTION update_brand_config_updated_at();

INSERT INTO brand_config (config, version, status, created_by)
SELECT
  '{
    "appTitle": "Barghsa",
    "slogan": "",
    "primaryColor": "#2563eb",
    "secondaryColor": "#64748b",
    "accentColor": "#f59e0b",
    "logoUrl": null,
    "faviconUrl": null,
    "darkMode": false
  }'::jsonb,
  1,
  'draft',
  'system'
WHERE NOT EXISTS (SELECT 1 FROM brand_config);
--> statement-breakpoint
-- Retained behavior from 0021_add_province_status.sql

DO $$ BEGIN
  CREATE TYPE province_status AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE provinces
  ADD COLUMN IF NOT EXISTS status province_status NOT NULL DEFAULT 'active';

ALTER TABLE provinces
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_provinces_status ON provinces (status);

CREATE OR REPLACE FUNCTION update_provinces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_provinces_updated_at ON provinces;
DROP TRIGGER IF EXISTS trg_provinces_updated_at ON provinces;
CREATE TRIGGER trg_provinces_updated_at
  BEFORE UPDATE ON provinces
  FOR EACH ROW
  EXECUTE FUNCTION update_provinces_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uq_provinces_name_en ON provinces (name_en);
--> statement-breakpoint
-- Retained behavior from 0022_add_city_status.sql

DO $$ BEGIN
  CREATE TYPE city_status AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS status city_status NOT NULL DEFAULT 'active';

ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_province_name_en ON cities (province_id, name_en);

CREATE INDEX IF NOT EXISTS idx_cities_status ON cities (status);

CREATE OR REPLACE FUNCTION update_cities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cities_updated_at ON cities;
DROP TRIGGER IF EXISTS trg_cities_updated_at ON cities;
CREATE TRIGGER trg_cities_updated_at
  BEFORE UPDATE ON cities
  FOR EACH ROW
  EXECUTE FUNCTION update_cities_updated_at();
--> statement-breakpoint
-- Retained behavior from 0023_extend_tos_versions.sql

ALTER TABLE tos_versions
  ADD COLUMN IF NOT EXISTS change_type text NOT NULL DEFAULT 'minor';

ALTER TABLE tos_versions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

ALTER TABLE tos_versions
  ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE tos_versions
  ALTER COLUMN published_at DROP NOT NULL;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tos_versions'::regclass AND conname = 'chk_tos_change_type') THEN
ALTER TABLE tos_versions
  ADD CONSTRAINT chk_tos_change_type CHECK (change_type IN ('major', 'minor'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tos_versions'::regclass AND conname = 'chk_tos_status') THEN
ALTER TABLE tos_versions
  ADD CONSTRAINT chk_tos_status CHECK (status IN ('draft', 'published'));
  END IF;
END $baseline$;

CREATE OR REPLACE FUNCTION check_tos_active_on_published()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true AND NEW.status != 'published' THEN
    RAISE EXCEPTION 'Only published versions can be set as active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tos_active_on_published ON tos_versions;
DROP TRIGGER IF EXISTS trg_tos_active_on_published ON tos_versions;
CREATE TRIGGER trg_tos_active_on_published
  BEFORE INSERT OR UPDATE ON tos_versions
  FOR EACH ROW
  EXECUTE FUNCTION check_tos_active_on_published();

CREATE INDEX IF NOT EXISTS idx_tos_versions_status ON tos_versions (status);
CREATE INDEX IF NOT EXISTS idx_tos_versions_created_by ON tos_versions (created_by);
--> statement-breakpoint
-- Retained behavior from 0024_create_notification_templates.sql

CREATE TABLE IF NOT EXISTS notification_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_key     TEXT NOT NULL,
  channel       TEXT NOT NULL,
  locale        TEXT NOT NULL,
  subject       TEXT,
  body_template TEXT NOT NULL,
  variables     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'draft',
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  version       INTEGER NOT NULL DEFAULT 1,
  published_at  TIMESTAMPTZ,
  created_by    TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_active
  ON notification_templates (event_key, channel, locale)
  WHERE is_active = true;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification_templates'::regclass AND conname = 'chk_nt_channel') THEN
ALTER TABLE notification_templates
  ADD CONSTRAINT chk_nt_channel CHECK (channel IN ('email', 'sms', 'in_app'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification_templates'::regclass AND conname = 'chk_nt_locale') THEN
ALTER TABLE notification_templates
  ADD CONSTRAINT chk_nt_locale CHECK (locale IN ('fa', 'en'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification_templates'::regclass AND conname = 'chk_nt_status') THEN
ALTER TABLE notification_templates
  ADD CONSTRAINT chk_nt_status CHECK (status IN ('draft', 'active', 'archived'));
  END IF;
END $baseline$;

CREATE INDEX IF NOT EXISTS idx_nt_event_channel_locale
  ON notification_templates (event_key, channel, locale);
CREATE INDEX IF NOT EXISTS idx_nt_status ON notification_templates (status);
CREATE INDEX IF NOT EXISTS idx_nt_created_by ON notification_templates (created_by);

CREATE OR REPLACE FUNCTION update_notification_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nt_updated_at ON notification_templates;
DROP TRIGGER IF EXISTS trg_nt_updated_at ON notification_templates;
CREATE TRIGGER trg_nt_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_templates_updated_at();

--> statement-breakpoint
-- Retained behavior from 0025_create_notification_outbox.sql

CREATE TABLE IF NOT EXISTS notification_outbox (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_id          TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  event_key        TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  channels         TEXT[] NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  idempotency_key  TEXT NOT NULL,
  locked_until     TIMESTAMPTZ,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  last_error       TEXT,
  provider_ref     TEXT,
  scheduled_for    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ob_status CHECK (status IN ('queued', 'scheduled', 'sending', 'delivered', 'failed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_outbox_idempotency
  ON notification_outbox (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ob_dispatch
  ON notification_outbox (status, locked_until)
  WHERE status IN ('queued', 'scheduled', 'sending');
CREATE INDEX IF NOT EXISTS idx_ob_profile ON notification_outbox (profile_id);
CREATE INDEX IF NOT EXISTS idx_ob_created ON notification_outbox (created_at DESC);

CREATE TABLE IF NOT EXISTS notification_job (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  outbox_id    UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  priority     TEXT NOT NULL DEFAULT 'normal',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after    TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_job_channel CHECK (channel IN ('in_app', 'email', 'sms')),
  CONSTRAINT chk_job_status CHECK (status IN ('queued', 'running', 'retrying', 'done', 'failed', 'dead_letter')),
  CONSTRAINT chk_job_priority CHECK (priority IN ('urgent', 'normal'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_job_outbox_channel
  ON notification_job (outbox_id, channel);

CREATE INDEX IF NOT EXISTS idx_nj_dispatch
  ON notification_job (priority, created_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_nj_status_run
  ON notification_job (status, run_after)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_nj_outbox ON notification_job (outbox_id);

CREATE OR REPLACE FUNCTION update_notification_outbox_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ob_updated_at ON notification_outbox;
DROP TRIGGER IF EXISTS trg_ob_updated_at ON notification_outbox;
CREATE TRIGGER trg_ob_updated_at
  BEFORE UPDATE ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION update_notification_outbox_updated_at();

CREATE OR REPLACE FUNCTION update_notification_job_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_nj_updated_at ON notification_job;
DROP TRIGGER IF EXISTS trg_nj_updated_at ON notification_job;
CREATE TRIGGER trg_nj_updated_at
  BEFORE UPDATE ON notification_job
  FOR EACH ROW EXECUTE FUNCTION update_notification_job_updated_at();
--> statement-breakpoint
-- Retained behavior from 0026_create_notification_delivery_log.sql

CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  notification_id UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempt_number  INTEGER NOT NULL,
  provider_ref    TEXT,
  latency_ms      INTEGER,
  error_category  TEXT,
  error_detail    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ndl_channel CHECK (channel IN ('in_app', 'email', 'sms')),
  CONSTRAINT chk_ndl_status CHECK (status IN ('delivered', 'failed')),
  CONSTRAINT chk_ndl_error_category CHECK (error_category IN ('transient', 'permanent', 'provider'))
);

CREATE INDEX IF NOT EXISTS idx_ndl_notification
  ON notification_delivery_log (notification_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ndl_channel_status
  ON notification_delivery_log (channel, status);

CREATE INDEX IF NOT EXISTS idx_ndl_created
  ON notification_delivery_log (created_at DESC);

--> statement-breakpoint
-- Retained behavior from 0027_create_notification_dead_letter.sql

CREATE TABLE IF NOT EXISTS notification_dead_letter (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  outbox_id       UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL UNIQUE REFERENCES notification_job(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  event_key       TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'error',
  profile_id      UUID,
  user_id         TEXT,
  cause           TEXT,
  error_category  TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ndl_channel CHECK (channel IN ('in_app', 'email', 'sms')),
  CONSTRAINT chk_ndl_severity CHECK (severity IN ('error', 'critical')),
  CONSTRAINT chk_ndl_error_category CHECK (error_category IN ('transient', 'permanent', 'provider')),
  CONSTRAINT chk_ndl_status CHECK (status IN ('open', 'retried', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_ndl_status_created
  ON notification_dead_letter (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ndl_severity
  ON notification_dead_letter (severity);

CREATE INDEX IF NOT EXISTS idx_ndl_outbox
  ON notification_dead_letter (outbox_id);

--> statement-breakpoint
-- Retained behavior from 0028_create_in_app_notifications.sql

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  title_i18n_key TEXT NOT NULL,
  body_i18n_key  TEXT NOT NULL,
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,
  link_route     TEXT,
  link_params    JSONB,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ian_profile_created
  ON in_app_notifications (profile_id, created_at DESC);

--> statement-breakpoint
-- Retained behavior from 0030_create_notification_preferences.sql

DO $$ BEGIN
  CREATE TYPE notification_category AS ENUM (
    'mandatory_transactional',
    'marketing'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_categories (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category     notification_category NOT NULL,
  is_marketing BOOLEAN NOT NULL DEFAULT FALSE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_categories_category
  ON notification_categories (category);

INSERT INTO notification_categories (category, is_marketing, description) VALUES
  ('mandatory_transactional', FALSE, 'Transactional/security notifications always delivered; never consent-gated.'),
  ('marketing', TRUE, 'Promotional notifications gated behind explicit opt-in consent.')
ON CONFLICT (category) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  marketing_opted_in  BOOLEAN NOT NULL DEFAULT FALSE,
  consent_granted_at  TIMESTAMPTZ,
  consent_revoked_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_notification_preferences'::regclass AND conname = 'chk_unp_channel') THEN
ALTER TABLE user_notification_preferences
  ADD CONSTRAINT chk_unp_channel
  CHECK (channel IN ('email', 'sms', 'in_app'));
  END IF;
END $baseline$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notification_preferences_profile_channel
  ON user_notification_preferences (profile_id, channel);

CREATE INDEX IF NOT EXISTS idx_unp_channel
  ON user_notification_preferences (channel);

CREATE INDEX IF NOT EXISTS idx_unp_marketing_opted_in
  ON user_notification_preferences (marketing_opted_in);

CREATE OR REPLACE FUNCTION update_notification_categories_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nc_updated_at ON notification_categories;
DROP TRIGGER IF EXISTS trg_nc_updated_at ON notification_categories;
CREATE TRIGGER trg_nc_updated_at
  BEFORE UPDATE ON notification_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_categories_updated_at();

CREATE OR REPLACE FUNCTION update_user_notification_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unp_updated_at ON user_notification_preferences;
DROP TRIGGER IF EXISTS trg_unp_updated_at ON user_notification_preferences;
CREATE TRIGGER trg_unp_updated_at
  BEFORE UPDATE ON user_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_notification_preferences_updated_at();

--> statement-breakpoint
-- Retained behavior from 0031_create_email_provider_configs.sql

CREATE TABLE IF NOT EXISTS email_provider_configs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  transport        TEXT NOT NULL,
  label            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  config           JSONB NOT NULL,
  created_by       TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  activated_at     TIMESTAMPTZ,
  last_test_at     TIMESTAMPTZ,
  last_test_status TEXT NOT NULL DEFAULT 'pending',
  last_test_error  TEXT,
  supersedes_id    UUID REFERENCES email_provider_configs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'email_provider_configs'::regclass AND conname = 'chk_epc_transport') THEN
ALTER TABLE email_provider_configs
  ADD CONSTRAINT chk_epc_transport
  CHECK (transport IN ('smtp', 'resend'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'email_provider_configs'::regclass AND conname = 'chk_epc_status') THEN
ALTER TABLE email_provider_configs
  ADD CONSTRAINT chk_epc_status
  CHECK (status IN ('draft', 'active', 'superseded', 'disabled'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'email_provider_configs'::regclass AND conname = 'chk_epc_last_test_status') THEN
ALTER TABLE email_provider_configs
  ADD CONSTRAINT chk_epc_last_test_status
  CHECK (last_test_status IN ('pending', 'passed', 'failed'));
  END IF;
END $baseline$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_provider_active
  ON email_provider_configs (status)
  WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS idx_epc_supersedes_id
  ON email_provider_configs (supersedes_id);

CREATE INDEX IF NOT EXISTS idx_epc_created_at
  ON email_provider_configs (created_at DESC);

CREATE OR REPLACE FUNCTION update_email_provider_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_epc_updated_at ON email_provider_configs;
DROP TRIGGER IF EXISTS trg_epc_updated_at ON email_provider_configs;
CREATE TRIGGER trg_epc_updated_at
  BEFORE UPDATE ON email_provider_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_email_provider_configs_updated_at();
--> statement-breakpoint
-- Retained behavior from 0034_create_email_suppressions_webhook_events.sql

CREATE TABLE IF NOT EXISTS email_webhook_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_token   TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  message_id    TEXT,
  to_address    TEXT,
  from_address  TEXT,
  outbox_id     UUID REFERENCES notification_outbox(id) ON DELETE SET NULL,
  status        TEXT CHECK (status IN ('delivered','failed','opened','clicked','complained')),
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_webhook_event_token ON email_webhook_events (event_token);
CREATE INDEX IF NOT EXISTS idx_ewe_message ON email_webhook_events (message_id);
CREATE INDEX IF NOT EXISTS idx_ewe_address ON email_webhook_events (to_address);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  address          TEXT NOT NULL,
  reason           TEXT NOT NULL CHECK (reason IN ('hard_bounce','complaint')),
  profile_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  source_event_id  UUID REFERENCES email_webhook_events(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppression ON email_suppressions (address, reason);
CREATE INDEX IF NOT EXISTS idx_email_suppression_address ON email_suppressions (address);
--> statement-breakpoint
-- Retained behavior from 0035_create_sms_provider_configs.sql

CREATE TABLE IF NOT EXISTS sms_provider_configs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  transport        TEXT NOT NULL DEFAULT 'smsir',
  label            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  config           JSONB NOT NULL,
  created_by       TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  activated_at     TIMESTAMPTZ,
  activated_by     TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  last_test_at     TIMESTAMPTZ,
  last_test_status TEXT NOT NULL DEFAULT 'pending',
  last_test_error  TEXT,
  supersedes_id    UUID REFERENCES sms_provider_configs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sms_provider_configs'::regclass AND conname = 'chk_spc_transport') THEN
ALTER TABLE sms_provider_configs
  ADD CONSTRAINT chk_spc_transport
  CHECK (transport IN ('smsir'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sms_provider_configs'::regclass AND conname = 'chk_spc_status') THEN
ALTER TABLE sms_provider_configs
  ADD CONSTRAINT chk_spc_status
  CHECK (status IN ('draft', 'active', 'superseded', 'disabled'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sms_provider_configs'::regclass AND conname = 'chk_spc_last_test_status') THEN
ALTER TABLE sms_provider_configs
  ADD CONSTRAINT chk_spc_last_test_status
  CHECK (last_test_status IN ('pending', 'passed', 'failed'));
  END IF;
END $baseline$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_provider_active
  ON sms_provider_configs (status)
  WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS idx_spc_supersedes_id
  ON sms_provider_configs (supersedes_id);

CREATE INDEX IF NOT EXISTS idx_spc_created_at
  ON sms_provider_configs (created_at DESC);

CREATE OR REPLACE FUNCTION update_sms_provider_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spc_updated_at ON sms_provider_configs;
DROP TRIGGER IF EXISTS trg_spc_updated_at ON sms_provider_configs;
CREATE TRIGGER trg_spc_updated_at
  BEFORE UPDATE ON sms_provider_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_sms_provider_configs_updated_at();

--> statement-breakpoint
-- Retained behavior from 0036_create_approval_requests.sql

CREATE TABLE IF NOT EXISTS approval_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  action_type   TEXT NOT NULL,
  amount_irr    BIGINT NOT NULL,
  initiator_id  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reason        TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  reviewer_id   TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  review_reason TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ar_action_type
    CHECK (action_type IN ('refund', 'manual_adjustment', 'bank_payment_confirmation')),

  CONSTRAINT chk_ar_amount_positive
    CHECK (amount_irr > 0),

  CONSTRAINT chk_ar_status
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status_created_at
  ON approval_requests (status, created_at DESC);
--> statement-breakpoint
-- Retained behavior from 0037_create_service_breach_alerts.sql

CREATE TABLE IF NOT EXISTS service_breach_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_type TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  target_hours INTEGER NOT NULL,
  alerted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_sba_service_type
    CHECK (service_type IN ('ticket', 'verification_case')),

  CONSTRAINT chk_sba_target_hours
    CHECK (target_hours > 0),

  CONSTRAINT uq_sba_item
    UNIQUE (service_type, item_id)
);
--> statement-breakpoint
-- Retained behavior from 0038_create_staff_teams.sql

CREATE TABLE IF NOT EXISTS staff_teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  name        TEXT NOT NULL,
  description TEXT,
  skill_tags  JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_st_name_length
    CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT uq_st_name
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS staff_team_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  team_id    UUID NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_stm_team
    FOREIGN KEY (team_id) REFERENCES staff_teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_stm_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,

  CONSTRAINT uq_stm_team_member
    UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stm_user ON staff_team_members (user_id);

--> statement-breakpoint
-- Retained behavior from 0040_create_reconciliation_exceptions.sql

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  exception_type TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'medium',
  status         TEXT NOT NULL DEFAULT 'open',
  description    TEXT NOT NULL,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_to_id UUID,
  resolved_by_id UUID,
  resolution_note TEXT,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_rex_type
    CHECK (exception_type IN ('wallet_mismatch', 'payment_mismatch')),
  CONSTRAINT chk_rex_severity
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_rex_status
    CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),

  CONSTRAINT fk_rex_assigned_to
    FOREIGN KEY (assigned_to_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_rex_resolved_by
    FOREIGN KEY (resolved_by_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_status_created_at
  ON reconciliation_exceptions (status, created_at DESC);
--> statement-breakpoint
-- Retained behavior from 0041_create_background_jobs.sql

CREATE TABLE IF NOT EXISTS background_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_type        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'failed',
  error           TEXT,
  error_category  TEXT NOT NULL DEFAULT 'transient',
  attempts        INTEGER NOT NULL DEFAULT 1,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_run_at     TIMESTAMPTZ,
  resolved_by_id  TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_bj_status
    CHECK (status IN ('failed', 'retrying', 'dead_letter', 'resolved')),
  CONSTRAINT chk_bj_error_category
    CHECK (error_category IN ('transient', 'permanent', 'provider')),
  CONSTRAINT chk_bj_attempts_ge_1
    CHECK (attempts >= 1),
  CONSTRAINT chk_bj_max_attempts_ge_1
    CHECK (max_attempts >= 1),

  CONSTRAINT fk_bj_resolved_by
    FOREIGN KEY (resolved_by_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_status_first_failed_at
  ON background_jobs (status, first_failed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_active_per_type
  ON background_jobs (job_type)
  WHERE status IN ('failed', 'retrying', 'dead_letter');

--> statement-breakpoint
-- Retained behavior from 0042_create_ai_models.sql

CREATE TABLE IF NOT EXISTS ai_models (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title            TEXT NOT NULL,
  provider_type    TEXT NOT NULL,
  base_url         TEXT NOT NULL,
  model_name       TEXT NOT NULL,
  api_token        TEXT,
  created_by       TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  last_tested_at   TIMESTAMPTZ,
  last_test_status TEXT NOT NULL DEFAULT 'pending',
  last_test_error  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_models'::regclass AND conname = 'chk_aim_provider_type') THEN
ALTER TABLE ai_models
  ADD CONSTRAINT chk_aim_provider_type
  CHECK (provider_type IN ('openai_compatible', 'anthropic'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_models'::regclass AND conname = 'chk_aim_last_test_status') THEN
ALTER TABLE ai_models
  ADD CONSTRAINT chk_aim_last_test_status
  CHECK (last_test_status IN ('pending', 'passed', 'failed'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_models'::regclass AND conname = 'chk_aim_non_empty_fields') THEN
ALTER TABLE ai_models
  ADD CONSTRAINT chk_aim_non_empty_fields
  CHECK (title <> '' AND base_url <> '' AND model_name <> '');
  END IF;
END $baseline$;

CREATE INDEX IF NOT EXISTS idx_aim_created_at
  ON ai_models (created_at DESC);

CREATE OR REPLACE FUNCTION update_ai_models_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aim_updated_at ON ai_models;
DROP TRIGGER IF EXISTS trg_aim_updated_at ON ai_models;
CREATE TRIGGER trg_aim_updated_at
  BEFORE UPDATE ON ai_models
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_models_updated_at();

--> statement-breakpoint
-- Retained behavior from 0043_create_knowledge_bases.sql

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  kb_id             UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  storage_key       TEXT NOT NULL REFERENCES storage_records(storage_key) ON DELETE RESTRICT,
  file_name         TEXT NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  processing_error  TEXT,
  created_by        TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_group_members (
  group_id   UUID NOT NULL REFERENCES kb_groups(id) ON DELETE CASCADE,
  kb_id      UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, kb_id)
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'knowledge_bases'::regclass AND conname = 'chk_kb_title') THEN
ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_kb_title
  CHECK (title <> '');
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'kb_groups'::regclass AND conname = 'chk_kbg_title') THEN
ALTER TABLE kb_groups
  ADD CONSTRAINT chk_kbg_title
  CHECK (title <> '');
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'kb_documents'::regclass AND conname = 'chk_kbd_processing_status') THEN
ALTER TABLE kb_documents
  ADD CONSTRAINT chk_kbd_processing_status
  CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'kb_documents'::regclass AND conname = 'uq_kbd_kb_storage') THEN
ALTER TABLE kb_documents
  ADD CONSTRAINT uq_kbd_kb_storage
  UNIQUE (kb_id, storage_key);
  END IF;
END $baseline$;

CREATE INDEX IF NOT EXISTS idx_kb_created_at
  ON knowledge_bases (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kbd_kb_id
  ON kb_documents (kb_id);

CREATE INDEX IF NOT EXISTS idx_kbd_processing_status
  ON kb_documents (processing_status)
  WHERE processing_status IN ('pending', 'processing', 'failed');

CREATE INDEX IF NOT EXISTS idx_kbg_created_at
  ON kb_groups (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kbgm_kb_id
  ON kb_group_members (kb_id);

CREATE OR REPLACE FUNCTION update_knowledge_bases_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_updated_at ON knowledge_bases;
DROP TRIGGER IF EXISTS trg_kb_updated_at ON knowledge_bases;
CREATE TRIGGER trg_kb_updated_at
  BEFORE UPDATE ON knowledge_bases
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_bases_updated_at();

DROP TRIGGER IF EXISTS trg_kbd_updated_at ON kb_documents;
DROP TRIGGER IF EXISTS trg_kbd_updated_at ON kb_documents;
CREATE TRIGGER trg_kbd_updated_at
  BEFORE UPDATE ON kb_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_bases_updated_at();

DROP TRIGGER IF EXISTS trg_kbg_updated_at ON kb_groups;
DROP TRIGGER IF EXISTS trg_kbg_updated_at ON kb_groups;
CREATE TRIGGER trg_kbg_updated_at
  BEFORE UPDATE ON kb_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_bases_updated_at();
--> statement-breakpoint
-- Retained behavior from 0044_create_ai_policies.sql

CREATE TABLE IF NOT EXISTS ai_policies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  policy_type TEXT NOT NULL,
  rules       JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_policy_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_policy_group_members (
  group_id   UUID NOT NULL REFERENCES ai_policy_groups(id) ON DELETE CASCADE,
  policy_id  UUID NOT NULL REFERENCES ai_policies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, policy_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aip_title') THEN
    ALTER TABLE ai_policies
      ADD CONSTRAINT chk_aip_title
      CHECK (title <> '');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aipg_title') THEN
    ALTER TABLE ai_policy_groups
      ADD CONSTRAINT chk_aipg_title
      CHECK (title <> '');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aip_type') THEN
    ALTER TABLE ai_policies
      ADD CONSTRAINT chk_aip_type
      CHECK (policy_type IN ('allowed_topics', 'disallowed_actions', 'data_access_scope', 'response_style'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aip_created_at
  ON ai_policies (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aip_type
  ON ai_policies (policy_type);

CREATE INDEX IF NOT EXISTS idx_aipg_created_at
  ON ai_policy_groups (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aipgm_policy_id
  ON ai_policy_group_members (policy_id);

CREATE OR REPLACE FUNCTION update_ai_policies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aip_updated_at ON ai_policies;
DROP TRIGGER IF EXISTS trg_aip_updated_at ON ai_policies;
CREATE TRIGGER trg_aip_updated_at
  BEFORE UPDATE ON ai_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_policies_updated_at();

DROP TRIGGER IF EXISTS trg_aipg_updated_at ON ai_policy_groups;
DROP TRIGGER IF EXISTS trg_aipg_updated_at ON ai_policy_groups;
CREATE TRIGGER trg_aipg_updated_at
  BEFORE UPDATE ON ai_policy_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_policies_updated_at();

--> statement-breakpoint
-- Retained behavior from 0045_create_ai_agents.sql

CREATE TABLE IF NOT EXISTS ai_agents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  model_id    UUID NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_kbs (
  agent_id   UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  kb_id      UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, kb_id)
);

CREATE TABLE IF NOT EXISTS ai_agent_policies (
  agent_id   UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  policy_id  UUID NOT NULL REFERENCES ai_policies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, policy_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aia_title') THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT chk_aia_title
      CHECK (title <> '');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aia_created_at
  ON ai_agents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aia_model_id
  ON ai_agents (model_id);

CREATE INDEX IF NOT EXISTS idx_aiak_agent_id
  ON ai_agent_kbs (agent_id);

CREATE INDEX IF NOT EXISTS idx_aiap_agent_id
  ON ai_agent_policies (agent_id);

CREATE INDEX IF NOT EXISTS idx_aiak_kb_id
  ON ai_agent_kbs (kb_id);

CREATE INDEX IF NOT EXISTS idx_aiap_policy_id
  ON ai_agent_policies (policy_id);

CREATE OR REPLACE FUNCTION update_ai_agents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aia_updated_at ON ai_agents;
DROP TRIGGER IF EXISTS trg_aia_updated_at ON ai_agents;
CREATE TRIGGER trg_aia_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_agents_updated_at();

--> statement-breakpoint
-- Retained behavior from 0046_create_ai_agent_slots.sql

CREATE TABLE IF NOT EXISTS ai_agent_slots (
  slot_key   TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  agent_id   UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_agent_slots (slot_key, label) VALUES
  ('individual_chatbot',   'Individual chatbot'),
  ('legal_entity_chatbot', 'Legal Entity chatbot'),
  ('staff_chatbot',        'Staff chatbot'),
  ('website_chatbot',      'Website chatbot'),
  ('telegram_chatbot',     'Telegram chatbot')
ON CONFLICT (slot_key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aias_label') THEN
    ALTER TABLE ai_agent_slots
      ADD CONSTRAINT chk_aias_label
      CHECK (label <> '');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aias_slot_key') THEN
    ALTER TABLE ai_agent_slots
      ADD CONSTRAINT chk_aias_slot_key
      CHECK (
        slot_key IN (
          'individual_chatbot',
          'legal_entity_chatbot',
          'staff_chatbot',
          'website_chatbot',
          'telegram_chatbot'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aias_agent_id
  ON ai_agent_slots (agent_id);

CREATE OR REPLACE FUNCTION update_ai_agent_slots_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aias_updated_at ON ai_agent_slots;
DROP TRIGGER IF EXISTS trg_aias_updated_at ON ai_agent_slots;
CREATE TRIGGER trg_aias_updated_at
  BEFORE UPDATE ON ai_agent_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_agent_slots_updated_at();

--> statement-breakpoint
-- Retained behavior from 0047_create_vat_configurations.sql

CREATE TABLE IF NOT EXISTS vat_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category TEXT NOT NULL,
  rate INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vat_configurations'::regclass AND conname = 'chk_vat_configurations_rate_range') THEN
ALTER TABLE vat_configurations
  ADD CONSTRAINT chk_vat_configurations_rate_range
  CHECK (rate BETWEEN 0 AND 10000);
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vat_configurations'::regclass AND conname = 'chk_vat_configurations_effective_range') THEN
ALTER TABLE vat_configurations
  ADD CONSTRAINT chk_vat_configurations_effective_range
  CHECK (effective_until IS NULL OR effective_from < effective_until);
  END IF;
END $baseline$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vat_configurations'::regclass AND conname = 'excl_vat_configurations_no_overlap') THEN
ALTER TABLE vat_configurations
  ADD CONSTRAINT excl_vat_configurations_no_overlap
  EXCLUDE USING GIST (
    category WITH =,
    tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
  );
  END IF;
END $baseline$;

CREATE INDEX IF NOT EXISTS idx_vat_configurations_category
  ON vat_configurations (category);
CREATE INDEX IF NOT EXISTS idx_vat_configurations_effective_from
  ON vat_configurations (effective_from);
CREATE INDEX IF NOT EXISTS idx_vat_configurations_effective_until
  ON vat_configurations (effective_until);

CREATE TABLE IF NOT EXISTS product_vat_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  vat_config_id UUID NOT NULL REFERENCES vat_configurations(id) ON DELETE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_vat_overrides'::regclass AND conname = 'chk_product_vat_overrides_effective_range') THEN
ALTER TABLE product_vat_overrides
  ADD CONSTRAINT chk_product_vat_overrides_effective_range
  CHECK (effective_until IS NULL OR effective_from < effective_until);
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_vat_overrides'::regclass AND conname = 'excl_product_vat_overrides_no_overlap') THEN
ALTER TABLE product_vat_overrides
  ADD CONSTRAINT excl_product_vat_overrides_no_overlap
  EXCLUDE USING GIST (
    product_id WITH =,
    tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
  );
  END IF;
END $baseline$;

CREATE INDEX IF NOT EXISTS idx_product_vat_overrides_product_id
  ON product_vat_overrides (product_id);
CREATE INDEX IF NOT EXISTS idx_product_vat_overrides_vat_config_id
  ON product_vat_overrides (vat_config_id);

CREATE OR REPLACE FUNCTION update_vat_configurations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vat_configurations_updated_at ON vat_configurations;
CREATE TRIGGER trg_vat_configurations_updated_at
  BEFORE UPDATE ON vat_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_vat_configurations_updated_at();

CREATE OR REPLACE FUNCTION update_product_vat_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_vat_overrides_updated_at ON product_vat_overrides;
CREATE TRIGGER trg_product_vat_overrides_updated_at
  BEFORE UPDATE ON product_vat_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_product_vat_overrides_updated_at();

--> statement-breakpoint
-- Retained behavior from 0048_create_gift_codes.sql

CREATE TABLE IF NOT EXISTS gift_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value BIGINT NOT NULL,
  max_cap_irr BIGINT,
  eligibility TEXT NOT NULL DEFAULT 'public',
  total_limit INTEGER,
  per_profile_limit INTEGER,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  min_order_amount BIGINT NOT NULL DEFAULT 0,
  categories TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_discount_type') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_discount_type
  CHECK (discount_type IN ('fixed_irr', 'percentage'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_eligibility') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_eligibility
  CHECK (eligibility IN ('public', 'profile'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_status') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_status
  CHECK (status IN ('active', 'inactive'));
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_discount_value') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_discount_value
  CHECK (
    discount_value > 0
    AND (
      (discount_type = 'fixed_irr' AND max_cap_irr IS NULL)
      OR
      (discount_type = 'percentage'
       AND discount_value <= 10000
       AND max_cap_irr IS NOT NULL
       AND max_cap_irr > 0)
    )
  );
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_window') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_window
  CHECK (valid_until IS NULL OR valid_from < valid_until);
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_limits') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_limits
  CHECK (
    (total_limit IS NULL OR total_limit > 0)
    AND (per_profile_limit IS NULL OR per_profile_limit > 0)
  );
  END IF;
END $baseline$;

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_codes'::regclass AND conname = 'chk_gift_codes_min_order') THEN
ALTER TABLE gift_codes
  ADD CONSTRAINT chk_gift_codes_min_order
  CHECK (min_order_amount >= 0);
  END IF;
END $baseline$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_code
  ON gift_codes (code);
CREATE INDEX IF NOT EXISTS idx_gift_codes_status
  ON gift_codes (status);
CREATE INDEX IF NOT EXISTS idx_gift_codes_valid_from
  ON gift_codes (valid_from);
CREATE INDEX IF NOT EXISTS idx_gift_codes_valid_until
  ON gift_codes (valid_until);

CREATE TABLE IF NOT EXISTS gift_code_profiles (
  gift_code_id UUID NOT NULL REFERENCES gift_codes(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (gift_code_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_code_profiles_profile_id
  ON gift_code_profiles (profile_id);

CREATE TABLE IF NOT EXISTS gift_code_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  gift_code_id UUID NOT NULL REFERENCES gift_codes(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  discount_amount BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'consumed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $baseline$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'gift_code_redemptions'::regclass AND conname = 'chk_gift_code_redemptions_status') THEN
ALTER TABLE gift_code_redemptions
  ADD CONSTRAINT chk_gift_code_redemptions_status
  CHECK (status IN ('consumed', 'released'));
  END IF;
END $baseline$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_code_redemptions_order_id
  ON gift_code_redemptions (order_id);
CREATE INDEX IF NOT EXISTS idx_gift_code_redemptions_code_status
  ON gift_code_redemptions (gift_code_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_code_redemptions_code_profile_status
  ON gift_code_redemptions (gift_code_id, profile_id, status);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gift_code_id UUID;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gift_discount_amount BIGINT;

CREATE INDEX IF NOT EXISTS idx_orders_gift_code_id
  ON orders (gift_code_id);

CREATE OR REPLACE FUNCTION update_gift_codes_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gift_codes_updated_at ON gift_codes;
CREATE TRIGGER trg_gift_codes_updated_at
  BEFORE UPDATE ON gift_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_gift_codes_updated_at();

--> statement-breakpoint
-- Retained behavior from 0049_create_contract_templates.sql

CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT chk_contract_templates_status CHECK (status IN ('active', 'inactive')),
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_contract_templates_name CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_templates_name_lower
  ON contract_templates (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_contract_templates_status
  ON contract_templates (status);

CREATE TABLE IF NOT EXISTS contract_template_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL
    CONSTRAINT chk_contract_template_versions_version_number CHECK (version_number > 0),
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  file_size BIGINT,
  placeholders TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_template_versions_storage_key
  ON contract_template_versions (storage_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_template_versions_template_ver
  ON contract_template_versions (template_id, version_number);
CREATE INDEX IF NOT EXISTS idx_contract_template_versions_template
  ON contract_template_versions (template_id);

CREATE TABLE IF NOT EXISTS contract_type_templates (
  contract_type_id UUID NOT NULL,
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  PRIMARY KEY (contract_type_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_type_templates_template_id
  ON contract_type_templates (template_id);

CREATE OR REPLACE FUNCTION update_contract_templates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_templates_updated_at ON contract_templates;

DROP TRIGGER IF EXISTS trg_contract_templates_updated_at ON contract_templates;
CREATE TRIGGER trg_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_templates_updated_at();

--> statement-breakpoint
-- Retained behavior from 0050_create_upload_policies.sql

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS upload_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category TEXT NOT NULL
    CONSTRAINT chk_upload_policies_category CHECK (category IN ('document', 'image', 'video')),
  allowed_extensions TEXT[] NOT NULL
    CONSTRAINT chk_upload_policies_extensions
      CHECK (
        array_length(allowed_extensions, 1) BETWEEN 1 AND 50
        AND NOT EXISTS (
          SELECT 1 FROM unnest(allowed_extensions) AS e
          WHERE e !~ '^\.[a-z0-9]{1,10}$'
        )
      ),
  max_size_bytes BIGINT NOT NULL
    CONSTRAINT chk_upload_policies_max_size CHECK (max_size_bytes BETWEEN 1 AND 104857600),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ
    CONSTRAINT chk_upload_policies_effective_range
      CHECK (effective_until IS NULL OR effective_from < effective_until),
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT excl_upload_policies_no_overlap
    EXCLUDE USING GIST (
      category WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_upload_policies_category
  ON upload_policies (category);
CREATE INDEX IF NOT EXISTS idx_upload_policies_effective_from
  ON upload_policies (effective_from);
CREATE INDEX IF NOT EXISTS idx_upload_policies_effective_until
  ON upload_policies (effective_until);

CREATE OR REPLACE FUNCTION update_upload_policies_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upload_policies_updated_at ON upload_policies;

DROP TRIGGER IF EXISTS trg_upload_policies_updated_at ON upload_policies;
CREATE TRIGGER trg_upload_policies_updated_at
  BEFORE UPDATE ON upload_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_upload_policies_updated_at();
--> statement-breakpoint
-- Retained behavior from 0052_add_invoice_amount_check_constraints.sql

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  contract_id TEXT,
  state invoice_state NOT NULL DEFAULT 'Draft',
  total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
  paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  issued_at TIMESTAMPTZ,
  payable_from TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_paid_not_exceeds_total CHECK (paid_amount <= total_amount),
  CONSTRAINT ck_refund_not_exceeds_paid CHECK (refunded_amount <= paid_amount)
);

DO $$
BEGIN
  IF to_regclass('invoices') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_paid_not_exceeds_total' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_paid_not_exceeds_total
        CHECK (paid_amount <= total_amount);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_refund_not_exceeds_paid' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_refund_not_exceeds_paid
        CHECK (refunded_amount <= paid_amount);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_invoices_total_amount_nonneg' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_invoices_total_amount_nonneg
        CHECK (total_amount >= 0);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_invoices_paid_amount_nonneg' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_invoices_paid_amount_nonneg
        CHECK (paid_amount >= 0);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ck_invoices_refunded_amount_nonneg' AND conrelid = 'invoices'::regclass
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT ck_invoices_refunded_amount_nonneg
        CHECK (refunded_amount >= 0);
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_profile_id ON invoices (profile_id);
CREATE INDEX IF NOT EXISTS idx_invoices_state ON invoices (state);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at ON invoices (due_at);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices (order_id);

--> statement-breakpoint
-- Retained behavior from 0054_create_invoice_lines_and_items.sql

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price BIGINT NOT NULL,
  line_total BIGINT NOT NULL,
  vat_rate INTEGER NOT NULL DEFAULT 0,
  vat_amount BIGINT NOT NULL DEFAULT 0,
  is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_invoice_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT ck_invoice_lines_unit_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT ck_invoice_lines_line_total_non_negative CHECK (line_total >= 0),
  CONSTRAINT ck_invoice_lines_vat_rate_range CHECK (vat_rate BETWEEN 0 AND 10000),
  CONSTRAINT ck_invoice_lines_vat_amount_non_negative CHECK (vat_amount >= 0),
  CONSTRAINT ck_invoice_lines_non_taxable_zero_vat CHECK (is_taxable OR vat_amount = 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines (invoice_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_title JSONB,
  quantity INTEGER NOT NULL,
  unit_price BIGINT NOT NULL,
  vat_rate INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_invoice_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT ck_invoice_items_unit_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT ck_invoice_items_vat_rate_range CHECK (vat_rate BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items (product_id);

CREATE OR REPLACE FUNCTION update_invoice_lines_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_updated_at ON invoice_lines;
DROP TRIGGER IF EXISTS trg_invoice_lines_updated_at ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_updated_at
  BEFORE UPDATE ON invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_lines_updated_at();

CREATE OR REPLACE FUNCTION update_invoice_items_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_updated_at ON invoice_items;
DROP TRIGGER IF EXISTS trg_invoice_items_updated_at ON invoice_items;
CREATE TRIGGER trg_invoice_items_updated_at
  BEFORE UPDATE ON invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_items_updated_at();
--> statement-breakpoint
-- Retained behavior from 0059_create_service_due_periods.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    CREATE EXTENSION btree_gist;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS service_due_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_type TEXT NOT NULL
    CONSTRAINT chk_service_due_periods_service_type
      CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual')),
  default_days INTEGER NOT NULL
    CONSTRAINT chk_service_due_periods_default_days
      CHECK (default_days BETWEEN 1 AND 365),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ
    CONSTRAINT chk_service_due_periods_effective_range
      CHECK (effective_until IS NULL OR effective_from < effective_until),
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT excl_service_due_periods_no_overlap
    EXCLUDE USING GIST (
      service_type WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_service_due_periods_service_type
  ON service_due_periods (service_type);
CREATE INDEX IF NOT EXISTS idx_service_due_periods_effective_from
  ON service_due_periods (effective_from);
CREATE INDEX IF NOT EXISTS idx_service_due_periods_effective_until
  ON service_due_periods (effective_until);

CREATE OR REPLACE FUNCTION update_service_due_periods_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_due_periods_updated_at ON service_due_periods;

DROP TRIGGER IF EXISTS trg_service_due_periods_updated_at ON service_due_periods;
CREATE TRIGGER trg_service_due_periods_updated_at
  BEFORE UPDATE ON service_due_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_service_due_periods_updated_at();

--> statement-breakpoint
-- Retained behavior from 0060_create_invoice_reminder_schedule.sql

CREATE TABLE IF NOT EXISTS invoice_reminder_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  "offset" INTEGER NOT NULL
    CONSTRAINT chk_invoice_reminder_schedule_offset
      CHECK ("offset" IN (-7, -3, -1, 0, 1, 7)),
  channel TEXT NOT NULL
    CONSTRAINT chk_invoice_reminder_schedule_channel
      CHECK (channel IN ('in_app', 'email', 'sms')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CONSTRAINT chk_invoice_reminder_schedule_status
      CHECK (status IN ('scheduled', 'sent', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_invoice_reminder_schedule_sent_at
    CHECK (
      (status = 'sent' AND sent_at IS NOT NULL)
      OR (status <> 'sent' AND sent_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_invoice_id
  ON invoice_reminder_schedule (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_due
  ON invoice_reminder_schedule (scheduled_at)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION update_invoice_reminder_schedule_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_reminder_schedule_updated_at
  ON invoice_reminder_schedule;

DROP TRIGGER IF EXISTS trg_invoice_reminder_schedule_updated_at ON invoice_reminder_schedule;
CREATE TRIGGER trg_invoice_reminder_schedule_updated_at
  BEFORE UPDATE ON invoice_reminder_schedule
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_reminder_schedule_updated_at();

--> statement-breakpoint
-- Retained behavior from 0062_create_invoice_reminder_offset_toggles.sql

CREATE TABLE IF NOT EXISTS invoice_reminder_offset_toggles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_type TEXT NOT NULL
    CONSTRAINT chk_invoice_reminder_offset_toggles_service_type
      CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual')),
  "offset" INTEGER NOT NULL
    CONSTRAINT chk_invoice_reminder_offset_toggles_offset
      CHECK ("offset" IN (-7, -3, -1, 0, 1, 7)),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoice_reminder_offset_toggles_type_offset
    UNIQUE (service_type, "offset")
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminder_offset_toggles_service_type
  ON invoice_reminder_offset_toggles (service_type);

CREATE OR REPLACE FUNCTION update_invoice_reminder_offset_toggles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_reminder_offset_toggles_updated_at
  ON invoice_reminder_offset_toggles;

DROP TRIGGER IF EXISTS trg_invoice_reminder_offset_toggles_updated_at ON invoice_reminder_offset_toggles;
CREATE TRIGGER trg_invoice_reminder_offset_toggles_updated_at
  BEFORE UPDATE ON invoice_reminder_offset_toggles
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_reminder_offset_toggles_updated_at();

--> statement-breakpoint
-- Retained behavior from 0063_cancel_reminders_on_invoice_stop_state.sql

CREATE OR REPLACE FUNCTION cancel_future_invoice_reminders(p_invoice_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cancelled_count INTEGER;
BEGIN
  UPDATE invoice_reminder_schedule
     SET status = 'cancelled'
   WHERE invoice_id = p_invoice_id
     AND status = 'scheduled';
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  RETURN cancelled_count;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_cancel_invoice_reminders_on_stop_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM cancel_future_invoice_reminders(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_invoice_reminders_on_stop_state ON invoices;

DROP TRIGGER IF EXISTS trg_cancel_invoice_reminders_on_stop_state ON invoices;
CREATE TRIGGER trg_cancel_invoice_reminders_on_stop_state
  AFTER UPDATE OF state ON invoices
  FOR EACH ROW
  WHEN (
    NEW.state = ANY (ARRAY['Paid', 'Cancelled', 'Refunded']::invoice_state[])
    AND OLD.state IS DISTINCT FROM NEW.state
  )
  EXECUTE FUNCTION trg_fn_cancel_invoice_reminders_on_stop_state();

UPDATE invoice_reminder_schedule AS s
   SET status = 'cancelled'
  FROM invoices AS i
 WHERE s.invoice_id = i.id
   AND s.status = 'scheduled'
   AND i.state = ANY (ARRAY['Paid', 'Cancelled', 'Refunded']::invoice_state[]);

--> statement-breakpoint
-- Retained behavior from 0067_invoice_adjustment_kind_accounting_amount.sql

DO $$
BEGIN
  IF to_regclass('invoices') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'adjustment_kind'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN adjustment_kind TEXT
      CONSTRAINT ck_invoices_adjustment_kind
        CHECK (adjustment_kind IS NULL OR adjustment_kind IN ('charge', 'credit'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'accounting_amount'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN accounting_amount BIGINT
      GENERATED ALWAYS AS (
        CASE WHEN adjustment_kind = 'credit' THEN -total_amount ELSE total_amount END
      ) STORED;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'adjustment_for_invoice_id'
  ) THEN
    UPDATE invoices
       SET adjustment_kind = CASE
             WHEN metadata->>'kind' IN ('charge', 'credit') THEN metadata->>'kind'
             ELSE 'charge'
           END
     WHERE adjustment_for_invoice_id IS NOT NULL
       AND adjustment_kind IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'invoices'
       AND column_name = 'adjustment_for_invoice_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_invoices_adjustment_kind_matches_link'
       AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT ck_invoices_adjustment_kind_matches_link
      CHECK (
        (adjustment_for_invoice_id IS NULL) = (adjustment_kind IS NULL)
        AND (
          adjustment_kind IS NULL
          OR adjustment_kind IN ('charge', 'credit')
        )
      ) NOT VALID;
  END IF;
END $$;

--> statement-breakpoint
-- Retained behavior from 0068_create_wallet_transactions.sql

CREATE TABLE IF NOT EXISTS wallets (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  posted_balance BIGINT NOT NULL DEFAULT 0,
  reserved_balance BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  wallet_id UUID NOT NULL REFERENCES wallets(profile_id) ON DELETE RESTRICT,
  type TEXT NOT NULL
    CONSTRAINT chk_wallet_transactions_type
      CHECK (type IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating')),
  amount BIGINT NOT NULL
    CONSTRAINT chk_wallet_transactions_amount_nonzero
      CHECK (amount <> 0),
  state TEXT NOT NULL DEFAULT 'Pending'
    CONSTRAINT chk_wallet_transactions_state
      CHECK (state IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed')),
  idempotency_key TEXT NOT NULL,
  ref_id TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_state ON wallet_transactions (state);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions (type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency ON wallet_transactions (idempotency_key);

CREATE OR REPLACE FUNCTION update_wallet_transactions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON wallet_transactions;

DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_updated_at
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_transactions_updated_at();

--> statement-breakpoint
-- Retained behavior from 0069_wallet_available_balance_check.sql

CREATE TABLE IF NOT EXISTS wallets (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  posted_balance BIGINT NOT NULL DEFAULT 0,
  reserved_balance BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_wallets_available_balance_nonneg
    CHECK ((posted_balance - reserved_balance) >= 0)
);

DO $$
BEGIN
  IF to_regclass('wallets') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_wallets_available_balance_nonneg'
        AND conrelid = 'wallets'::regclass
    ) THEN
      ALTER TABLE wallets
        ADD CONSTRAINT chk_wallets_available_balance_nonneg
        CHECK ((posted_balance - reserved_balance) >= 0);
    END IF;
  END IF;
END $$;

--> statement-breakpoint
-- Retained behavior from 0070_create_wallet_topup_callback_events.sql

CREATE TABLE IF NOT EXISTS wallet_topup_callback_events (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_id                 TEXT NOT NULL,
  pending_transaction_id   UUID NOT NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  wallet_id                UUID NOT NULL REFERENCES wallets(profile_id) ON DELETE RESTRICT,
  status                   TEXT NOT NULL
    CONSTRAINT chk_wallet_topup_callback_events_status
      CHECK (status IN ('credited', 'unpaid', 'duplicate')),
  raw                      JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_callback_event_id
  ON wallet_topup_callback_events (event_id);
CREATE INDEX IF NOT EXISTS idx_wtce_pending_tx
  ON wallet_topup_callback_events (pending_transaction_id);
CREATE INDEX IF NOT EXISTS idx_wtce_wallet
  ON wallet_topup_callback_events (wallet_id);

--> statement-breakpoint
-- Retained behavior from 0073_create_idempotency_keys.sql

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  idempotency_key TEXT NOT NULL
    CONSTRAINT chk_idempotency_keys_key_nonblank
      CHECK (char_length(btrim(idempotency_key)) > 0),
  entity_type TEXT NOT NULL
    CONSTRAINT chk_idempotency_keys_entity_type_nonblank
      CHECK (char_length(btrim(entity_type)) > 0),
  entity_id TEXT,
  response JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_key_entity_type
  ON idempotency_keys (idempotency_key, entity_type);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION update_idempotency_keys_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_idempotency_keys_updated_at ON idempotency_keys;

DROP TRIGGER IF EXISTS trg_idempotency_keys_updated_at ON idempotency_keys;
CREATE TRIGGER trg_idempotency_keys_updated_at
  BEFORE UPDATE ON idempotency_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_idempotency_keys_updated_at();

--> statement-breakpoint
-- Retained behavior from 0075_create_wallet_chargeback_events.sql

DO $$
BEGIN
  IF to_regclass('wallets') IS NULL OR to_regclass('wallet_transactions') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS wallet_chargeback_events (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    event_id                   TEXT NOT NULL,
    original_transaction_id    UUID REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
    reversal_transaction_id    UUID REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
    wallet_id                  UUID REFERENCES wallets(profile_id) ON DELETE RESTRICT,
    status                     TEXT NOT NULL
      CONSTRAINT chk_wallet_chargeback_events_status
        CHECK (status IN ('processing', 'reversed', 'unmatched', 'unresolved', 'duplicate')),
    match_method               TEXT
      CONSTRAINT chk_wallet_chargeback_events_match_method
        CHECK (match_method IS NULL OR match_method IN ('merchant_order_id', 'provider_ref_id', 'authority')),
    raw                        JSONB,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_chargeback_event_id
    ON wallet_chargeback_events (event_id);
  CREATE INDEX IF NOT EXISTS idx_wce_original_tx
    ON wallet_chargeback_events (original_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_wce_wallet
    ON wallet_chargeback_events (wallet_id);
  CREATE INDEX IF NOT EXISTS idx_wce_status
    ON wallet_chargeback_events (status);
END $$;

--> statement-breakpoint
-- Retained behavior from 0078_create_bank_receipts.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_invoices_id_profile_id'
      AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT uq_invoices_id_profile_id UNIQUE (id, profile_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bank_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL
    CONSTRAINT chk_bank_receipts_amount_positive
      CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payer_reference TEXT NOT NULL
    CONSTRAINT chk_bank_receipts_payer_reference_nonblank
      CHECK (length(trim(payer_reference)) > 0),
  attachment_key TEXT NOT NULL
    CONSTRAINT chk_bank_receipts_attachment_key_nonblank
      CHECK (length(trim(attachment_key)) > 0),
  customer_note TEXT,
  state TEXT NOT NULL DEFAULT 'Submitted'
    CONSTRAINT chk_bank_receipts_state
      CHECK (state IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_bank_receipts_state_fields CHECK (
    (
      state = 'Confirmed'
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND rejection_reason IS NULL
    )
    OR (
      state = 'Rejected'
      AND rejection_reason IS NOT NULL
      AND length(trim(rejection_reason)) > 0
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
    )
    OR (
      state IN ('Submitted', 'UnderReview')
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
      AND rejection_reason IS NULL
    )
  ),
  CONSTRAINT fk_bank_receipts_invoice_profile
    FOREIGN KEY (invoice_id, profile_id)
    REFERENCES invoices(id, profile_id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_receipts_confirmed_by
    FOREIGN KEY (confirmed_by) REFERENCES users(user_id) ON DELETE RESTRICT
);

DO $$
BEGIN
  IF to_regclass('bank_receipts') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_bank_receipts_invoice_profile'
         AND conrelid = 'bank_receipts'::regclass
     ) THEN
    ALTER TABLE bank_receipts
      ADD CONSTRAINT fk_bank_receipts_invoice_profile
      FOREIGN KEY (invoice_id, profile_id)
      REFERENCES invoices(id, profile_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_receipts_invoice_id ON bank_receipts (invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_receipts_profile_id ON bank_receipts (profile_id);
CREATE INDEX IF NOT EXISTS idx_bank_receipts_state ON bank_receipts (state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_receipts_attachment_key
  ON bank_receipts (attachment_key);

CREATE OR REPLACE FUNCTION update_bank_receipts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_receipts_updated_at ON bank_receipts;

DROP TRIGGER IF EXISTS trg_bank_receipts_updated_at ON bank_receipts;
CREATE TRIGGER trg_bank_receipts_updated_at
  BEFORE UPDATE ON bank_receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_receipts_updated_at();

--> statement-breakpoint
-- Retained behavior from 0079_create_bank_receipt_attachment_claims.sql

CREATE TABLE IF NOT EXISTS bank_receipt_attachment_claims (
  storage_key TEXT PRIMARY KEY
    CONSTRAINT chk_bank_receipt_attachment_claims_storage_key_nonblank
      CHECK (length(trim(storage_key)) > 0),
  claim_type TEXT NOT NULL
    CONSTRAINT chk_bank_receipt_attachment_claims_type
      CHECK (claim_type IN ('wallet_topup', 'invoice_receipt')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_bank_receipt_attachment_claims_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_receipt_attachment_claims_updated_at
  ON bank_receipt_attachment_claims;

DROP TRIGGER IF EXISTS trg_bank_receipt_attachment_claims_updated_at ON bank_receipt_attachment_claims;
CREATE TRIGGER trg_bank_receipt_attachment_claims_updated_at
  BEFORE UPDATE ON bank_receipt_attachment_claims
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_receipt_attachment_claims_updated_at();

DO $$
DECLARE
  has_wallet_tx boolean;
  has_attachment_col boolean;
  has_bank_receipts boolean;
  collision boolean;
BEGIN
  has_wallet_tx := to_regclass('wallet_transactions') IS NOT NULL;
  has_bank_receipts := to_regclass('bank_receipts') IS NOT NULL;
  has_attachment_col := has_wallet_tx AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'wallet_transactions'
       AND column_name = 'receipt_attachment_key'
  );

  IF has_wallet_tx AND has_bank_receipts AND has_attachment_col THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1
          FROM wallet_transactions w
          JOIN bank_receipts b
            ON b.attachment_key = w.receipt_attachment_key
         WHERE w.receipt_attachment_key IS NOT NULL
      )
    $q$ INTO collision;
    IF collision THEN
      RAISE EXCEPTION
        'bank_receipt_attachment_claims: storage_key already claimed by both wallet_transactions and bank_receipts';
    END IF;
  END IF;

  IF has_attachment_col THEN
    EXECUTE $q$
      INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
      SELECT DISTINCT receipt_attachment_key, 'wallet_topup'
        FROM wallet_transactions
       WHERE receipt_attachment_key IS NOT NULL
         AND length(trim(receipt_attachment_key)) > 0
      ON CONFLICT (storage_key) DO NOTHING
    $q$;
  END IF;

  IF has_bank_receipts THEN
    EXECUTE $q$
      INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
      SELECT DISTINCT attachment_key, 'invoice_receipt'
        FROM bank_receipts
       WHERE length(trim(attachment_key)) > 0
      ON CONFLICT (storage_key) DO NOTHING
    $q$;
  END IF;
END $$;

--> statement-breakpoint
-- Preserve current product protections without recreating products.
CREATE OR REPLACE FUNCTION prevent_system_product_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.type = 'electricity' AND OLD.system_key IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete system-defined electricity product (system_key: %)', OLD.system_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_product_delete ON products;
CREATE TRIGGER trg_prevent_system_product_delete
  BEFORE DELETE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_product_delete();

CREATE OR REPLACE FUNCTION prevent_system_key_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.system_key IS NOT NULL AND NEW.system_key IS DISTINCT FROM OLD.system_key THEN
    RAISE EXCEPTION 'Cannot change system_key of system-defined product (system_key: %)', OLD.system_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_key_change ON products;
CREATE TRIGGER trg_prevent_system_key_change
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_key_change();

CREATE OR REPLACE FUNCTION prevent_extra_system_product_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.type = 'electricity' AND NEW.system_key IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
      FROM products
      WHERE type = 'electricity'
        AND system_key IS NOT NULL;

    IF v_count >= 4 THEN
      RAISE EXCEPTION 'Cannot insert more than 4 system-defined electricity products (existing: %)', v_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_extra_system_product_insert ON products;
CREATE TRIGGER trg_prevent_extra_system_product_insert
  BEFORE INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_extra_system_product_insert();

CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();
-- Replace the superseded invoice uniqueness rule without replaying intermediate
-- index versions that would reject existing adjustment invoices.
DROP INDEX IF EXISTS uq_invoices_order_id_type;
CREATE UNIQUE INDEX uq_invoices_order_id_type ON invoices(order_id, type)
  WHERE replaces_invoice_id IS NULL AND adjustment_for_invoice_id IS NULL;
