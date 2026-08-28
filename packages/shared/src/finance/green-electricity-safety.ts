/**
 * Mandatory green-electricity activation safety (S-09.10, T-09.10.03).
 *
 * The green-electricity rule (T-09.10.02) is only enforceable while the
 * system `green_electricity` product is active and priced. This module
 * centralizes the fail-closed evaluation consumed by:
 *
 *  - the admin config write path (block activation with a clear reason), and
 *  - the ordering flow's enforcement seam (fail closed — refuse to apply a
 *    mandatory-green rule the product cannot actually satisfy).
 *
 * Fail-closed policy: a rule that is enabled (`isGreenRuleActive`) but whose
 * green product is not activatable MUST NOT be silently enforced. `blocked`
 * is true exactly when the rule is active and the product is not activatable,
 * so callers (ordering, UI alerts) treat that state as "ordering is blocked"
 * rather than "rule silently ignored".
 *
 * @module finance
 */
import {
  isGreenRuleActive,
  type GreenElectricityConfig,
  type GreenElectricityOrderMode,
} from './green-electricity-config.js'

/** System `system_key` of the green electricity product (T-03.01.02 seed). */
export const GREEN_ELECTRICITY_SYSTEM_KEY = 'green_electricity'

/** Categorised reason a green product cannot support an activated rule. */
export type GreenProductBlockReason =
  | 'missing'
  | 'inactive'
  | 'archived'
  | 'unpriced'

/**
 * Observable state of the system green electricity product that determines
 * whether the mandatory-green rule can be activated / enforced.
 */
export interface GreenElectricityProductState {
  /** Whether a product row with `system_key = 'green_electricity'` exists. */
  exists: boolean
  /** `products.status` value, or `null` when no row exists. */
  status: 'active' | 'inactive' | 'archived' | null
  /** `products.price` in IRR, or `null`/`0` when unpriced. */
  priceIrR: number | null
}

/**
 * The reasons the green product cannot currently support an activated
 * mandatory-green rule (English, matching the T-09.10.03 UI wording
 * "Cannot activate: Green electricity product is [inactive/unpriced]").
 * Empty array means the product IS activatable.
 */
export function greenProductBlockReasons(
  product: GreenElectricityProductState,
): GreenProductBlockReason[] {
  if (!product.exists) return ['missing']
  const reasons: GreenProductBlockReason[] = []
  if (product.status === 'inactive') reasons.push('inactive')
  else if (product.status === 'archived') reasons.push('archived')
  if (product.priceIrR === null || product.priceIrR <= 0) reasons.push('unpriced')
  return reasons
}

/** Whether the green product can currently support an activated rule. */
export function isGreenProductActivatable(
  product: GreenElectricityProductState,
): boolean {
  return greenProductBlockReasons(product).length === 0
}

/** Per-order-mode enforcement state, failing closed on an unsupported rule. */
export interface GreenRuleEnforcement {
  /** Whether the mandatory-green rule is active (enabled) for this mode. */
  ruleActive: boolean
  /**
   * Fail-closed flag: true when the rule is active but the green product is
   * not activatable. Callers MUST treat this as "ordering must be blocked"
   * (never silently ignore the rule).
   */
  blocked: boolean
  /** Human-readable reasons the product is not activatable (empty when ok). */
  reasons: GreenProductBlockReason[]
}

/**
 * Evaluate the enforcement state for one order mode given the current green
 * config and green product state. Consumes the `isGreenRuleActive` seam; a
 * rule that is enabled while the product is not activatable yields
 * `blocked: true` (fail-closed).
 */
export function evaluateGreenRuleEnforcement(
  config: GreenElectricityConfig,
  mode: GreenElectricityOrderMode,
  product: GreenElectricityProductState,
): GreenRuleEnforcement {
  const ruleActive = isGreenRuleActive(config, mode)
  const reasons = greenProductBlockReasons(product)
  return { ruleActive, blocked: ruleActive && reasons.length > 0, reasons }
}
