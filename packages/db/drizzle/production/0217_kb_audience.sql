ALTER TABLE "knowledge_bases" ADD COLUMN "audience" text DEFAULT 'admin' NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "chk_kb_audience"
  CHECK ("audience" IN ('admin', 'staff', 'customer', 'public'));
