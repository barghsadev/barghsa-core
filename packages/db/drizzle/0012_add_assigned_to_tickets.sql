-- Migration 0012: add assigned_to column to tickets table
-- T-06.01.03 Staff ticket management — tracks which staff member is assigned.

ALTER TABLE tickets
  ADD COLUMN assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets (assigned_to);