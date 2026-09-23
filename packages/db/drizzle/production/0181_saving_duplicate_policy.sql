-- The default preserves duplicate prevention for existing saving plans.
-- Saving submissions serialize on the plan product row before checking this
-- setting and active orders; the replacement index keeps that lookup fast.
DROP INDEX "saving_orders_active_bill_plan_key";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "prevent_active_saving_duplicates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "saving_orders_active_bill_plan_idx" ON "saving_orders" USING btree ("bill_identifier","saving_plan_id") WHERE "saving_orders"."status" IN ('submitted','awaiting_staff_review','approved','in_progress');
