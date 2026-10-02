-- Expand: stamp raw identity updates while preserving explicit writer timestamps.
-- Existing identities and historical migration checksums remain unchanged.
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.conversation_identities
FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
