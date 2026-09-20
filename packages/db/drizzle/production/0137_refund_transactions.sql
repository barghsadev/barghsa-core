CREATE TYPE "public"."refund_transaction_state" AS ENUM('Pending', 'Completed', 'Rejected', 'Cancelled');--> statement-breakpoint
CREATE TABLE "refund_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refund_id" uuid NOT NULL,
	"state" "refund_transaction_state" DEFAULT 'Pending' NOT NULL,
	"wallet_transaction_id" uuid,
	"finished_at" timestamp with time zone,
	CONSTRAINT "refund_transactions_finished" CHECK (("refund_transactions"."state" = 'Pending') = ("refund_transactions"."finished_at" IS NULL)),
	CONSTRAINT "refund_transactions_credit_completed" CHECK ("refund_transactions"."wallet_transaction_id" IS NULL OR "refund_transactions"."state" = 'Completed')
);
--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_wallet_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_transactions_refund_unique" ON "refund_transactions" USING btree ("refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_transactions_credit_unique" ON "refund_transactions" USING btree ("wallet_transaction_id");
--> statement-breakpoint
-- Expand existing unpaid approvals without inventing credits or rewriting
-- historical terminal refunds. created_at records this migration for old rows.
INSERT INTO refund_transactions(refund_id)
SELECT id FROM refunds WHERE state IN ('Approved','Processing','Failed');
--> statement-breakpoint
CREATE FUNCTION guard_refund_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent refunds%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refund transaction history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO parent FROM refunds WHERE id=NEW.refund_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'Pending' OR parent.state NOT IN ('Approved','Processing','Failed') THEN
      RAISE EXCEPTION 'Only approved unpaid refunds can create a pending transaction' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.refund_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.refund_id,OLD.created_at)
       OR (OLD.state <> 'Pending' AND ROW(NEW.state,NEW.wallet_transaction_id,NEW.finished_at) IS DISTINCT FROM ROW(OLD.state,OLD.wallet_transaction_id,OLD.finished_at)) THEN
      RAISE EXCEPTION 'Refund transaction identity and terminal history are immutable' USING ERRCODE = '23514';
    END IF;
    IF (NEW.state='Pending' AND parent.state NOT IN ('Approved','Processing','Failed'))
       OR (NEW.state<>'Pending' AND NEW.state::text<>parent.state::text) THEN
      RAISE EXCEPTION 'Refund transaction must match its refund outcome' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.state='Completed' AND parent.destination='wallet' AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions w WHERE w.id=NEW.wallet_transaction_id
      AND w.wallet_id=parent.profile_id AND w.amount=parent.amount AND w.type='refund'
      AND w.state='Completed' AND w.ref_id=parent.id::text
      AND w.idempotency_key='refund-wallet-credit:'||parent.id::text
  ) THEN
    RAISE EXCEPTION 'Wallet refund completion requires its matching posted credit' USING ERRCODE = '23514';
  END IF;
  IF parent.destination='external_bank' AND NEW.wallet_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'External refunds cannot link a wallet credit' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_transactions_guard BEFORE INSERT OR UPDATE OR DELETE ON refund_transactions
FOR EACH ROW EXECUTE FUNCTION guard_refund_transaction();
--> statement-breakpoint
CREATE FUNCTION synchronize_refund_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE credit uuid;
BEGIN
  IF NEW.state IN ('Approved','Processing','Failed') THEN
    INSERT INTO refund_transactions(refund_id) VALUES(NEW.id) ON CONFLICT(refund_id) DO NOTHING;
  ELSIF NEW.state='Completed' AND OLD.state<>'Completed' THEN
    IF NEW.destination='wallet' THEN
      SELECT id INTO credit FROM wallet_transactions
        WHERE idempotency_key='refund-wallet-credit:'||NEW.id::text FOR UPDATE;
    END IF;
    UPDATE refund_transactions SET state='Completed',wallet_transaction_id=credit,finished_at=clock_timestamp()
      WHERE refund_id=NEW.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Refund completion requires a pending transaction' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.state IN ('Rejected','Cancelled') AND OLD.state<>NEW.state THEN
    UPDATE refund_transactions SET state=NEW.state::text::refund_transaction_state,finished_at=clock_timestamp()
      WHERE refund_id=NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_transaction_sync AFTER UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION synchronize_refund_transaction();
--> statement-breakpoint
CREATE FUNCTION guard_posted_refund_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM refund_transactions WHERE wallet_transaction_id=OLD.id) AND
    (TG_OP='DELETE' OR ROW(NEW.id,NEW.wallet_id,NEW.type,NEW.amount,NEW.state,NEW.ref_id,NEW.idempotency_key)
      IS DISTINCT FROM ROW(OLD.id,OLD.wallet_id,OLD.type,OLD.amount,OLD.state,OLD.ref_id,OLD.idempotency_key)) THEN
    RAISE EXCEPTION 'Posted refund credit identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wallet_transactions_refund_guard BEFORE UPDATE OR DELETE ON wallet_transactions
FOR EACH ROW EXECUTE FUNCTION guard_posted_refund_credit();
