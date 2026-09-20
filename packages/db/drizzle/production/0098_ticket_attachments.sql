-- Existing tickets remain readable with an empty attachment list.
ALTER TABLE tickets ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tickets ADD CONSTRAINT tickets_attachments_array CHECK (jsonb_typeof(attachments)='array' AND jsonb_array_length(attachments)<=5);
