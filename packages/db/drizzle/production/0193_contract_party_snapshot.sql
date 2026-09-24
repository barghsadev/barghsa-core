ALTER TABLE "contract_acceptances" ADD COLUMN "party_snapshot" jsonb;--> statement-breakpoint
CREATE FUNCTION snapshot_contract_acceptance_party() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT jsonb_build_object(
    'profileId', p.id,
    'profileType', p.profile_type,
    'name', NULLIF(btrim(CASE WHEN p.profile_type='LEGAL'
      THEN coalesce(lp.legal_name, p.title, concat_ws(' ', p.first_name, p.last_name))
      ELSE coalesce(NULLIF(concat_ws(' ', p.first_name, p.last_name), ''), p.title)
    END), ''),
    'identifier', CASE WHEN p.profile_type='LEGAL' THEN lp.national_identifier ELSE p.national_id END,
    'registrationNumber', CASE WHEN p.profile_type='LEGAL' THEN lp.registration_number ELSE NULL END
  ) INTO NEW.party_snapshot
  FROM contracts c JOIN profiles p ON p.id=c.profile_id
  LEFT JOIN legal_profiles lp ON lp.id=p.id
  WHERE c.id=NEW.contract_id;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER contract_acceptances_party_snapshot BEFORE INSERT ON contract_acceptances
 FOR EACH ROW EXECUTE FUNCTION snapshot_contract_acceptance_party();
