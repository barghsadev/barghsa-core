-- Migration 0011: Create ticket_comments table (T-06.01.02)
--
-- Creates the ticket comments table for conversation threads on support
-- tickets. Each comment has a visibility flag:
--   - 'public'   — visible to the customer who owns the ticket
--   - 'internal' — staff-only notes, hidden from the customer
--
-- Customers see only public comments. Staff can see and add both.
--
-- Rollback:
--   DROP TABLE IF EXISTS ticket_comments CASCADE;

CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_author_id ON ticket_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_visibility ON ticket_comments (visibility);