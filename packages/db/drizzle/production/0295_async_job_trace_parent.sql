ALTER TABLE "async_jobs" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "async_jobs" ADD CONSTRAINT "async_jobs_trace_parent_valid" CHECK ("async_jobs"."trace_parent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
        AND substring("async_jobs"."trace_parent", 4, 32) <> repeat('0', 32)
        AND substring("async_jobs"."trace_parent", 37, 16) <> repeat('0', 16));--> statement-breakpoint
CREATE FUNCTION preserve_async_job_trace_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trace_parent IS DISTINCT FROM OLD.trace_parent THEN
    RAISE EXCEPTION 'Async job trace context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER async_jobs_preserve_trace_parent BEFORE UPDATE OF trace_parent ON async_jobs
 FOR EACH ROW EXECUTE FUNCTION preserve_async_job_trace_parent();
