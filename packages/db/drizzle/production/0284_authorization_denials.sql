CREATE TABLE "authorization_denials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"resource" varchar(256) NOT NULL,
	"action" varchar(32) NOT NULL,
	"reason" varchar(96) NOT NULL,
	"correlation_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "authorization_denials_timeline_idx" ON "authorization_denials" USING btree ("created_at","id");
--> statement-breakpoint
CREATE FUNCTION reject_authorization_denial_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'authorization_denials is append-only' USING ERRCODE='55000';
END $$;
--> statement-breakpoint
CREATE TRIGGER authorization_denials_immutable_row BEFORE UPDATE OR DELETE ON authorization_denials
  FOR EACH ROW EXECUTE FUNCTION reject_authorization_denial_mutation();
--> statement-breakpoint
CREATE TRIGGER authorization_denials_immutable_truncate BEFORE TRUNCATE ON authorization_denials
  FOR EACH STATEMENT EXECUTE FUNCTION reject_authorization_denial_mutation();
