-- Migration 0010: Create tickets table (T-06.01.01)
--
-- Creates the support tickets table for customer-facing ticket creation.
-- Tickets are scoped to users, optionally linked to profiles and related
-- entities (orders, contracts, invoices). File attachments are handled
-- separately via the upload module and linked by storage key.
--
-- Rollback:
--   DROP TABLE IF EXISTS tickets CASCADE;

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    related_entity_type TEXT CHECK (related_entity_type IN ('order', 'contract', 'invoice')),
    related_entity_id TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_profile_id ON tickets (profile_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets (priority);