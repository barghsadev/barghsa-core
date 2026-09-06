DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_breach_alerts'::regclass AND conname='uq_sba_item') THEN
  ALTER TABLE service_breach_alerts ADD CONSTRAINT uq_sba_item UNIQUE (service_type, item_id);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_breach_alerts'::regclass AND conname='chk_sba_service_type') THEN
  ALTER TABLE service_breach_alerts ADD CONSTRAINT chk_sba_service_type CHECK (service_type IN ('ticket', 'verification_case'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_breach_alerts'::regclass AND conname='chk_sba_target_hours') THEN
  ALTER TABLE service_breach_alerts ADD CONSTRAINT chk_sba_target_hours CHECK (target_hours > 0);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_breach_alerts'::regclass AND conname='chk_sba_escalation_level') THEN
  ALTER TABLE service_breach_alerts ADD CONSTRAINT chk_sba_escalation_level CHECK (escalation_level BETWEEN 1 AND 3);
 END IF;
END $$;
