ALTER TABLE "ai_model_test_jobs" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "document_scan_jobs" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "ai_model_test_jobs" ADD CONSTRAINT "ai_model_test_jobs_trace_parent_valid" CHECK ("ai_model_test_jobs"."trace_parent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
        AND substring("ai_model_test_jobs"."trace_parent", 4, 32) <> repeat('0', 32)
        AND substring("ai_model_test_jobs"."trace_parent", 37, 16) <> repeat('0', 16));--> statement-breakpoint
ALTER TABLE "auth_delivery_outbox" ADD CONSTRAINT "auth_delivery_outbox_trace_parent_valid" CHECK ("auth_delivery_outbox"."trace_parent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
        AND substring("auth_delivery_outbox"."trace_parent", 4, 32) <> repeat('0', 32)
        AND substring("auth_delivery_outbox"."trace_parent", 37, 16) <> repeat('0', 16));--> statement-breakpoint
ALTER TABLE "document_scan_jobs" ADD CONSTRAINT "document_scan_jobs_trace_parent_valid" CHECK ("document_scan_jobs"."trace_parent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
        AND substring("document_scan_jobs"."trace_parent", 4, 32) <> repeat('0', 32)
        AND substring("document_scan_jobs"."trace_parent", 37, 16) <> repeat('0', 16));--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_trace_parent_valid" CHECK ("knowledge_bases"."trace_parent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
        AND substring("knowledge_bases"."trace_parent", 4, 32) <> repeat('0', 32)
        AND substring("knowledge_bases"."trace_parent", 37, 16) <> repeat('0', 16));--> statement-breakpoint
CREATE FUNCTION preserve_specialized_queue_trace_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trace_parent IS DISTINCT FROM OLD.trace_parent THEN
    RAISE EXCEPTION 'Queue trace context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ai_model_test_jobs_preserve_trace_parent BEFORE UPDATE OF trace_parent ON ai_model_test_jobs
 FOR EACH ROW EXECUTE FUNCTION preserve_specialized_queue_trace_parent();--> statement-breakpoint
CREATE TRIGGER auth_delivery_outbox_preserve_trace_parent BEFORE UPDATE OF trace_parent ON auth_delivery_outbox
 FOR EACH ROW EXECUTE FUNCTION preserve_specialized_queue_trace_parent();--> statement-breakpoint
CREATE TRIGGER document_scan_jobs_preserve_trace_parent BEFORE UPDATE OF trace_parent ON document_scan_jobs
 FOR EACH ROW EXECUTE FUNCTION preserve_specialized_queue_trace_parent();
