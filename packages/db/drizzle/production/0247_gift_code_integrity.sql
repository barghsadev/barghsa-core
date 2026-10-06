-- Expand: preserve IDs, scope and redemption history. Application rollback remains compatible.
-- Ambiguous existing identities require explicit owner reconciliation before retrying.
LOCK TABLE gift_codes,gift_code_profiles IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM gift_codes GROUP BY upper(btrim(code)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Gift code identities require explicit legacy reconciliation' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM gift_code_profiles GROUP BY gift_code_id,profile_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Gift profile scopes require explicit legacy reconciliation' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
UPDATE gift_codes SET code=upper(btrim(code)) WHERE code IS DISTINCT FROM upper(btrim(code));
--> statement-breakpoint
CREATE FUNCTION normalize_gift_code_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.code := upper(btrim(NEW.code));
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER gift_code_normalized_identity BEFORE INSERT OR UPDATE OF code ON gift_codes
 FOR EACH ROW EXECUTE FUNCTION normalize_gift_code_identity();

--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gift_code_profiles_scope" ON "gift_code_profiles" USING btree ("gift_code_id","profile_id");