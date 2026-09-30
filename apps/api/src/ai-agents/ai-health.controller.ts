import { Controller, Get, HttpException, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { aiInferenceQueue, type AiInferenceQueueSnapshot } from './ai-inference-queue.js';
import { readAiWorkerHealth } from './ai-inference-client.js';

interface CircuitRow {
  id: string;
  is_enabled: boolean;
  degraded: boolean;
  cooldown_until: Date | null;
}

interface AiHealth {
  status: 'ok' | 'saturated' | 'unavailable';
  queue: AiInferenceQueueSnapshot;
  worker: Awaited<ReturnType<typeof readAiWorkerHealth>>;
  models: Array<{ id: string; status: 'disabled' | 'closed' | 'open' | 'probe_ready' }>;
}

/** Staff-only AI capacity view; core readiness never invokes this component. */
@ApiTags('Admin · AI Health')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/ai/health')
export class AiHealthController {
  @Get()
  @ApiOperation({ summary: 'Inspect AI queue capacity and model circuit status' })
  async health(@Req() req: AuthenticatedRequest): Promise<AiHealth> {
    if (!hasStaffPermission(req, 'admin:ai:models'))
      throw new HttpException({ statusCode: 403, error: 'AUTHZ:FORBIDDEN' }, 403);
    const queue = aiInferenceQueue.snapshot();
    const [circuits, worker] = await Promise.all([
      getDbPool().query<CircuitRow>(
        `SELECT m.id,m.is_enabled,COALESCE(s.degraded,false) AS degraded,s.cooldown_until
       FROM ai_models m LEFT JOIN ai_model_circuit_states s ON s.id=m.id ORDER BY m.id`
      ),
      readAiWorkerHealth(),
    ]);
    const now = Date.now();
    return {
      status:
        worker.status === 'unavailable'
          ? 'unavailable'
          : queue.saturated || worker.saturated
            ? 'saturated'
            : 'ok',
      queue,
      worker,
      models: circuits.rows.map((row) => ({
        id: row.id,
        status: !row.is_enabled
          ? 'disabled'
          : !row.degraded
            ? 'closed'
            : row.cooldown_until && new Date(row.cooldown_until).getTime() <= now
              ? 'probe_ready'
              : 'open',
      })),
    };
  }
}
