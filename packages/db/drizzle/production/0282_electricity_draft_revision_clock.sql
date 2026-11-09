-- Add the standard timestamp trigger without rewriting draft revisions.
CREATE TRIGGER modify_updated_at
BEFORE UPDATE ON public.electricity_customer_draft_revisions
FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
