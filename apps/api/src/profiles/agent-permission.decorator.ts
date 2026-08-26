import { SetMetadata } from '@nestjs/common'
import type { AgentPermission } from '@barghsa/shared/agent-permissions'

/**
 * Metadata key used to attach the required agent permission to a route.
 */
export const AGENT_PERMISSION_KEY = 'barghsa:agent-permission'

/**
 * Declare the agent permission required to access a route handler or
 * controller. Read by the {@link AgentRoleGuard}.
 *
 * Usage:
 * ```ts
 * @UseGuards(SessionAuthGuard, AgentRoleGuard)
 * @RequireAgentPermission('orders:create')
 * @Post()
 * async createOrder(...) { ... }
 * ```
 */
export const RequireAgentPermission = (permission: AgentPermission) =>
  SetMetadata(AGENT_PERMISSION_KEY, permission)