CREATE TABLE "contract_cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"preferred_destination" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"resolved_by" text,
	"resolution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "cancellation_requests_reason" CHECK (length(trim("contract_cancellation_requests"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "cancellation_requests_destination" CHECK ("contract_cancellation_requests"."preferred_destination" IN ('wallet','external_bank')),
	CONSTRAINT "cancellation_requests_resolution" CHECK (("contract_cancellation_requests"."status"='Pending' AND "contract_cancellation_requests"."resolved_by" IS NULL AND "contract_cancellation_requests"."resolution_reason" IS NULL AND "contract_cancellation_requests"."resolved_at" IS NULL) OR ("contract_cancellation_requests"."status" IN ('Rejected','Fulfilled') AND "contract_cancellation_requests"."resolved_by" IS NOT NULL AND "contract_cancellation_requests"."resolved_at" IS NOT NULL AND "contract_cancellation_requests"."resolution_reason" IS NOT NULL AND length(trim("contract_cancellation_requests"."resolution_reason")) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
ALTER TABLE "contract_cancellation_intents" ADD COLUMN "customer_request_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_cancellation_requests" ADD CONSTRAINT "contract_cancellation_requests_requested_by_users_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_cancellation_requests" ADD CONSTRAINT "contract_cancellation_requests_resolved_by_users_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_cancellation_requests" ADD CONSTRAINT "cancellation_requests_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_requests_pending_unique" ON "contract_cancellation_requests" USING btree ("contract_id") WHERE "contract_cancellation_requests"."status"='Pending';--> statement-breakpoint
CREATE INDEX "cancellation_requests_contract_created_idx" ON "contract_cancellation_requests" USING btree ("contract_id","created_at");--> statement-breakpoint
ALTER TABLE "contract_cancellation_intents" ADD CONSTRAINT "contract_cancellation_intents_customer_request_id_contract_cancellation_requests_id_fk" FOREIGN KEY ("customer_request_id") REFERENCES "public"."contract_cancellation_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_contract_cancellation_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancellation requests are retained' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract missing' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'Pending' OR c.state IN ('Cancelled','Completed') OR c.current_version_id<>NEW.version_id
      OR NOT EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=c.id AND version_id=NEW.version_id)
      OR EXISTS(SELECT 1 FROM profiles WHERE id=c.profile_id AND archived)
    THEN RAISE EXCEPTION 'Request requires a current published nonterminal contract' USING ERRCODE='23514'; END IF;
    NEW.created_at:=now();
  ELSE
    IF OLD.status<>'Pending' OR NEW.status NOT IN ('Rejected','Fulfilled') OR
      (to_jsonb(NEW)-ARRAY['status','resolved_by','resolution_reason','resolved_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','resolved_by','resolution_reason','resolved_at'])
    THEN RAISE EXCEPTION 'Only a pending request can be resolved; request evidence is immutable' USING ERRCODE='23514'; END IF;
    IF NEW.status='Rejected' AND c.state IN ('Cancelled','Completed') THEN
      RAISE EXCEPTION 'Terminal contract requests cannot be rejected' USING ERRCODE='23514';
    END IF;
    IF NEW.status='Fulfilled' AND NOT EXISTS (
      SELECT 1 FROM contract_cancellations e JOIN contract_cancellation_intents i ON i.id=e.intent_id
      WHERE e.contract_id=NEW.contract_id AND i.customer_request_id=NEW.id
        AND e.executed_by=NEW.resolved_by AND i.reason=NEW.resolution_reason
    ) THEN RAISE EXCEPTION 'Fulfillment requires the bound executed cancellation' USING ERRCODE='23514'; END IF;
    NEW.resolved_at:=now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cancellation_request_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_cancellation_requests
FOR EACH ROW EXECUTE FUNCTION guard_contract_cancellation_request();
--> statement-breakpoint
CREATE FUNCTION guard_cancellation_customer_request_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_id uuid; bound_version uuid;
BEGIN
  IF TG_TABLE_NAME='contract_cancellation_intents' THEN
    request_id:=NEW.customer_request_id; bound_version:=NEW.version_id;
  ELSE
    SELECT i.customer_request_id,i.version_id INTO request_id,bound_version FROM contract_cancellation_intents i WHERE i.id=NEW.intent_id;
  END IF;
  IF request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contract_cancellation_requests r
    WHERE r.id=request_id AND r.contract_id=NEW.contract_id AND r.version_id=bound_version AND r.status='Pending'
  ) THEN RAISE EXCEPTION 'Customer request is no longer pending for this contract version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cancellation_intent_customer_request_guard BEFORE INSERT ON contract_cancellation_intents
FOR EACH ROW EXECUTE FUNCTION guard_cancellation_customer_request_binding();
--> statement-breakpoint
CREATE TRIGGER cancellation_execution_customer_request_guard BEFORE INSERT ON contract_cancellations
FOR EACH ROW EXECUTE FUNCTION guard_cancellation_customer_request_binding();
--> statement-breakpoint
CREATE FUNCTION fulfill_cancellation_customer_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE contract_cancellation_requests r SET status='Fulfilled',resolved_by=NEW.executed_by,
    resolution_reason=i.reason,resolved_at=now()
  FROM contract_cancellation_intents i WHERE i.id=NEW.intent_id AND r.id=i.customer_request_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cancellation_execution_fulfill_request AFTER INSERT ON contract_cancellations
FOR EACH ROW EXECUTE FUNCTION fulfill_cancellation_customer_request();
