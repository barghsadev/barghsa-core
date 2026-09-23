-- Attach the existing timestamp function to mutable tables introduced after
-- 0133. Explicitly list the reviewed tables so unrelated tables stay untouched.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'electricity_orders',
    'electricity_contracts',
    'electricity_customer_drafts',
    'electricity_price_adjustments',
    'saving_plan_agreement_versions',
    'saving_plan_hardware',
    'saving_fulfillment_stages',
    'saving_order_lines',
    'saving_orders',
    'solar_construction_requests',
    'consultation_requests'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;
