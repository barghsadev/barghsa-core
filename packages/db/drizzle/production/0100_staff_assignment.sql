-- New work can be assigned without changing existing cases or ticket assignments.
ALTER TABLE verification_cases ADD COLUMN assigned_to text REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE verification_cases ADD COLUMN assigned_team_id uuid REFERENCES staff_teams(id) ON DELETE SET NULL;
CREATE TABLE staff_assignment_cursors (
  team_id uuid NOT NULL REFERENCES staff_teams(id) ON DELETE CASCADE,
  work_type text NOT NULL CHECK(work_type IN ('ticket','verification_case')),
  last_user_id text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,work_type)
);
CREATE INDEX verification_cases_assigned_open_idx ON verification_cases(assigned_to) WHERE status IN ('Open','Under Review');
CREATE INDEX tickets_assigned_open_idx ON tickets(assigned_to) WHERE status NOT IN ('resolved','closed');
