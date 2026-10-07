CREATE TABLE "wallet_alert_signals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_alert_signals_source_check" CHECK ("wallet_alert_signals"."source" IN ('wallet','invoice','profile'))
);
--> statement-breakpoint
CREATE TABLE "wallet_low_balance_states" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"episode_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"recipient_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_alert_signals" ADD CONSTRAINT "wallet_alert_signals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_low_balance_states" ADD CONSTRAINT "wallet_low_balance_states_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_low_balance_states" ADD CONSTRAINT "wallet_low_balance_states_recipient_user_id_users_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_alert_signals_profile_created_idx" ON "wallet_alert_signals" USING btree ("profile_id","created_at");
--> statement-breakpoint
CREATE TRIGGER wallet_low_balance_states_updated_at BEFORE UPDATE ON wallet_low_balance_states
FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
--> statement-breakpoint
-- Each financial change appends an independent signal, never a shared row
-- that could invert the original invoice/wallet/profile lock order.
CREATE FUNCTION signal_wallet_low_balance_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 profile uuid;
 source_name text;
 written integer;
BEGIN
 IF TG_TABLE_NAME='wallets' THEN
  source_name:='wallet';
  IF TG_OP='DELETE' THEN profile:=OLD.profile_id;
  ELSE
   IF TG_OP='UPDATE' AND NEW.posted_balance=OLD.posted_balance AND NEW.reserved_balance=OLD.reserved_balance THEN RETURN NULL; END IF;
   profile:=NEW.profile_id;
  END IF;
 ELSIF TG_TABLE_NAME='invoices' THEN
  source_name:='invoice';
  IF TG_OP='DELETE' THEN profile:=OLD.profile_id;
  ELSE
   IF TG_OP='UPDATE' AND NEW.state=OLD.state AND NEW.total_amount=OLD.total_amount AND NEW.paid_amount=OLD.paid_amount
    AND NEW.adjustment_kind IS NOT DISTINCT FROM OLD.adjustment_kind AND NEW.profile_id=OLD.profile_id THEN RETURN NULL; END IF;
   profile:=NEW.profile_id;
  END IF;
 ELSE
  source_name:='profile';
  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id AND NEW.archived=OLD.archived THEN RETURN NULL; END IF;
  profile:=NEW.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=profile) THEN RETURN NULL; END IF;
 INSERT INTO wallet_alert_signals(profile_id,source) VALUES(profile,source_name);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 THEN RAISE EXCEPTION 'Wallet alert signal was not stored' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='invoices' THEN
  IF TG_OP='UPDATE' THEN
   IF OLD.profile_id<>NEW.profile_id THEN
    INSERT INTO wallet_alert_signals(profile_id,source) VALUES(OLD.profile_id,source_name);
    GET DIAGNOSTICS written=ROW_COUNT;
    IF written<>1 THEN RAISE EXCEPTION 'Previous wallet alert signal was not stored' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER wallet_low_balance_change AFTER INSERT OR UPDATE OF posted_balance,reserved_balance OR DELETE ON wallets
FOR EACH ROW EXECUTE FUNCTION signal_wallet_low_balance_change();
--> statement-breakpoint
CREATE TRIGGER invoice_wallet_low_balance_change AFTER INSERT OR UPDATE OF state,total_amount,paid_amount,adjustment_kind,profile_id OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION signal_wallet_low_balance_change();
--> statement-breakpoint
CREATE TRIGGER profile_wallet_low_balance_change AFTER UPDATE OF user_id,archived ON profiles
FOR EACH ROW EXECUTE FUNCTION signal_wallet_low_balance_change();

--> statement-breakpoint
-- Initialize only current unpaid deficits. No historical notice or outcome is replayed.
INSERT INTO wallet_alert_signals(profile_id,source)
SELECT p.id,'profile' FROM profiles p
WHERE NOT p.archived AND EXISTS(SELECT 1 FROM invoices i WHERE i.profile_id=p.id
 AND i.state IN ('Unpaid','Overdue') AND i.adjustment_kind IS DISTINCT FROM 'credit')
 AND COALESCE((SELECT posted_balance-reserved_balance FROM wallets w WHERE w.profile_id=p.id),0)
  < COALESCE((SELECT SUM(GREATEST(i.total_amount-i.paid_amount,0)) FROM invoices i WHERE i.profile_id=p.id
    AND i.state IN ('Unpaid','Overdue') AND i.adjustment_kind IS DISTINCT FROM 'credit'),0);
