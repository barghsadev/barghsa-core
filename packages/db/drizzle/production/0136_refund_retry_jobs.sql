CREATE TABLE "refund_retry_jobs" (
	"refund_id" uuid PRIMARY KEY NOT NULL,
	"executor_user_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"last_error_code" text,
	"exhausted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_retry_jobs_attempts" CHECK ("refund_retry_jobs"."max_attempts" BETWEEN 1 AND 20 AND "refund_retry_jobs"."attempts" BETWEEN 0 AND "refund_retry_jobs"."max_attempts"),
	CONSTRAINT "refund_retry_jobs_terminal" CHECK (NOT ("refund_retry_jobs"."completed_at" IS NOT NULL AND "refund_retry_jobs"."exhausted_at" IS NOT NULL) AND (("refund_retry_jobs"."completed_at" IS NULL AND "refund_retry_jobs"."exhausted_at" IS NULL) = ("refund_retry_jobs"."next_attempt_at" IS NOT NULL)) AND ("refund_retry_jobs"."exhausted_at" IS NULL OR "refund_retry_jobs"."attempts" = "refund_retry_jobs"."max_attempts"))
);
--> statement-breakpoint
ALTER TABLE "refund_retry_jobs" ADD CONSTRAINT "refund_retry_jobs_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_retry_jobs" ADD CONSTRAINT "refund_retry_jobs_executor_user_id_users_user_id_fk" FOREIGN KEY ("executor_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_retry_jobs_due_idx" ON "refund_retry_jobs" USING btree ("next_attempt_at","refund_id") WHERE "refund_retry_jobs"."next_attempt_at" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER refund_retry_jobs_updated_at BEFORE UPDATE ON refund_retry_jobs
FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
--> statement-breakpoint
CREATE FUNCTION guard_refund_retry_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refund processing history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM refunds WHERE id=NEW.refund_id AND destination='wallet' AND state IN ('Processing','Failed')) THEN
      RAISE EXCEPTION 'Only processing wallet refunds can be queued' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.refund_id,NEW.executor_user_id,NEW.max_attempts,NEW.created_at) IS DISTINCT FROM
       ROW(OLD.refund_id,OLD.executor_user_id,OLD.max_attempts,OLD.created_at) OR NEW.attempts < OLD.attempts THEN
      RAISE EXCEPTION 'Refund processing identity and attempt history are immutable' USING ERRCODE = '23514';
    END IF;
    IF (OLD.completed_at IS NOT NULL OR OLD.exhausted_at IS NOT NULL) AND
       ROW(NEW.attempts,NEW.next_attempt_at,NEW.completed_at,NEW.exhausted_at,NEW.last_error_code) IS DISTINCT FROM
       ROW(OLD.attempts,OLD.next_attempt_at,OLD.completed_at,OLD.exhausted_at,OLD.last_error_code) THEN
      RAISE EXCEPTION 'Finished refund jobs cannot be reopened' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refunds WHERE id=NEW.refund_id AND state='Completed') THEN
    RAISE EXCEPTION 'Completed jobs require a completed refund' USING ERRCODE = '23514';
  END IF;
  IF NEW.exhausted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refunds WHERE id=NEW.refund_id AND state='Failed') THEN
    RAISE EXCEPTION 'Exhausted jobs require a failed refund' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refund_retry_jobs_identity BEFORE INSERT OR UPDATE OR DELETE ON refund_retry_jobs
FOR EACH ROW EXECUTE FUNCTION guard_refund_retry_job();
