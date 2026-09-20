-- Team attribution is optional; removing a team preserves the ticket and assigned user.
ALTER TABLE tickets ADD COLUMN assigned_team_id uuid REFERENCES staff_teams(id) ON DELETE SET NULL;
CREATE INDEX tickets_assigned_team_idx ON tickets(assigned_team_id) WHERE assigned_team_id IS NOT NULL;
