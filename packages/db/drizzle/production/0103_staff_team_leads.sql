ALTER TABLE staff_teams ADD COLUMN lead_user_id text REFERENCES users(user_id) ON DELETE SET NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='staff_teams'::regclass AND conname='uq_st_name') THEN
 ALTER TABLE staff_teams ADD CONSTRAINT uq_st_name UNIQUE (name);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='staff_teams'::regclass AND conname='chk_st_name_length') THEN
 ALTER TABLE staff_teams ADD CONSTRAINT chk_st_name_length CHECK (char_length(name) BETWEEN 1 AND 80);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='staff_team_members'::regclass AND conname='uq_stm_team_member') THEN
 ALTER TABLE staff_team_members ADD CONSTRAINT uq_stm_team_member UNIQUE (team_id,user_id);
 END IF;
END $$;
