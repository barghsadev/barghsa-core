/**
 * Admin-configuration contracts shared by the API (admin config surface) and
 * the worker — service response targets, staff teams / assignment rules, and
 * service escalation policy (S-09.08, T-09.08.01 + T-09.08.02 + T-09.08.03).
 *
 * @module admin
 */
export * from './service-response-targets.js'
export * from './staff-teams.js'
export * from './escalation-policy.js'
export * from './reconciliation-exceptions.js'
