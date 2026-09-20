-- Expand: stamp raw SQL updates that do not supply a new timestamp.
-- Preserve explicit writer timestamps used for audit snapshots and imports.
-- Existing domain-specific timestamp triggers remain unchanged.
CREATE FUNCTION public.modify_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Attach only to the reviewed application tables; future tables must opt in
-- through their own migration. This does not scan or change historical rows.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'addresses',
    'ai_model_test_jobs',
    'app_config',
    'approval_requests',
    'background_jobs',
    'config_version',
    'contract_template_versions',
    'contract_type_templates',
    'device_trusts',
    'gift_code_profiles',
    'gift_code_redemptions',
    'invoices',
    'legal_profiles',
    'notification_dead_letter',
    'notification_send_receipts',
    'otp_challenges',
    'profile_agents',
    'profile_invitations',
    'profile_onboarding_drafts',
    'profile_ownership_transfers',
    'profiles',
    'rate_limit_counters',
    'reconciliation_exceptions',
    'security_rate_limit_counters',
    'service_breach_alerts',
    'sessions',
    'staff_assignment_cursors',
    'staff_roles',
    'staff_team_members',
    'staff_teams',
    'storage_records',
    'ticket_comments',
    'tickets',
    'user_profile_contexts',
    'users',
    'verification_cases',
    'wallets'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;
