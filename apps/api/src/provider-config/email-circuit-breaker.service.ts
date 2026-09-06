import { Injectable, Inject, Optional } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { EmailCircuitBreaker, type EmailBreakerConfig, type Clock } from '@barghsa/shared/notification-delivery'
import { PROVIDER_CONFIG_POOL, type ProviderPool } from './provider-config.di'
export { DEFAULT_EMAIL_BREAKER_CONFIG } from '@barghsa/shared/notification-delivery'
export type { EmailBreakerConfig, EmailBreakerState, EmailBreakerDecision, EmailBreakerOutcome, Clock } from '@barghsa/shared/notification-delivery'

@Injectable()
export class EmailCircuitBreakerService extends EmailCircuitBreaker {
  constructor(@Optional() @Inject(PROVIDER_CONFIG_POOL) pool?: ProviderPool,
    @Optional() config?: EmailBreakerConfig, @Optional() clock?: Clock) {
    // Resolve the normal pool lazily, after application database initialization.
    super(pool ?? { query: (sql, params) => getDbPool().query(sql, params) }, config, clock)
  }
}
