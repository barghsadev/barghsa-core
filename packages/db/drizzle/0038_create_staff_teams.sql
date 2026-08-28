-- Migration 0038: Staff teams and membership (T-09.08.02)
--
-- Admin-configurable staff teams (name, description, skill tags, active
-- flag) and their membership join table. Auto-assignment rules referencing
-- these teams live in app_config (admin.staff_assignment_rules) and are
-- versioned like the other admin configs; this migration provides the
-- relational backing the assignment engine (future T-09.08.02 slice) and
-- the admin CRUD surface write to.
--
-- Layout:
--   staff_teams
--     id           UUID PK (uuidv7, DB-generated)
--     name         display name, unique — the admin-facing identifier
--     description  free-form note (nullable)
--     skill_tags   JSONB array of skill tags
--     is_active    soft-disable flag (disabled teams are never assigned)
--     created_at / updated_at  base columns (createTable contract)
--   staff_team_members
--     id           UUID PK (uuidv7, DB-generated)
--     team_id      FK -> staff_teams(id) ON DELETE CASCADE
--     user_id      FK -> users(user_id) ON DELETE CASCADE
--     created_at / updated_at  base columns
--     UNIQUE (team_id, user_id)  no duplicate membership, doubles as index
--
-- Notes:
--   - All constraints are defined inline in CREATE TABLE so the migration
--     is safely re-appliable (no separate ALTER TABLE steps that would
--     abort with duplicate-constraint errors on a re-run).
--   - skill_tags is JSONB to match the drizzle schema type; the value is
--     always a JSON array of strings (enforced by the admin API).
--
-- Rollback:
--   DROP TABLE IF EXISTS staff_team_members;
--   DROP TABLE IF EXISTS staff_teams;

CREATE TABLE IF NOT EXISTS staff_teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  name        TEXT NOT NULL,
  description TEXT,
  skill_tags  JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Names are the admin-facing identifier: non-empty, bounded length,
  -- unique.
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

  -- No duplicate membership; also the "members of team" lookup index.
  CONSTRAINT uq_stm_team_member
    UNIQUE (team_id, user_id)
);

-- "Which teams is this user in" / FK cascade lookups from users are
-- sequential without a user_id-leading index (the composite unique index
-- above leads on team_id).
CREATE INDEX IF NOT EXISTS idx_stm_user ON staff_team_members (user_id);
