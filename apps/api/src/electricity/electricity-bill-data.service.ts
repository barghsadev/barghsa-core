import { Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { ValidatedSession } from '../session/session.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { CircuitBreaker, CircuitOpenError } from '../verification/circuit-breaker.js';
import { calculateDuration } from './electricity-calculation.js';
import {
  getCurrentJalaliMonthRange,
  getNextJalaliMonthRange,
  getCurrentWeekRange,
  getNextWeekRange,
  getWeekAfterNextRange,
} from './electricity-periods.js';
import type { SimplePeriod } from './electricity-order.service.js';

export interface HourlyBillReading {
  hour: string;
  kwh: number;
}
export interface BillDataProvider {
  readonly source: string;
  getHourlyConsumption(profileId: string): Promise<HourlyBillReading[]>;
}

/** The deployment supplies a trusted origin and token; an absent provider leaves manual entry available. */
export class HttpBillDataProvider implements BillDataProvider {
  readonly source = 'configured_bill_provider';
  private readonly breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
    halfOpenMaxProbes: 1,
  });

  async getHourlyConsumption(profileId: string): Promise<HourlyBillReading[]> {
    const base = process.env.ELECTRICITY_BILL_DATA_URL;
    const token = process.env.ELECTRICITY_BILL_DATA_TOKEN;
    if (!base || !token) throw new Error('unconfigured');
    const url = new URL(`/profiles/${encodeURIComponent(profileId)}/hourly-consumption`, base);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('unconfigured');
    }
    return this.breaker.call(async () => {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 401 || response.status === 403) throw new Error('auth_error');
      if (!response.ok) throw new Error('provider_error');
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('invalid_data');
      return payload
        .filter(
          (item): item is HourlyBillReading =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.hour === 'string' &&
            Number.isFinite(Date.parse(item.hour)) &&
            typeof item.kwh === 'number' &&
            Number.isFinite(item.kwh) &&
            item.kwh >= 0
        )
        .slice(-8_760);
    });
  }
}

export function suggestEnergy(readings: HourlyBillReading[], periodHours: number, source: string) {
  const unique = new Map<string, HourlyBillReading>();
  for (const reading of readings) {
    const date = new Date(reading.hour);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(reading.kwh) || reading.kwh < 0)
      continue;
    unique.set(date.toISOString(), reading);
  }
  const ordered = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (ordered.length === 0) return null;
  const sum = ordered.reduce((total, [, row]) => total + row.kwh, 0);
  const first = new Date(ordered[0]![0]);
  const last = new Date(ordered[ordered.length - 1]![0]);
  const lookbackHours = Math.max(1, Math.round((last.getTime() - first.getTime()) / 3_600_000) + 1);
  const estimate = Math.round((sum / ordered.length) * periodHours);
  if (!Number.isSafeInteger(estimate) || estimate <= 0) return null;
  return {
    suggestedKwh: String(estimate),
    dataSource: source,
    dataPeriod: {
      start: first.toISOString(),
      end: new Date(last.getTime() + 3_600_000).toISOString(),
    },
    dataTimestamp: last.toISOString(),
    coverage: Math.min(1, ordered.length / lookbackHours),
    sampledHours: ordered.length,
  };
}

@Injectable()
export class ElectricityBillDataService {
  constructor(
    private readonly orders: OrdersService,
    private readonly provider: HttpBillDataProvider
  ) {}

  async get(
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    profileId: string,
    selected: SimplePeriod
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId))) {
        throw new NotFoundException('Profile not found');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const now = new Date();
    const period = (
      {
        current_month: getCurrentJalaliMonthRange,
        next_month: getNextJalaliMonthRange,
        current_week: getCurrentWeekRange,
        next_week: getNextWeekRange,
        week_after_next: getWeekAfterNextRange,
      } satisfies Record<SimplePeriod, (date: Date) => { start: Date; end: Date }>
    )[selected](now);
    try {
      const readings = await this.provider.getHourlyConsumption(profileId);
      const hours = Number(calculateDuration(period.start, period.end).milliseconds) / 3_600_000;
      const suggestion = suggestEnergy(readings, hours, this.provider.source);
      return suggestion
        ? { available: true, hourlyKwh: readings, ...suggestion, manualEntryAllowed: true }
        : { available: false, hourlyKwh: [], reason: 'no_data', manualEntryAllowed: true };
    } catch (error) {
      const reason =
        error instanceof CircuitOpenError
          ? 'circuit_open'
          : error instanceof Error && ['unconfigured', 'auth_error'].includes(error.message)
            ? error.message
            : error instanceof Error && error.name === 'TimeoutError'
              ? 'timeout'
              : 'provider_error';
      return { available: false, hourlyKwh: [], reason, manualEntryAllowed: true };
    }
  }
}
