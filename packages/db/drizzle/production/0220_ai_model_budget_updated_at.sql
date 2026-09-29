CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.ai_model_budgets
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
