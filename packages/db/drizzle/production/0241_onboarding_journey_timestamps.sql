-- Expand: stamp raw journey updates and preserve explicit writer timestamps.
-- Leave existing setup records and published migration checksums unchanged.
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.profile_onboarding_journeys
FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
