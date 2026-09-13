-- Expand: enforce the four supported electricity identities on new writes.
-- Existing noncanonical rows are preserved for explicit operator reconciliation.
CREATE OR REPLACE FUNCTION public.prevent_extra_system_product_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'electricity' AND (
    NEW.system_key IS NULL OR NEW.system_key NOT IN ('thermal','green','free_market','energy_saving')
  ) THEN
    RAISE EXCEPTION 'Electricity products must use one of the four system keys'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.system_key IN ('thermal','green','free_market','energy_saving') AND NEW.type <> 'electricity' THEN
    RAISE EXCEPTION 'System electricity keys are reserved for electricity products' USING ERRCODE = 'P0001';
  END IF;
  -- The existing unique system_key constraint enforces the bound under
  -- concurrency and allows ON CONFLICT DO NOTHING to remain idempotent.
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_system_key_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.system_key IS NOT NULL AND NEW.system_key IS DISTINCT FROM OLD.system_key THEN
    RAISE EXCEPTION 'Cannot change system_key of system-defined product'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.system_key IS NOT NULL AND NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'Cannot change type of system-defined product'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.system_key IN ('thermal','green','free_market','energy_saving') AND NEW.type <> 'electricity' THEN
    RAISE EXCEPTION 'System electricity keys are reserved for electricity products' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.type <> 'electricity' AND NEW.type = 'electricity' THEN
    RAISE EXCEPTION 'Cannot convert another product into a system electricity product'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
-- Zero/zero is the specified default: no lower or upper quantity limit.
ALTER TABLE public.electricity_product_limits
  DROP CONSTRAINT chk_electricity_product_limits_at_least_one;

--> statement-breakpoint
ALTER TABLE public.electricity_product_limits
  ADD CONSTRAINT chk_electricity_product_limits_nonnegative
  CHECK (min_kwh >= 0 AND max_kwh >= 0) NOT VALID;
