-- Additive schema baseline. Existing rows and legacy migration metadata are retained.
-- Migration: 0000_init_uuidv7_function
-- Version: 1 (up)
-- Description: Create uuid_generate_v7() PostgreSQL function for
--              UUIDv7 primary keys with time-sortable values.
--
-- UUIDv7 (RFC 9562) encodes the current Unix timestamp in milliseconds
-- (48 bits) followed by random bits (74 bits), providing time-sortable
-- values that cluster well in B-tree indexes. This reduces index
-- fragmentation compared to UUIDv4 and eliminates the need for
-- sequence-based IDs.
--
-- Layout:
--   0                   1                   2                   3
--   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |                           unix_ts_ms                          |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |          unix_ts_ms           |  ver  |       rand_a          |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |var|                        rand_b                             |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |                            rand_b                             |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.uuid_generate_v7();

-- Ensure pgcrypto extension is available for gen_random_bytes().
-- WITH SCHEMA public pins the extension objects to a fixed schema: without
-- it, PG installs the extension into the first schema of the creating
-- connection's search_path, so `CREATE EXTENSION IF NOT EXISTS` from an
-- isolated test schema makes gen_random_bytes invisible to every other
-- schema (order-dependent test flake — see uuidv7-migration.test.ts CI
-- history). Pinning to public keeps it resolvable from any search_path.
--
-- The advisory transaction lock serializes concurrent `CREATE EXTENSION`
-- attempts: parallel test workers (both API integration suites apply this
-- migration) race on pg_extension_name_index inside `IF NOT EXISTS`
-- otherwise (duplicate key value violates unique constraint
-- "pg_extension_name_index"). The lock makes the second waiter a no-op.
-- IMPORTANT: this file must be applied as a single multi-statement SQL
-- request (pg uses one implicit transaction for the whole string), so the
-- advisory lock is held through CREATE EXTENSION. A per-statement applier
-- would release the lock between statements and restore the race.
SELECT pg_advisory_xact_lock(hashtext('barghsa.pgcrypto'));
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
PARALLEL SAFE
AS $$
DECLARE
  ms        BIGINT;
  ts_bytes  BYTEA;
  rnd_bytes BYTEA;
BEGIN
  -- Use clock_timestamp() so concurrent calls in the same transaction
  -- each get a distinct timestamp, preserving monotonic ordering.
  ms := floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;

  -- Convert the 48-bit timestamp to 6 bytes (big-endian).
  -- int8send returns 8 bytes; take the last 6 (low 48 bits).
  ts_bytes := substring(int8send(ms) FROM 3);

  -- 10 bytes of randomness (80 bits); we only need 74 random bits
  -- (4 + 8 + 6 + 56 = 74), so the unused bits are overwritten by
  -- version and variant fields below.
  rnd_bytes := gen_random_bytes(10);

  -- Set the UUID version (bits 48-51 = 0111 = 7).
  -- rnd_bytes[0] corresponds to the high nibble of UUID byte 6.
  -- Keep the low nibble as random (4 bits).
  rnd_bytes := set_byte(
    rnd_bytes,
    0,
    (get_byte(rnd_bytes, 0) & 15) | 112  -- 0x70 = 0111 0000
  );

  -- Set the RFC 4122 variant (bits 64-65 = 10).
  -- rnd_bytes[2] corresponds to UUID byte 8.
  rnd_bytes := set_byte(
    rnd_bytes,
    2,
    (get_byte(rnd_bytes, 2) & 63) | 128  -- 0x80 = 1000 0000
  );

  -- Concatenate: 6 bytes timestamp + 10 bytes random = 16 bytes = UUID.
  RETURN (encode(ts_bytes || rnd_bytes, 'hex'))::uuid;
END;
$$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."province_status" AS ENUM('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."city_status" AS ENUM('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."invoice_state" AS ENUM('Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid', 'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."notification_category" AS ENUM('mandatory_transactional', 'marketing');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."notification_type" AS ENUM('verification_status', 'profile_verified', 'profile_unverified', 'profile_pending', 'general');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."product_category" AS ENUM('electricity_generation_station_consultation', 'electricity_saving_certificate_consultation', 'thermal_electricity', 'green_electricity', 'free_market_electricity', 'energy_saving_electricity');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."product_type" AS ENUM('consultation', 'electricity', 'hardware', 'saving_plan');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
CREATE TYPE "public"."product_status" AS ENUM('active', 'inactive', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"province_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"full_address" text NOT NULL,
	"postal_code" text NOT NULL,
	"main_address" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agent_slots" (
	"slot_key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"agent_id" uuid,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"model_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agent_kbs" (
	"agent_id" uuid NOT NULL,
	"kb_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_kbs_agent_id_kb_id_pk" PRIMARY KEY("agent_id","kb_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agent_policies" (
	"agent_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_policies_agent_id_policy_id_pk" PRIMARY KEY("agent_id","policy_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"provider_type" text NOT NULL,
	"base_url" text NOT NULL,
	"model_name" text NOT NULL,
	"api_token" text,
	"created_by" text NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_status" text DEFAULT 'pending' NOT NULL,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"policy_type" text NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_policy_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_policy_group_members" (
	"group_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_policy_group_members_group_id_policy_id_pk" PRIMARY KEY("group_id","policy_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action_type" text NOT NULL,
	"amount_irr" bigint NOT NULL,
	"initiator_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event" text NOT NULL,
	"metadata" text,
	"correlation_id" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'failed' NOT NULL,
	"error" text,
	"error_category" text DEFAULT 'transient' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_run_at" timestamp with time zone,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_receipt_attachment_claims" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"claim_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_bank_receipt_attachment_claims_storage_key_nonblank" CHECK (length(trim("bank_receipt_attachment_claims"."storage_key")) > 0),
	CONSTRAINT "chk_bank_receipt_attachment_claims_type" CHECK ("bank_receipt_attachment_claims"."claim_type" IN ('wallet_topup', 'invoice_receipt'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"amount" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"payer_reference" text NOT NULL,
	"attachment_key" text NOT NULL,
	"customer_note" text,
	"state" text DEFAULT 'Submitted' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"rejection_reason" text,
	CONSTRAINT "chk_bank_receipts_amount_positive" CHECK ("bank_receipts"."amount" > 0),
	CONSTRAINT "chk_bank_receipts_state" CHECK ("bank_receipts"."state" IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected')),
	CONSTRAINT "chk_bank_receipts_payer_reference_nonblank" CHECK (length(trim("bank_receipts"."payer_reference")) > 0),
	CONSTRAINT "chk_bank_receipts_attachment_key_nonblank" CHECK (length(trim("bank_receipts"."attachment_key")) > 0),
	CONSTRAINT "chk_bank_receipts_state_fields" CHECK ((
        (
          "bank_receipts"."state" = 'Confirmed'
          AND "bank_receipts"."confirmed_by" IS NOT NULL
          AND "bank_receipts"."confirmed_at" IS NOT NULL
          AND "bank_receipts"."rejection_reason" IS NULL
        )
        OR (
          "bank_receipts"."state" = 'Rejected'
          AND "bank_receipts"."rejection_reason" IS NOT NULL
          AND length(trim("bank_receipts"."rejection_reason")) > 0
          AND "bank_receipts"."confirmed_by" IS NULL
          AND "bank_receipts"."confirmed_at" IS NULL
        )
        OR (
          "bank_receipts"."state" IN ('Submitted', 'UnderReview')
          AND "bank_receipts"."confirmed_by" IS NULL
          AND "bank_receipts"."confirmed_at" IS NULL
          AND "bank_receipts"."rejection_reason" IS NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_version" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text,
	"file_size" bigint,
	"placeholders" text[] DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_type_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contract_type_id" uuid NOT NULL,
	"template_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_trusts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_fingerprint" text NOT NULL,
	"user_agent_hint" text,
	"trusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "electricity_product_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"min_kwh" bigint DEFAULT 0 NOT NULL,
	"max_kwh" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"transport" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by" text,
	"last_test_at" timestamp with time zone,
	"last_test_status" text DEFAULT 'pending' NOT NULL,
	"last_test_error" text,
	"degraded" boolean DEFAULT false NOT NULL,
	"degraded_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"window_failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"supersedes_id" uuid DEFAULT uuid_generate_v7(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"address" text NOT NULL,
	"reason" text NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7(),
	"source_event_id" uuid DEFAULT uuid_generate_v7(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"event_token" text NOT NULL,
	"event_type" text NOT NULL,
	"message_id" text,
	"to_address" text,
	"from_address" text,
	"outbox_id" uuid DEFAULT uuid_generate_v7(),
	"status" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provinces" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"status" "province_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"province_id" uuid NOT NULL,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"status" "city_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" bigint NOT NULL,
	"max_cap_irr" bigint,
	"eligibility" text DEFAULT 'public' NOT NULL,
	"total_limit" integer,
	"per_profile_limit" integer,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"min_order_amount" bigint DEFAULT 0 NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_code_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gift_code_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_code_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gift_code_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"discount_amount" bigint NOT NULL,
	"status" text DEFAULT 'consumed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"idempotency_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"response" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_idempotency_keys_key_nonblank" CHECK (char_length(btrim("idempotency_keys"."idempotency_key")) > 0),
	CONSTRAINT "chk_idempotency_keys_entity_type_nonblank" CHECK (char_length(btrim("idempotency_keys"."entity_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"type" text NOT NULL,
	"title_i18n_key" text NOT NULL,
	"body_i18n_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link_route" text,
	"link_params" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"product_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"product_title" jsonb,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"vat_rate" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invoice_items_quantity_positive" CHECK ("invoice_items"."quantity" > 0),
	CONSTRAINT "ck_invoice_items_unit_price_non_negative" CHECK ("invoice_items"."unit_price" >= 0),
	CONSTRAINT "ck_invoice_items_vat_rate_range" CHECK ("invoice_items"."vat_rate" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"vat_rate" integer DEFAULT 0 NOT NULL,
	"vat_amount" bigint DEFAULT 0::bigint NOT NULL,
	"is_taxable" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invoice_lines_quantity_positive" CHECK ("invoice_lines"."quantity" > 0),
	CONSTRAINT "ck_invoice_lines_unit_price_non_negative" CHECK ("invoice_lines"."unit_price" >= 0),
	CONSTRAINT "ck_invoice_lines_line_total_non_negative" CHECK ("invoice_lines"."line_total" >= 0),
	CONSTRAINT "ck_invoice_lines_vat_rate_range" CHECK ("invoice_lines"."vat_rate" BETWEEN 0 AND 10000),
	CONSTRAINT "ck_invoice_lines_vat_amount_non_negative" CHECK ("invoice_lines"."vat_amount" >= 0),
	CONSTRAINT "ck_invoice_lines_non_taxable_zero_vat" CHECK ("invoice_lines"."is_taxable" OR "invoice_lines"."vat_amount" = 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_reminder_offset_toggles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"service_type" text NOT NULL,
	"offset" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_reminder_schedule" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"offset" integer NOT NULL,
	"channel" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid DEFAULT uuid_generate_v7(),
	"contract_id" text,
	"consultation_id" text,
	"type" text,
	"state" "invoice_state" DEFAULT 'Draft' NOT NULL,
	"total_amount" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0::bigint NOT NULL,
	"refunded_amount" bigint DEFAULT 0::bigint NOT NULL,
	"issued_at" timestamp with time zone,
	"payable_from" timestamp with time zone,
	"due_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"overdue_at" timestamp with time zone,
	"metadata" jsonb,
	"invoice_calculation_snapshot" jsonb,
	"replaces_invoice_id" uuid,
	"adjustment_for_invoice_id" uuid,
	"adjustment_kind" text,
	"accounting_amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_invoices_id_profile_id" UNIQUE("id","profile_id"),
	CONSTRAINT "ck_paid_not_exceeds_total" CHECK ("invoices"."paid_amount" <= "invoices"."total_amount"),
	CONSTRAINT "ck_refund_not_exceeds_paid" CHECK ("invoices"."refunded_amount" <= "invoices"."paid_amount"),
	CONSTRAINT "ck_invoices_adjustment_kind_matches_link" CHECK ((
        ("invoices"."adjustment_for_invoice_id" IS NULL) = ("invoices"."adjustment_kind" IS NULL)
        AND (
          "invoices"."adjustment_kind" IS NULL
          OR "invoices"."adjustment_kind" IN ('charge', 'credit')
        )
      ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_group_members" (
	"group_id" uuid NOT NULL,
	"kb_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_group_members_group_id_kb_id_pk" PRIMARY KEY("group_id","kb_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"kb_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_kbd_kb_storage" UNIQUE("kb_id","storage_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_fa" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"legal_name" text NOT NULL,
	"national_identifier" text NOT NULL,
	"registration_number" text NOT NULL,
	"company_type_id" text,
	"registration_date" text,
	"economic_code" text,
	"official_phone" text,
	"official_email" text,
	"official_province_id" text,
	"official_city_id" text,
	"official_full_address" text,
	"official_postal_code" text,
	"representative_title" text NOT NULL,
	"representative_relationship" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_dead_letter" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"outbox_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"job_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"channel" text NOT NULL,
	"event_key" text NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7(),
	"user_id" text,
	"cause" text,
	"error_category" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dead_letter_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"notification_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_ref" text,
	"latency_ms" integer,
	"error_category" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text,
	"event_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" text[] NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"provider_ref" text,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_job" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"outbox_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"category" "notification_category" NOT NULL,
	"is_marketing" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"channel" text NOT NULL,
	"marketing_opted_in" boolean DEFAULT false NOT NULL,
	"consent_granted_at" timestamp with time zone,
	"consent_revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"event_key" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text,
	"body_template" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_test_sent_at" timestamp with time zone,
	"last_test_status" text,
	"published_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid,
	"type" "notification_type" DEFAULT 'general' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"order_type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"snapshot_province_id" text NOT NULL,
	"snapshot_city_id" text NOT NULL,
	"snapshot_full_address" text NOT NULL,
	"snapshot_postal_code" text NOT NULL,
	"gift_code_id" uuid,
	"gift_discount_amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "otp_challenges" (
	"challenge_id" text PRIMARY KEY NOT NULL,
	"destination" text NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts_remaining" integer DEFAULT 5 NOT NULL,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"user_id" text,
	"password_hash" text,
	"tos_version_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"category" "product_category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"vat_category_override" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "product_type" DEFAULT 'electricity' NOT NULL,
	"system_key" text,
	"title" jsonb NOT NULL,
	"description" jsonb,
	"price" bigint,
	"status" "product_status" DEFAULT 'inactive' NOT NULL,
	CONSTRAINT "products_system_key_unique" UNIQUE("system_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_agents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"username" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_ownership_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	"user_id" text NOT NULL,
	"profile_type" text DEFAULT 'INDIVIDUAL' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"title" text,
	"first_name" text,
	"last_name" text,
	"national_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"window_ms" integer NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"window_ms" integer NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reconciliation_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exception_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_to_id" text,
	"resolved_by_id" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_breach_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"service_type" text NOT NULL,
	"item_id" text NOT NULL,
	"target_hours" integer NOT NULL,
	"alerted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"escalated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_due_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"service_type" text NOT NULL,
	"default_days" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"csrf_token" text NOT NULL,
	"refresh_token_hash" text,
	"family_id" text,
	"device_info" jsonb,
	"step_up_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_deadline" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_roles" (
	"role_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"permissions" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_teams" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"skill_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_team_members" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text,
	"content_type" text,
	"file_size" bigint,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"signed_at" timestamp with time zone,
	"signed_by" text,
	"removed_at" timestamp with time zone,
	CONSTRAINT "storage_records_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"profile_id" uuid,
	"related_entity_type" text,
	"related_entity_id" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tos_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" text NOT NULL,
	"version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tos_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"version_id" text NOT NULL,
	"content_fa" text NOT NULL,
	"content_en" text NOT NULL,
	"change_type" text DEFAULT 'minor' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tos_versions_version_id_unique" UNIQUE("version_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"allowed_extensions" text[] NOT NULL,
	"max_size_bytes" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"mobile" text,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'fa' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"password_change_token" text,
	"password_change_token_expires_at" timestamp with time zone,
	"notification_preferences" text DEFAULT 'IN_APP' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tehran' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"activation_token" text,
	"activation_token_expires_at" timestamp with time zone,
	"last_accepted_tos_version" text,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vat_configurations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"rate" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_vat_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"vat_config_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"current_value" text,
	"requested_value" text NOT NULL,
	"evidence_urls" text DEFAULT '[]' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_by" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reviewer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_chargeback_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"event_id" text NOT NULL,
	"original_transaction_id" uuid,
	"reversal_transaction_id" uuid,
	"wallet_id" uuid,
	"status" text NOT NULL,
	"match_method" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_topup_callback_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"event_id" text NOT NULL,
	"pending_transaction_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"status" text NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"posted_balance" bigint DEFAULT 0::bigint NOT NULL,
	"reserved_balance" bigint DEFAULT 0::bigint NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_wallets_available_balance_nonneg" CHECK (("wallets"."posted_balance" - "wallets"."reserved_balance") >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"state" text DEFAULT 'Pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"ref_id" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"receipt_attachment_key" text,
	"reverses_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_wallet_transactions_type" CHECK ("wallet_transactions"."type" IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating')),
	CONSTRAINT "chk_wallet_transactions_state" CHECK ("wallet_transactions"."state" IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed')),
	CONSTRAINT "chk_wallet_transactions_amount_nonzero" CHECK ("wallet_transactions"."amount" <> 0),
	CONSTRAINT "chk_wallet_tx_reversal_original" CHECK (("wallet_transactions"."type" = 'reversal' AND "wallet_transactions"."reverses_transaction_id" IS NOT NULL) OR ("wallet_transactions"."type" <> 'reversal' AND "wallet_transactions"."reverses_transaction_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "province_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "city_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "full_address" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "postal_code" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "main_address" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_slots" ADD COLUMN IF NOT EXISTS "slot_key" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_slots" ADD COLUMN IF NOT EXISTS "label" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_slots" ADD COLUMN IF NOT EXISTS "agent_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_agent_slots" ADD COLUMN IF NOT EXISTS "updated_by" text;
--> statement-breakpoint
ALTER TABLE "ai_agent_slots" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "model_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_kbs" ADD COLUMN IF NOT EXISTS "agent_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_kbs" ADD COLUMN IF NOT EXISTS "kb_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_kbs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_policies" ADD COLUMN IF NOT EXISTS "agent_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_policies" ADD COLUMN IF NOT EXISTS "policy_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_agent_policies" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "provider_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "base_url" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "model_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "api_token" text;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "last_tested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "last_test_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "last_test_error" text;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "policy_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "rules" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policies" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_groups" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_groups" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_groups" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_groups" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_groups" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_groups" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_group_members" ADD COLUMN IF NOT EXISTS "group_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_group_members" ADD COLUMN IF NOT EXISTS "policy_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_policy_group_members" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "action_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "amount_irr" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "initiator_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "reason" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "reviewer_id" text;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "review_reason" text;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "event" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "metadata" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "correlation_id" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "ip" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "job_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'failed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "error" text;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "error_category" text DEFAULT 'transient' NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "first_failed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "last_run_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "resolved_by_id" text;
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bank_receipt_attachment_claims" ADD COLUMN IF NOT EXISTS "storage_key" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipt_attachment_claims" ADD COLUMN IF NOT EXISTS "claim_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipt_attachment_claims" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipt_attachment_claims" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "amount" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "payment_date" date NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "payer_reference" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "attachment_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "customer_note" text;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'Submitted' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "confirmed_by" text;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bank_receipts" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN IF NOT EXISTS "key" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN IF NOT EXISTS "value" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "config_version" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY DEFAULT 'global' NOT NULL;
--> statement-breakpoint
ALTER TABLE "config_version" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "config_version" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "template_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "version_number" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "storage_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "file_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "content_type" text;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "file_size" bigint;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "placeholders" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_type_templates" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_type_templates" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_type_templates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_type_templates" ADD COLUMN IF NOT EXISTS "contract_type_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_type_templates" ADD COLUMN IF NOT EXISTS "template_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "device_fingerprint" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "user_agent_hint" text;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "trusted_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_trusts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "electricity_product_limits" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "electricity_product_limits" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "electricity_product_limits" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "electricity_product_limits" ADD COLUMN IF NOT EXISTS "product_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "electricity_product_limits" ADD COLUMN IF NOT EXISTS "min_kwh" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "electricity_product_limits" ADD COLUMN IF NOT EXISTS "max_kwh" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "transport" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "label" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "config" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "activated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "activated_by" text;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "last_test_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "last_test_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "last_test_error" text;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "degraded" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "degraded_reason" text;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "window_failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "window_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "last_failure_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "supersedes_id" uuid DEFAULT uuid_generate_v7();
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "address" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "reason" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7();
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "source_event_id" uuid DEFAULT uuid_generate_v7();
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "event_token" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "event_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "message_id" text;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "to_address" text;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "from_address" text;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "outbox_id" uuid DEFAULT uuid_generate_v7();
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "raw" jsonb;
--> statement-breakpoint
ALTER TABLE "email_webhook_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "name_fa" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "name_en" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "status" "province_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "province_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "name_fa" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "name_en" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "status" "city_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "code" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "discount_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "discount_value" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "max_cap_irr" bigint;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "eligibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "total_limit" integer;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "per_profile_limit" integer;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "valid_from" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "valid_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "min_order_amount" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "categories" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_codes" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_profiles" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_profiles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_profiles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_profiles" ADD COLUMN IF NOT EXISTS "gift_code_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_profiles" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "gift_code_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "order_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "discount_amount" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "gift_code_redemptions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'consumed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "idempotency_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "entity_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "entity_id" text;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "response" jsonb;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "title_i18n_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "body_i18n_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "params" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "link_route" text;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "link_params" jsonb;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "is_read" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "product_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "product_title" jsonb;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "quantity" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "unit_price" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "vat_rate" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "quantity" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "unit_price" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "line_total" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "vat_rate" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "vat_amount" bigint DEFAULT 0::bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "is_taxable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "service_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "offset" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_offset_toggles" ADD COLUMN IF NOT EXISTS "updated_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "invoice_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "offset" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "channel" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoice_reminder_schedule" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'scheduled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "order_id" uuid DEFAULT uuid_generate_v7();
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "contract_id" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "consultation_id" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "type" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "state" "invoice_state" DEFAULT 'Draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "total_amount" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_amount" bigint DEFAULT 0::bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "refunded_amount" bigint DEFAULT 0::bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payable_from" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "overdue_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_calculation_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "replaces_invoice_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "adjustment_for_invoice_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "adjustment_kind" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "accounting_amount" bigint;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_groups" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_groups" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_groups" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_groups" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_groups" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_groups" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_group_members" ADD COLUMN IF NOT EXISTS "group_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_group_members" ADD COLUMN IF NOT EXISTS "kb_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_group_members" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "kb_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "storage_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "file_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "mime_type" text;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "size_bytes" bigint;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "processing_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "processing_error" text;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_types" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_types" ADD COLUMN IF NOT EXISTS "name_en" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_types" ADD COLUMN IF NOT EXISTS "name_fa" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "legal_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "national_identifier" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "registration_number" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "company_type_id" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "registration_date" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "economic_code" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "official_phone" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "official_email" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "official_province_id" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "official_city_id" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "official_full_address" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "official_postal_code" text;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "representative_title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "representative_relationship" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "legal_profiles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "outbox_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "job_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "channel" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "event_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'error' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7();
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "cause" text;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "error_category" text;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "idempotency_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "resolved_by" text;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_dead_letter" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "notification_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "channel" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "attempt_number" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "provider_ref" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "latency_ms" integer;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "error_category" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "error_detail" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "event_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "channels" text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'queued' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "idempotency_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "provider_ref" text;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "outbox_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "channel" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'queued' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "run_after" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_categories" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_categories" ADD COLUMN IF NOT EXISTS "category" "notification_category" NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_categories" ADD COLUMN IF NOT EXISTS "is_marketing" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_categories" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "notification_categories" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_categories" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "profile_id" uuid DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "channel" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "marketing_opted_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "consent_granted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "consent_revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "event_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "channel" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "locale" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "subject" text;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "body_template" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "variables" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "last_test_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "last_test_status" text;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" "notification_type" DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "body" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "link" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "product_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'DRAFT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "snapshot_province_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "snapshot_city_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "snapshot_full_address" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "snapshot_postal_code" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gift_code_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gift_discount_amount" bigint;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "challenge_id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "destination" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "otp_hash" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "attempts_remaining" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "resend_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "password_hash" text;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "tos_version_id" text;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "consumed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "password_history" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "password_history" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "password_history" ADD COLUMN IF NOT EXISTS "password_hash" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "password_history" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "password_history" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "product_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "category" "product_category" NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "product_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "price" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "vat_category_override" uuid;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "effective_from" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "effective_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "product_price_versions" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "type" "product_type" DEFAULT 'electricity' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "system_key" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "title" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description" jsonb;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "price" bigint;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "status" "product_status" DEFAULT 'inactive' NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "joined_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_agents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "username" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "invited_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'Pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_invitations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "from_user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "to_user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'Pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "declined_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_ownership_transfers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "archived_reason" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "profile_type" text DEFAULT 'INDIVIDUAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'DRAFT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "first_name" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "last_name" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "national_id" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "window_start" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "window_ms" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "count" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "security_rate_limit_counters" ADD COLUMN IF NOT EXISTS "key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "security_rate_limit_counters" ADD COLUMN IF NOT EXISTS "window_start" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "security_rate_limit_counters" ADD COLUMN IF NOT EXISTS "window_ms" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "security_rate_limit_counters" ADD COLUMN IF NOT EXISTS "count" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "security_rate_limit_counters" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "security_rate_limit_counters" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "exception_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'medium' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "assigned_to_id" text;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "resolved_by_id" text;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "resolution_note" text;
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "token_hash" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "session_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "consumed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "service_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "item_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "target_hours" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "alerted_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "escalation_level" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_breach_alerts" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "service_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "default_days" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "effective_from" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "effective_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "service_due_periods" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "session_id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "csrf_token" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "refresh_token_hash" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "family_id" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "device_info" jsonb;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "step_up_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "idle_deadline" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD COLUMN IF NOT EXISTS "role_id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD COLUMN IF NOT EXISTS "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD COLUMN IF NOT EXISTS "permissions" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "role_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "skill_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_teams" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_team_members" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_team_members" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_team_members" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_team_members" ADD COLUMN IF NOT EXISTS "team_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_team_members" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "storage_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "file_name" text;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "content_type" text;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "file_size" bigint;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "signed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "signed_by" text;
--> statement-breakpoint
ALTER TABLE "storage_records" ADD COLUMN IF NOT EXISTS "removed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "ticket_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "author_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "body" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "subject" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "body" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "related_entity_type" text;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "related_entity_id" text;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "assigned_to" text;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD COLUMN IF NOT EXISTS "version_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD COLUMN IF NOT EXISTS "ip_address" text;
--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "version_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "content_fa" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "content_en" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "change_type" text DEFAULT 'minor' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tos_versions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "category" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "allowed_extensions" text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "max_size_bytes" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "effective_from" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "effective_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "upload_policies" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "user_id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mobile" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'fa' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_change_token" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_change_token_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" text DEFAULT 'IN_APP' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'Asia/Tehran' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activation_token" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activation_token_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_accepted_tos_version" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "category" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "rate" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "effective_from" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "effective_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vat_configurations" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "product_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "vat_config_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "effective_from" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "effective_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "product_vat_overrides" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "profile_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "field_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "current_value" text;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "requested_value" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "evidence_urls" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "reason" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'Open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "reviewer_notes" text;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_cases" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "event_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "original_transaction_id" uuid;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "reversal_transaction_id" uuid;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "wallet_id" uuid;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "match_method" text;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "raw" jsonb;
--> statement-breakpoint
ALTER TABLE "wallet_chargeback_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "event_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "pending_transaction_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "wallet_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "raw" jsonb;
--> statement-breakpoint
ALTER TABLE "wallet_topup_callback_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "profile_id" uuid PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "posted_balance" bigint DEFAULT 0::bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "reserved_balance" bigint DEFAULT 0::bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "wallet_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "amount" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'Pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "ref_id" text;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "receipt_attachment_key" text;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "reverses_transaction_id" uuid;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'addresses' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "addresses" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "orders" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'product_id' AND data_type = 'text') THEN
    ALTER TABLE "orders" ALTER COLUMN "product_id" TYPE uuid USING "product_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'verification_cases' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "verification_cases" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tos_acceptances' AND column_name = 'version_id' AND data_type = 'text') THEN
    ALTER TABLE "tos_acceptances" ALTER COLUMN "version_id" TYPE uuid USING "version_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_agents' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "profile_agents" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_invitations' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "profile_invitations" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_ownership_transfers' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "profile_ownership_transfers" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "tickets" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ticket_comments' AND column_name = 'ticket_id' AND data_type = 'text') THEN
    ALTER TABLE "ticket_comments" ALTER COLUMN "ticket_id" TYPE uuid USING "ticket_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'profile_id' AND data_type = 'text') THEN
    ALTER TABLE "notifications" ALTER COLUMN "profile_id" TYPE uuid USING "profile_id"::uuid;
  END IF;
END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='addresses' AND column_name='province_id' AND data_type='text') THEN
ALTER TABLE addresses ALTER COLUMN province_id TYPE uuid USING province_id::uuid;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='addresses' AND column_name='city_id' AND data_type='text') THEN
ALTER TABLE addresses ALTER COLUMN city_id TYPE uuid USING city_id::uuid;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cities' AND column_name='province_id' AND data_type='text') THEN
ALTER TABLE cities ALTER COLUMN province_id TYPE uuid USING province_id::uuid;
END IF; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agent_slots" ADD CONSTRAINT "ai_agent_slots_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agent_slots" ADD CONSTRAINT "ai_agent_slots_updated_by_users_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agent_kbs" ADD CONSTRAINT "ai_agent_kbs_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agent_kbs" ADD CONSTRAINT "ai_agent_kbs_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agent_policies" ADD CONSTRAINT "ai_agent_policies_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_agent_policies" ADD CONSTRAINT "ai_agent_policies_policy_id_ai_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."ai_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_policy_groups" ADD CONSTRAINT "ai_policy_groups_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_policy_group_members" ADD CONSTRAINT "ai_policy_group_members_group_id_ai_policy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ai_policy_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ai_policy_group_members" ADD CONSTRAINT "ai_policy_group_members_policy_id_ai_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."ai_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_initiator_id_users_user_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewer_id_users_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_resolved_by_id_users_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "bank_receipts" ADD CONSTRAINT "bank_receipts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "bank_receipts" ADD CONSTRAINT "bank_receipts_confirmed_by_users_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "bank_receipts" ADD CONSTRAINT "fk_bank_receipts_invoice_profile" FOREIGN KEY ("invoice_id","profile_id") REFERENCES "public"."invoices"("id","profile_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "contract_type_templates" ADD CONSTRAINT "contract_type_templates_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "electricity_product_limits" ADD CONSTRAINT "electricity_product_limits_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "email_provider_configs" ADD CONSTRAINT "email_provider_configs_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "email_provider_configs" ADD CONSTRAINT "email_provider_configs_activated_by_users_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_source_event_id_email_webhook_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."email_webhook_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "email_webhook_events" ADD CONSTRAINT "email_webhook_events_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "gift_codes" ADD CONSTRAINT "gift_codes_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "gift_code_profiles" ADD CONSTRAINT "gift_code_profiles_gift_code_id_gift_codes_id_fk" FOREIGN KEY ("gift_code_id") REFERENCES "public"."gift_codes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "gift_code_profiles" ADD CONSTRAINT "gift_code_profiles_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "gift_code_redemptions" ADD CONSTRAINT "gift_code_redemptions_gift_code_id_gift_codes_id_fk" FOREIGN KEY ("gift_code_id") REFERENCES "public"."gift_codes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "gift_code_redemptions" ADD CONSTRAINT "gift_code_redemptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "gift_code_redemptions" ADD CONSTRAINT "gift_code_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoice_reminder_offset_toggles" ADD CONSTRAINT "invoice_reminder_offset_toggles_updated_by_users_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoice_reminder_schedule" ADD CONSTRAINT "invoice_reminder_schedule_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replaces_invoice_id_fkey" FOREIGN KEY ("replaces_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_adjustment_for_invoice_id_fkey" FOREIGN KEY ("adjustment_for_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "kb_groups" ADD CONSTRAINT "kb_groups_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "kb_group_members" ADD CONSTRAINT "kb_group_members_group_id_kb_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."kb_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "kb_group_members" ADD CONSTRAINT "kb_group_members_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_storage_key_storage_records_storage_key_fk" FOREIGN KEY ("storage_key") REFERENCES "public"."storage_records"("storage_key") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_dead_letter" ADD CONSTRAINT "notification_dead_letter_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_dead_letter" ADD CONSTRAINT "notification_dead_letter_job_id_notification_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."notification_job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_delivery_log" ADD CONSTRAINT "notification_delivery_log_notification_id_notification_outbox_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_job" ADD CONSTRAINT "notification_job_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "orders" ADD CONSTRAINT "orders_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "product_price_versions" ADD CONSTRAINT "product_price_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "product_price_versions" ADD CONSTRAINT "product_price_versions_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "profile_agents" ADD CONSTRAINT "profile_agents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "profile_invitations" ADD CONSTRAINT "profile_invitations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "profile_ownership_transfers" ADD CONSTRAINT "profile_ownership_transfers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "profile_ownership_transfers" ADD CONSTRAINT "profile_ownership_transfers_from_user_id_users_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "profile_ownership_transfers" ADD CONSTRAINT "profile_ownership_transfers_to_user_id_users_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_assigned_to_id_users_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_resolved_by_id_users_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "service_due_periods" ADD CONSTRAINT "service_due_periods_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "staff_team_members" ADD CONSTRAINT "staff_team_members_team_id_staff_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."staff_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "staff_team_members" ADD CONSTRAINT "staff_team_members_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_users_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_users_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_version_id_tos_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."tos_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "tos_versions" ADD CONSTRAINT "tos_versions_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "upload_policies" ADD CONSTRAINT "upload_policies_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "vat_configurations" ADD CONSTRAINT "vat_configurations_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "product_vat_overrides" ADD CONSTRAINT "product_vat_overrides_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "product_vat_overrides" ADD CONSTRAINT "product_vat_overrides_vat_config_id_vat_configurations_id_fk" FOREIGN KEY ("vat_config_id") REFERENCES "public"."vat_configurations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "product_vat_overrides" ADD CONSTRAINT "product_vat_overrides_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_reviewed_by_users_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_chargeback_events" ADD CONSTRAINT "wallet_chargeback_events_original_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("original_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_chargeback_events" ADD CONSTRAINT "wallet_chargeback_events_reversal_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_chargeback_events" ADD CONSTRAINT "wallet_chargeback_events_wallet_id_wallets_profile_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("profile_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_topup_callback_events" ADD CONSTRAINT "wallet_topup_callback_events_pending_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("pending_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_topup_callback_events" ADD CONSTRAINT "wallet_topup_callback_events_wallet_id_wallets_profile_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("profile_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_profile_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("profile_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
DO $baseline$ BEGIN
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "fk_wallet_tx_reverses_transaction" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $baseline$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aias_agent_id" ON "ai_agent_slots" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aia_created_at" ON "ai_agents" USING btree ("created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aia_model_id" ON "ai_agents" USING btree ("model_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aiak_agent_id" ON "ai_agent_kbs" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aiak_kb_id" ON "ai_agent_kbs" USING btree ("kb_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aiap_agent_id" ON "ai_agent_policies" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aiap_policy_id" ON "ai_agent_policies" USING btree ("policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aim_created_at" ON "ai_models" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aip_created_at" ON "ai_policies" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aip_type" ON "ai_policies" USING btree ("policy_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aipg_created_at" ON "ai_policy_groups" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aipgm_policy_id" ON "ai_policy_group_members" USING btree ("policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_receipts_invoice_id" ON "bank_receipts" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_receipts_profile_id" ON "bank_receipts" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_receipts_state" ON "bank_receipts" USING btree ("state");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_receipts_attachment_key" ON "bank_receipts" USING btree ("attachment_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_email_provider_active" ON "email_provider_configs" USING btree ("status") WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_email_suppression" ON "email_suppressions" USING btree ("address","reason");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_suppression_address" ON "email_suppressions" USING btree ("address");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_email_webhook_event_token" ON "email_webhook_events" USING btree ("event_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ewe_message" ON "email_webhook_events" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ewe_address" ON "email_webhook_events" USING btree ("to_address");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_idempotency_keys_key_entity_type" ON "idempotency_keys" USING btree ("idempotency_key","entity_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_expires_at" ON "idempotency_keys" USING btree ("expires_at") WHERE "idempotency_keys"."expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ian_profile_created" ON "in_app_notifications" USING btree ("profile_id","created_at" desc);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_reminder_offset_toggles_type_offset" ON "invoice_reminder_offset_toggles" USING btree ("service_type","offset");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_reminder_schedule_invoice_offset_channel" ON "invoice_reminder_schedule" USING btree ("invoice_id","offset","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoices_order_id_type" ON "invoices" USING btree ("order_id","type") WHERE "invoices"."replaces_invoice_id" IS NULL AND "invoices"."adjustment_for_invoice_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_replaces_invoice_id" ON "invoices" USING btree ("replaces_invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_adjustment_for_invoice_id" ON "invoices" USING btree ("adjustment_for_invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kbg_created_at" ON "kb_groups" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kbgm_kb_id" ON "kb_group_members" USING btree ("kb_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_created_at" ON "knowledge_bases" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kbd_kb_id" ON "kb_documents" USING btree ("kb_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kbd_processing_status" ON "kb_documents" USING btree ("processing_status") WHERE processing_status IN ('pending', 'processing', 'failed');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ndl_status_created" ON "notification_dead_letter" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ndl_severity" ON "notification_dead_letter" USING btree ("severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ndl_outbox" ON "notification_dead_letter" USING btree ("outbox_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ndl_notification" ON "notification_delivery_log" USING btree ("notification_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ndl_channel_status" ON "notification_delivery_log" USING btree ("channel","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ndl_created" ON "notification_delivery_log" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_outbox_idempotency" ON "notification_outbox" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_job_outbox_channel" ON "notification_job" USING btree ("outbox_id","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_categories_category" ON "notification_categories" USING btree ("category");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_notification_preferences_profile_channel" ON "user_notification_preferences" USING btree ("profile_id","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_templates_active" ON "notification_templates" USING btree ("event_key","channel","locale") WHERE is_active = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_counters_pk" ON "rate_limit_counters" USING btree ("key","window_start");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "security_rate_limit_counters_pk" ON "security_rate_limit_counters" USING btree ("key","window_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tos_acceptances_user_id" ON "tos_acceptances" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_wallet_chargeback_event_id" ON "wallet_chargeback_events" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wce_original_tx" ON "wallet_chargeback_events" USING btree ("original_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wce_wallet" ON "wallet_chargeback_events" USING btree ("wallet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wce_status" ON "wallet_chargeback_events" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_wallet_topup_callback_event_id" ON "wallet_topup_callback_events" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wtce_pending_tx" ON "wallet_topup_callback_events" USING btree ("pending_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wtce_wallet" ON "wallet_topup_callback_events" USING btree ("wallet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_tx_wallet_id" ON "wallet_transactions" USING btree ("wallet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_tx_state" ON "wallet_transactions" USING btree ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_tx_type" ON "wallet_transactions" USING btree ("type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wallet_tx_idempotency" ON "wallet_transactions" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_wallet_tx_receipt_attachment" ON "wallet_transactions" USING btree ("receipt_attachment_key") WHERE "wallet_transactions"."receipt_attachment_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_wallet_tx_reverses_transaction" ON "wallet_transactions" USING btree ("reverses_transaction_id") WHERE "wallet_transactions"."reverses_transaction_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_tx_online_pending_created" ON "wallet_transactions" USING btree ("created_at","id") WHERE "wallet_transactions"."type" = 'topup' AND "wallet_transactions"."state" = 'Pending' AND ("wallet_transactions"."metadata"->>'channel') = 'online';
