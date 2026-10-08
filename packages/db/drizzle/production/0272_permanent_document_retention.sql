-- Financial purchase records and contractual bytes are retained permanently,
-- independently of parent closure, policy duration, holds or old approvals.
CREATE FUNCTION document_is_permanently_retained(p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT d.business_record_type IN ('contract','invoice','order')
      OR d.category='contract'
      OR EXISTS (SELECT 1 FROM contract_documents cd WHERE cd.document_id=d.id)
      OR EXISTS (SELECT 1 FROM contract_document_locks l WHERE l.document_id=d.id)
      OR EXISTS (SELECT 1 FROM solar_construction_requests s
        WHERE d.business_record_type='solar_request' AND s.id=d.business_record_id
          AND s.contract_id IS NOT NULL)
    FROM documents d WHERE d.id=p_document_id
  ), true);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION document_retention_eligibility(p_document_id uuid)
RETURNS TABLE(policy_id uuid, retention_deadline timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT p.id,
    (CASE
      WHEN d.business_record_type='standalone' THEN d.removed_at
      WHEN d.business_record_type='solar_request' AND s.status IN ('rejected','cancelled')
        THEN GREATEST(d.removed_at,s.updated_at)
    END) + p.retention_years * interval '1 year'
  FROM documents d
  JOIN LATERAL (
    SELECT policy.id,policy.retention_years FROM document_retention_policies policy
    WHERE policy.business_record_type=d.business_record_type::text
      AND policy.effective_date<=now()
    ORDER BY policy.effective_date DESC,policy.id DESC LIMIT 1
  ) p ON true
  LEFT JOIN solar_construction_requests s ON d.business_record_type='solar_request'
    AND s.id=d.business_record_id
  WHERE d.id=p_document_id AND d.state='Removed'
    AND NOT document_is_permanently_retained(d.id);
$$;
--> statement-breakpoint
-- Cancel prior manifests without erasing their approvals, attempts or history.
WITH cancelled AS (
  UPDATE document_destruction_items SET status='cancelled',
    last_error='permanent_retention',updated_at=NOW()
  WHERE status IN ('pending_approval','approved','destroying')
    AND document_is_permanently_retained(document_id)
  RETURNING id,document_id
)
INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
SELECT uuid_generate_v7(),d.uploaded_by,'document_destruction_cancelled',
  jsonb_build_object('itemId',c.id,'documentId',d.id,'reason','permanent_retention'),
  uuid_generate_v7(),'migration'
FROM cancelled c JOIN documents d ON d.id=c.document_id;
--> statement-breakpoint
CREATE FUNCTION guard_permanent_document_destruction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('pending_approval','approved','destroying','destroyed')
    AND document_is_permanently_retained(NEW.document_id) THEN
    RAISE EXCEPTION 'Financial and contractual documents are retained permanently'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_permanent_destruction_guard
  BEFORE INSERT OR UPDATE ON document_destruction_items
  FOR EACH ROW EXECUTE FUNCTION guard_permanent_document_destruction();
--> statement-breakpoint
CREATE FUNCTION guard_permanent_document_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage_key IS NOT NULL AND NEW.storage_key IS NULL
    AND document_is_permanently_retained(OLD.id) THEN
    RAISE EXCEPTION 'Financial and contractual document bytes are retained permanently'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_00_permanent_bytes_guard
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION guard_permanent_document_bytes();
