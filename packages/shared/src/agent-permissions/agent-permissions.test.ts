import { describe, it, expect } from 'vitest'
import {
  AGENT_ROLES,
  hasPermission,
  getRolePermissions,
  getCombinedPermissions,
  hasAnyRolePermission,
} from './index.js'

describe('agent-permissions', () => {
  describe('role vocabulary', () => {
    it('exposes the four canonical roles', () => {
      expect([...AGENT_ROLES].sort()).toEqual(['Finance', 'Legal', 'Manager', 'Owner'].sort())
    })
  })

  describe('hasPermission', () => {
    it('Owner has every permission', () => {
      // Spot-checks across the matrix
      expect(hasPermission('Owner', 'profile:edit')).toBe(true)
      expect(hasPermission('Owner', 'profile:transfer-ownership')).toBe(true)
      expect(hasPermission('Owner', 'contracts:sign')).toBe(true)
      expect(hasPermission('Owner', 'wallet:move-funds')).toBe(true)
    })

    it('Manager has operational access but NOT ownership/transfer or protected-field edits', () => {
      expect(hasPermission('Manager', 'orders:create')).toBe(true)
      expect(hasPermission('Manager', 'addresses:edit')).toBe(true)
      expect(hasPermission('Manager', 'agents:invite')).toBe(true)
      expect(hasPermission('Manager', 'agents:remove')).toBe(true)
      // Cannot transfer ownership or edit protected identity fields
      expect(hasPermission('Manager', 'profile:transfer-ownership')).toBe(false)
      expect(hasPermission('Manager', 'profile:edit-protected-fields')).toBe(false)
      expect(hasPermission('Manager', 'wallet:move-funds')).toBe(false)
    })

    it('Finance has wallet/invoice access but CANNOT sign contracts or move funds', () => {
      expect(hasPermission('Finance', 'invoices:view')).toBe(true)
      expect(hasPermission('Finance', 'wallet:charge')).toBe(true)
      expect(hasPermission('Finance', 'bank-receipts:submit')).toBe(true)
      expect(hasPermission('Finance', 'refunds:view')).toBe(true)
      // Cannot sign contracts, cannot move wallet funds
      expect(hasPermission('Finance', 'contracts:sign')).toBe(false)
      expect(hasPermission('Finance', 'wallet:move-funds')).toBe(false)
      expect(hasPermission('Finance', 'orders:create')).toBe(false)
    })

    it('Legal can view/sign/reject contracts but CANNOT move wallet funds or run operations', () => {
      expect(hasPermission('Legal', 'contracts:view')).toBe(true)
      expect(hasPermission('Legal', 'contracts:sign')).toBe(true)
      expect(hasPermission('Legal', 'contracts:reject')).toBe(true)
      expect(hasPermission('Legal', 'contracts:request-changes')).toBe(true)
      // Cannot move wallet funds, cannot create orders
      expect(hasPermission('Legal', 'wallet:move-funds')).toBe(false)
      expect(hasPermission('Legal', 'orders:create')).toBe(false)
      expect(hasPermission('Legal', 'wallet:charge')).toBe(false)
    })

    it('Legal cannot accept/sign in the Finance sense nor move funds', () => {
      expect(hasPermission('Legal', 'wallet:view')).toBe(false)
    })
  })

  describe('getRolePermissions', () => {
    it('returns the exact permission set for a given role', () => {
      const legal = getRolePermissions('Legal')
      expect(legal).toEqual(
        expect.arrayContaining(['contracts:view', 'contracts:sign', 'contracts:reject']),
      )
      expect(legal).not.toContain('wallet:move-funds')
    })
  })

  describe('additive roles', () => {
    it('combines permissions across multiple roles (Manager + Finance)', () => {
      const combined = getCombinedPermissions(['Manager', 'Finance'])
      expect(combined.has('orders:create')).toBe(true) // from Manager
      expect(combined.has('wallet:charge')).toBe(true) // from Finance
      // Still no ownership transfer
      expect(combined.has('profile:transfer-ownership')).toBe(false)
    })

    it('hasAnyRolePermission returns true if any role grants the permission', () => {
      expect(hasAnyRolePermission(['Finance', 'Legal'], 'contracts:sign')).toBe(true)
      expect(hasAnyRolePermission(['Finance', 'Legal'], 'wallet:charge')).toBe(true)
      expect(hasAnyRolePermission(['Finance', 'Legal'], 'orders:create')).toBe(false)
    })
  })
})