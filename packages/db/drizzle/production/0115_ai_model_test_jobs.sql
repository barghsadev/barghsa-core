-- Short-lived worker requests contain model references, never copied API tokens.
CREATE TABLE IF NOT EXISTS ai_model_test_jobs (
  id uuid PRIMARY KEY,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  model_revision text NOT NULL,
  actor_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  deadline_at timestamptz NOT NULL,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_model_test_status CHECK (status IN ('pending','leased','completed','failed','cancelled')),
  CONSTRAINT ai_model_test_attempts CHECK (attempts BETWEEN 0 AND 2),
  CONSTRAINT ai_model_test_lease CHECK ((status='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'leased' AND lease_token IS NULL AND lease_until IS NULL)),
  CONSTRAINT ai_model_test_result CHECK ((status='completed') = (result IS NOT NULL)),
  CONSTRAINT ai_model_test_deadline CHECK (deadline_at > created_at)
);
CREATE INDEX IF NOT EXISTS ai_model_test_due_idx ON ai_model_test_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS ai_model_test_model_idx ON ai_model_test_jobs(model_id);
CREATE INDEX IF NOT EXISTS ai_model_test_actor_idx ON ai_model_test_jobs(actor_user_id);
