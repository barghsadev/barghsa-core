CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"kb_id" uuid NOT NULL,
	"document_id" uuid,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "source_type" text DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "source_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "content_state" text DEFAULT 'empty' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "content_error" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "chunking_strategy" jsonb DEFAULT '{"size":800,"overlap":100}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "vector_embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "is_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_kb_id" ON "kb_chunks" USING btree ("kb_id");--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_document_id" ON "kb_chunks" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_embedding" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "kb_source_type_valid" CHECK (source_type IN ('document', 'url', 'api'));
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "kb_content_state_valid" CHECK (content_state IN ('empty', 'processing', 'ready', 'error'));
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "kb_chunking_strategy_valid" CHECK (
  jsonb_typeof(chunking_strategy)='object'
  AND jsonb_typeof(chunking_strategy->'size')='number'
  AND jsonb_typeof(chunking_strategy->'overlap')='number'
  AND (chunking_strategy->>'size')::int BETWEEN 100 AND 4000
  AND (chunking_strategy->>'overlap')::int BETWEEN 0 AND 1000
  AND (chunking_strategy->>'overlap')::int < (chunking_strategy->>'size')::int
);
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "kb_enabled_requires_ready" CHECK (NOT is_enabled OR content_state='ready');
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunk_index_nonnegative" CHECK (chunk_index >= 0);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunk_content_nonempty" CHECK (length(trim(content)) > 0);
