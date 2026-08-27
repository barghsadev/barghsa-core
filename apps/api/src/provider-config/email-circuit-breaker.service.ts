import { Injectable, Logger, Inject, Optional } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { PROVIDER_CONFIG_POOL, type ProviderPool } from './provider-config.di'

/**
 * Per-provider email circuit breaker (E-05, T-05.06.06).
 *
 * Protects the email send path from a misbehaving SMTP/Resend provider by
 * tracking consecutive transient failures per provider. When the failure run
 * reaches `threshold` inside a rolling `windowMs`, the breaker TRIPS: the
 * provider row is persisted as `degraded`, the send path must refuse new sends
 * through it, and an ops log/alert is raised. After a `cooldownMs` the breaker
 * opens a HALF_OPEN window — one test-send (a "probe") is allowed; a success
 * probe resets the breaker to healthy, a failure keeps it open.
 *
 * Design:
 * - State is PERSISTED on `email_provider_configs` (migration 033) — never
 *   only in-process — so a worker/API restart survives a tripped breaker, and
 *   multiple worker replicas and the admin surfaces all agree on the same
 *   degraded status.
 * - `degraded` is a separate flag from the admin `status` lifecycle
 *   (draft/active/superseded/disabled). A provider is `active` AND `degraded`.
 * - A `Clock` is injectable so tests can advance time deterministically.
 * - This service owns no Prometheus coupling; the `provider_email_health`
 *   gauge is published from the worker's metrics collector which derives it
 *   from the same persisted column (single source of truth).
 */
export interface EmailBreakerConfig {
  /** Successive failures inside `windowMs` before the breaker trips. */
  readonly threshold: number
  /** Rolling window over which the failure run is counted, milliseconds. */
  readonly windowMs: number
  /** How long the breaker stays open before a HALF_OPEN probe is allowed. */
  readonly cooldownMs: number
}

export const DEFAULT_EMAIL_BREAKER_CONFIG: EmailBreakerConfig = {
  threshold: 5,
  windowMs: 5 * 60_000, // 5 minutes
  cooldownMs: 60_000, // 60 seconds
}

/** Persisted breaker state for a provider (mirrors migration 0033 columns). */
export interface EmailBreakerState {
  providerId: string
  degraded: boolean
  degradedReason: string | null
  consecutiveFailures: number
  windowFailures: number
  windowStartedAt: Date | null
  lastFailureAt: Date | null
  openedAt: Date | null
  cooldownUntil: Date | null
}

/** Decision handed to the send path for a provider. */
export type EmailBreakerDecision =
  | { allow: true; kind: 'closed' | 'half_open'; state: EmailBreakerState }
  | {
      allow: false
      kind: 'open'
      degradedReason: string
      cooldownUntil: Date
      state: EmailBreakerState
    }

export interface EmailBreakerOutcome {
  ok: boolean
  /** Candidate cause recorded in `degraded_reason` when a failure trips. */
  cause?: string
  /** True when the attempt is the single HALF_OPEN probe (recovery path). */
  isProbe?: boolean
}

export interface Clock {
  now(): Date
}

const SYSTEM_CLOCK: Clock = { now: () => new Date() }

const NEUTRAL_STATE: EmailBreakerState = {
  providerId: '',
  degraded: false,
  degradedReason: null,
  consecutiveFailures: 0,
  windowFailures: 0,
  windowStartedAt: null,
  lastFailureAt: null,
  openedAt: null,
  cooldownUntil: null,
}

@Injectable()
export class EmailCircuitBreakerService {
  private readonly logger = new Logger(EmailCircuitBreakerService.name)
  private readonly config: EmailBreakerConfig
  private readonly clock: Clock
  private injectedPool: ProviderPool | undefined

  constructor(
    @Optional() @Inject(PROVIDER_CONFIG_POOL) injectedPool?: ProviderPool,
    @Optional() config?: EmailBreakerConfig,
    @Optional() clock?: Clock,
  ) {
    this.injectedPool = injectedPool
    // Nest DI treats every constructor parameter as an injectable token; mark
    // the tuning knobs optional so the runtime defaults apply when no provider
    // is registered, while tests pass explicit values positionally.
    this.config = config ?? DEFAULT_EMAIL_BREAKER_CONFIG
    this.clock = clock ?? SYSTEM_CLOCK
  }

  /** Shared DB pool (or injected/mock pool in tests). */
  get db(): ProviderPool {
    return this.injectedPool ?? (getDbPool() as unknown as ProviderPool)
  }

  /**
   * Read a provider's persisted breaker state. A missing row is treated as a
   * default healthy/closed state (callers may still fail to do the send itself).
   */
  async readState(providerId: string): Promise<EmailBreakerState> {
    const res = await this.db.query(
      `SELECT degraded,
              degraded_reason        AS "degradedReason",
              consecutive_failures   AS "consecutiveFailures",
              window_failures        AS "windowFailures",
              window_started_at      AS "windowStartedAt",
              last_failure_at        AS "lastFailureAt",
              opened_at              AS "openedAt",
              cooldown_until         AS "cooldownUntil"
         FROM email_provider_configs
        WHERE id = $1`,
      [providerId],
    )
    const row = res.rows[0] as Partial<EmailBreakerState> | undefined
    if (!row) return { ...NEUTRAL_STATE, providerId }
    return {
      providerId,
      degraded: row.degraded ?? false,
      degradedReason: row.degradedReason ?? null,
      consecutiveFailures: row.consecutiveFailures ?? 0,
      windowFailures: row.windowFailures ?? 0,
      windowStartedAt: row.windowStartedAt ?? null,
      lastFailureAt: row.lastFailureAt ?? null,
      openedAt: row.openedAt ?? null,
      cooldownUntil: row.cooldownUntil ?? null,
    }
  }

  /**
   * Send-path gate. CLOSED (healthy) → allow. OPEN (degraded) → reject until
   * `cooldown_until` passes, then allow exactly one HALF_OPEN probe (the caller
   * must pass `isProbe: true` back into `recordOutcome` so a probe success
   * actually resets the breaker).
   */
  async decision(providerId: string): Promise<EmailBreakerDecision> {
    const state = await this.readState(providerId)

    if (!state.degraded) {
      return { allow: true, kind: 'closed', state }
    }

    const now = this.clock.now()
    const cooldownUntil = state.cooldownUntil ?? state.openedAt ?? now
    if (now < cooldownUntil) {
      const degradedReason = state.degradedReason ?? 'Email provider degraded by circuit breaker'
      this.logger.warn(
        `email breaker: ${providerId} OPEN until ${cooldownUntil.toISOString()}`,
      )
      return { allow: false, kind: 'open', degradedReason, cooldownUntil, state }
    }

    this.logger.warn(`email breaker: ${providerId} HALF_OPEN — allowing probe`)
    return { allow: true, kind: 'half_open', state }
  }

  /**
   * Record a send attempt's outcome and persist the resulting breaker state.
   * A success resets the failure window (and a successful half-open probe also
   * clears `degraded` — the recovery path). A failure increments the rolling
   * window and trips (sets `degraded`, `opened_at`, `cooldown_until`) once the
   * threshold in-window failures is reached.
   */
  async recordOutcome(providerId: string, outcome: EmailBreakerOutcome): Promise<EmailBreakerState> {
    const now = this.clock.now()
    const prev = await this.readState(providerId)

    let next: EmailBreakerState
    if (outcome.ok) {
      next = {
        ...NEUTRAL_STATE,
        providerId,
        degraded: outcome.isProbe ? false : prev.degraded,
        degradedReason: outcome.isProbe ? null : prev.degradedReason,
      }
    } else {
      const inWindow =
        prev.windowStartedAt !== null &&
        now.getTime() - prev.windowStartedAt!.getTime() <= this.config.windowMs
      const windowFailures = inWindow && prev.degraded === false ? prev.windowFailures + 1 : 1
      const windowStartedAt = inWindow ? (prev.windowStartedAt as Date) : now
      const consecutiveFailures = prev.consecutiveFailures + 1
      const trips = windowFailures >= this.config.threshold && !prev.degraded
      // A failure while already degraded is a failed probe: keep the breaker
      // open and restart the cooldown so probes are spaced by `cooldownMs`
      // rather than being re-allowed immediately.
      const failedProbe = !trips && prev.degraded
      const cooldownUntil = trips || failedProbe
        ? new Date(now.getTime() + this.config.cooldownMs)
        : prev.cooldownUntil

      next = {
        providerId,
        degraded: trips || prev.degraded,
        degradedReason: trips
          ? (outcome.cause ?? 'Email provider failure threshold reached')
          : prev.degradedReason,
        consecutiveFailures,
        windowFailures,
        windowStartedAt,
        lastFailureAt: now,
        openedAt: trips ? now : prev.openedAt,
        cooldownUntil,
      }
    }

    await this.db.query(
      `UPDATE email_provider_configs
          SET degraded             = $2,
              degraded_reason      = $3,
              consecutive_failures = $4,
              window_failures      = $5,
              window_started_at    = $6,
              last_failure_at      = $7,
              opened_at            = $8,
              cooldown_until       = $9
        WHERE id = $1`,
      [
        providerId,
        next.degraded,
        next.degradedReason,
        next.consecutiveFailures,
        next.windowFailures,
        next.windowStartedAt,
        next.lastFailureAt,
        next.openedAt,
        next.cooldownUntil,
      ],
    )

    if (!prev.degraded && next.degraded) {
      this.logger.error(
        `email provider ${providerId} TRIPPED: ${next.degradedReason ?? 'circuit breaker'} — send path paused`,
      )
    } else if (prev.degraded && !next.degraded) {
      this.logger.log(`email provider ${providerId} recovered — breaker reset`)
    }
    return next
  }
}