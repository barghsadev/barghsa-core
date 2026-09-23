CREATE TABLE "electricity_order_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"visibility" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_order_comments_visibility" CHECK ("electricity_order_comments"."visibility" IN ('public','internal')),
	CONSTRAINT "electricity_order_comments_body" CHECK (length(trim("electricity_order_comments"."body")) BETWEEN 1 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "electricity_order_comments" ADD CONSTRAINT "electricity_order_comments_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_order_comments" ADD CONSTRAINT "electricity_order_comments_author_user_id_users_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "electricity_order_comments_order_idx" ON "electricity_order_comments" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE INDEX "electricity_order_comments_recent_idx" ON "electricity_order_comments" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE FUNCTION prevent_electricity_order_comment_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Electricity order comments are append-only' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_order_comment_immutable
BEFORE UPDATE OR DELETE ON electricity_order_comments
FOR EACH ROW EXECUTE FUNCTION prevent_electricity_order_comment_edit();
