import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Staff roles table (T-05.03.02 / T-09.05.01).
 *
 * Predefined roles determine permissions across CRM, finance, legal,
 * operations, and admin functions. Permissions are deny-by-default,
 * additive by role.
 *
 * - `role_id` — UUIDv7 primary key.
 * - `name` — human-readable role name (unique).
 * - `description` — role description for the UI.
 * - `permissions` — JSON array of permission strings.
 * - `created_at` — when the role was created.
 * - `updated_at` — last update timestamp.
 */
export const staffRoles = pgTable('staff_roles', {
  roleId: text('role_id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  permissions: text('permissions').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
})

/**
 * User-role assignments (T-05.03.02).
 *
 * Many-to-many link table connecting staff users to their roles.
 * A staff user can hold multiple roles.
 */
export const userRoles = pgTable('user_roles', {
  userId: text('user_id').notNull(),
  roleId: text('role_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
})

/**
 * Predefined staff roles with their permission sets.
 * Permissions are deny-by-default, additive by role.
 */
export const PREDEFINED_ROLES = [
  {
    id: 'role-customer-support',
    name: 'Customer Support',
    description: 'Handle customer inquiries, complaints, and support tickets.',
    permissions: [
      'tickets:read',
      'tickets:write',
      'users:read',
      'profiles:read',
    ],
  },
  {
    id: 'role-crm-verification',
    name: 'CRM & Verification',
    description: 'Manage customer relationships, verification of profiles and addresses.',
    permissions: [
      'crm:read',
      'crm:write',
      'verification:read',
      'verification:write',
      'profiles:read',
      'profiles:write',
    ],
  },
  {
    id: 'role-finance',
    name: 'Finance',
    description: 'Manage billing, invoices, payments, and financial reports.',
    permissions: [
      'finance:read',
      'finance:write',
      'invoices:read',
      'invoices:write',
      'payments:read',
      'payments:write',
      'reports:read',
    ],
  },
  {
    id: 'role-legal-contracts',
    name: 'Legal & Contracts',
    description: 'Manage legal documents, contracts, and compliance.',
    permissions: [
      'legal:read',
      'legal:write',
      'contracts:read',
      'contracts:write',
      'compliance:read',
    ],
  },
  {
    id: 'role-operations',
    name: 'Operations',
    description: 'Manage operational workflows, orders, and service delivery.',
    permissions: [
      'operations:read',
      'operations:write',
      'orders:read',
      'orders:write',
      'scheduling:read',
      'scheduling:write',
    ],
  },
  {
    id: 'role-admin',
    name: 'Admin',
    description: 'Full system access with all administrative privileges.',
    permissions: [
      'admin:users:create',
      'admin:users:edit',
      'admin:roles:edit',
      'admin:config:read',
      'admin:config:write',
      '*',
    ],
  },
] as const

/**
 * SQL to create the staff_roles and user_roles tables with
 * predefined roles inserted idempotently.
 */
export const createStaffRolesTable = (): string => {
  const inserts = PREDEFINED_ROLES.map(
    (r) =>
      `(${[
        `'${r.id}'`,
        `'${r.name.replace(/'/g, "''")}'`,
        `'${r.description.replace(/'/g, "''")}'`,
        `'${JSON.stringify(r.permissions)}'`,
      ].join(', ')})`,
  ).join(',\n    ')

  return `
    CREATE TABLE IF NOT EXISTS staff_roles (
      role_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);

    -- Insert predefined roles idempotently
    INSERT INTO staff_roles (role_id, name, description, permissions)
    VALUES
      ${inserts}
    ON CONFLICT (role_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      permissions = EXCLUDED.permissions;
  `
}