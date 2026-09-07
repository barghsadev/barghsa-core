import type { DeliveryPool } from './email.js';
export interface EmailBreakerConfig {
  /** Successive failures inside `windowMs` before the breaker trips. */
  readonly threshold: number;
  /** Rolling window over which the failure run is counted, milliseconds. */
  readonly windowMs: number;
  /** How long the breaker stays open before a HALF_OPEN probe is allowed. */
  readonly cooldownMs: number;
}

export const DEFAULT_EMAIL_BREAKER_CONFIG: EmailBreakerConfig = {
  threshold: 5,
  windowMs: 5 * 60_000, // 5 minutes
  cooldownMs: 60_000, // 60 seconds
};

/** Persisted breaker state for a provider (mirrors migration 0033 columns). */
export interface EmailBreakerState {
  providerId: string;
  degraded: boolean;
  degradedReason: string | null;
  consecutiveFailures: number;
  windowFailures: number;
  windowStartedAt: Date | null;
  lastFailureAt: Date | null;
  openedAt: Date | null;
  cooldownUntil: Date | null;
}

/** Decision handed to the send path for a provider. */
export type EmailBreakerDecision =
  | { allow: true; kind: 'closed' | 'half_open'; state: EmailBreakerState; probeToken?: string }
  | {
      allow: false;
      kind: 'open';
      degradedReason: string;
      cooldownUntil: Date;
      state: EmailBreakerState;
    };

export interface EmailBreakerOutcome {
  ok: boolean;
  /** Candidate cause recorded in `degraded_reason` when a failure trips. */
  cause?: string;
  /** True when the attempt is the single HALF_OPEN probe (recovery path). */
  isProbe?: boolean;
  probeToken?: string;
}

export interface Clock {
  now(): Date;
}

const COLUMNS = `degraded,degraded_reason AS "degradedReason",consecutive_failures AS "consecutiveFailures",
  window_failures AS "windowFailures",window_started_at AS "windowStartedAt",last_failure_at AS "lastFailureAt",
  opened_at AS "openedAt",cooldown_until AS "cooldownUntil"`;

/** Atomic counters and one leased recovery probe shared by all send paths. */
export class EmailCircuitBreaker {
  constructor(
    private readonly pool: DeliveryPool,
    private readonly config: EmailBreakerConfig = DEFAULT_EMAIL_BREAKER_CONFIG,
    private readonly clock?: Clock
  ) {}
  /** Bind all reads, probe claims and outcomes to a caller's held transaction. */
  using(pool: DeliveryPool): EmailCircuitBreaker {
    return new EmailCircuitBreaker(pool, this.config, this.clock);
  }
  private async now(): Promise<Date> {
    if (this.clock) return this.clock.now();
    const row = (await this.pool.query('SELECT clock_timestamp() AS now')).rows[0];
    if (!(row?.now instanceof Date)) throw new Error('Email breaker clock unavailable');
    return row.now;
  }
  async readState(providerId: string): Promise<EmailBreakerState> {
    const row = (
      await this.pool.query(`SELECT ${COLUMNS} FROM email_provider_configs WHERE id=$1`, [
        providerId,
      ])
    ).rows[0];
    if (!row) throw new Error('Email provider unavailable');
    return { ...row, providerId } as unknown as EmailBreakerState;
  }
  async decision(providerId: string): Promise<EmailBreakerDecision> {
    let state = await this.readState(providerId);
    if (!state.degraded) return { allow: true, kind: 'closed', state };
    const now = await this.now();
    const deadline = new Date(now.getTime() + this.config.cooldownMs);
    const claimed = await this.pool.query(
      `UPDATE email_provider_configs SET cooldown_until=$3
      WHERE id=$1 AND degraded=true AND (cooldown_until IS NULL OR cooldown_until <= $2)
      RETURNING ${COLUMNS}`,
      [providerId, now, deadline]
    );
    if (claimed.rows[0]) {
      state = { ...claimed.rows[0], providerId } as unknown as EmailBreakerState;
      return { allow: true, kind: 'half_open', state, probeToken: deadline.toISOString() };
    }
    state = await this.readState(providerId);
    return {
      allow: false,
      kind: 'open',
      state,
      degradedReason: state.degradedReason ?? 'Email provider degraded',
      cooldownUntil: state.cooldownUntil ?? deadline,
    };
  }
  async recordOutcome(
    providerId: string,
    outcome: EmailBreakerOutcome
  ): Promise<EmailBreakerState> {
    const now = await this.now();
    const token = outcome.probeToken ?? null;
    // A legacy boolean is not proof of ownership of the current recovery probe.
    if (outcome.isProbe && !token) return this.readState(providerId);
    const owned = `((NOT degraded AND $3::timestamptz IS NULL) OR
      (degraded AND cooldown_until=$3::timestamptz AND cooldown_until>$2::timestamptz))`;
    if (outcome.ok) {
      await this.pool.query(
        `UPDATE email_provider_configs SET degraded=false,degraded_reason=NULL,
        consecutive_failures=0,window_failures=0,window_started_at=NULL,last_failure_at=NULL,opened_at=NULL,cooldown_until=NULL
        WHERE id=$1 AND ${owned}`,
        [providerId, now, token]
      );
    } else {
      const inWindow = `(NOT degraded AND window_started_at >= $2::timestamptz - ($4 * interval '1 millisecond'))`;
      const count = `(CASE WHEN ${inWindow} THEN window_failures+1 ELSE 1 END)`;
      const trips = `(degraded OR ${count} >= $5)`;
      await this.pool.query(
        `UPDATE email_provider_configs SET
        consecutive_failures=consecutive_failures+1, window_failures=${count},
        window_started_at=CASE WHEN ${inWindow} THEN window_started_at ELSE $2 END,
        last_failure_at=$2, degraded=${trips},
        degraded_reason=CASE WHEN ${trips} THEN 'Email provider failure threshold reached' ELSE degraded_reason END,
        opened_at=CASE WHEN ${trips} THEN COALESCE(opened_at,$2) ELSE opened_at END,
        cooldown_until=CASE WHEN ${trips} THEN $2::timestamptz + ($6 * interval '1 millisecond') ELSE cooldown_until END
        WHERE id=$1 AND ${owned}`,
        [
          providerId,
          now,
          token,
          this.config.windowMs,
          this.config.threshold,
          this.config.cooldownMs,
        ]
      );
    }
    return this.readState(providerId);
  }
}
