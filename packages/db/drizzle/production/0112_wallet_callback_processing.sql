-- Expand the callback state constraint omitted from the production baseline.
-- Existing terminal rows are preserved; processing is the durable replay claim.
ALTER TABLE wallet_topup_callback_events
  DROP CONSTRAINT IF EXISTS chk_wallet_topup_callback_events_status;
--> statement-breakpoint
ALTER TABLE wallet_topup_callback_events
  ADD CONSTRAINT chk_wallet_topup_callback_events_status
  CHECK (status IN ('processing', 'credited', 'unpaid', 'duplicate'));
