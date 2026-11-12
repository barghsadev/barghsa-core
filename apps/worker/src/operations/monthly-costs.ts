import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { Gauge, Registry } from 'prom-client';
import { readCappedBytes } from '@barghsa/shared/storage';

export const costCategories = {
  compute: 'رایانش / Compute',
  postgres: 'پایگاه داده / PostgreSQL',
  object_storage: 'ذخیره‌سازی فایل / Object storage',
  storage_egress: 'خروجی ذخیره‌سازی / Storage egress',
  redis: 'ردیس / Redis',
  notifications: 'اعلان‌ها / Notifications',
  observability: 'پایش / Observability',
  ai: 'هوش مصنوعی / AI',
} as const;

type CostCategory = keyof typeof costCategories;
type Cost = { category: CostCategory; provider: string; model: string; amount: bigint };

const categories = Object.keys(costCategories) as CostCategory[];
const maxSnapshotAge = 35 * 24 * 60 * 60 * 1000;
const safeLabel = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;

export function isCostCategory(value: unknown): value is CostCategory {
  return typeof value === 'string' && Object.hasOwn(costCategories, value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid cost snapshot object');
  return value as Record<string, unknown>;
}

function micros(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid cost snapshot amount');
  return BigInt(value);
}

function parseSnapshot(input: unknown, now: Date) {
  const { month, asOf, currency, costs, budgets } = record(input);
  if (
    typeof month !== 'string' ||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
    typeof asOf !== 'string' ||
    !/^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(asOf) ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    !Array.isArray(costs) ||
    costs.length < categories.length ||
    costs.length > 250
  )
    throw new Error('Invalid cost snapshot envelope');

  const start = new Date(`${month}-01T00:00:00.000Z`);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = new Date(asOf);
  if (
    !Number.isFinite(+end) ||
    end.toISOString() !== asOf ||
    end <= start ||
    end > next ||
    end > now ||
    +now - +end > maxSnapshotAge
  )
    throw new Error('Invalid or stale cost snapshot period');

  const approvedBudgets = record(budgets);
  if (Object.keys(approvedBudgets).length !== categories.length)
    throw new Error('Invalid cost budget categories');
  const budget = new Map(
    categories.map((category) => [category, micros(approvedBudgets[category])])
  );
  const totals = new Map<CostCategory, bigint>();
  const seen = new Set<string>();
  const entries: Cost[] = [];
  for (const entry of costs as unknown[]) {
    const { category, provider, model, amountMicros } = record(entry);
    if (!isCostCategory(category) || typeof provider !== 'string' || !safeLabel.test(provider))
      throw new Error('Invalid cost allocation');
    if (
      category === 'ai' ? typeof model !== 'string' || !safeLabel.test(model) : model !== undefined
    )
      throw new Error('Invalid AI cost allocation');
    const modelName = typeof model === 'string' ? model : '';
    const key = JSON.stringify([category, provider, modelName]);
    if (seen.has(key)) throw new Error('Duplicate cost allocation');
    seen.add(key);
    const amount = micros(amountMicros);
    entries.push({ category, provider, model: modelName, amount });
    totals.set(category, (totals.get(category) ?? 0n) + amount);
  }
  if (totals.size !== categories.length) throw new Error('Incomplete cost categories');
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Cost snapshot total is too large');
  return { month, currency, start, end, closed: +end === +next, budget, totals, total, entries };
}

async function readProtectedFile(path: string, limit: number): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error('Invalid protected cost file');
    const { bytes, truncated } = await readCappedBytes(
      file.createReadStream({ autoClose: false }),
      limit
    );
    if (truncated) throw new Error('Protected cost configuration exceeds its size limit');
    return Buffer.from(bytes).toString('utf8');
  } finally {
    await file.close();
  }
}

async function readUsage(pool: Pick<Pool, 'query'>, start: Date, end: Date) {
  // Use the same submitted service records as the profile submission limits.
  const {
    rows: [row],
  } = await pool.query<{ profiles: number; orders: number }>(
    `SELECT
      (SELECT count(*)::double precision FROM profiles p JOIN users u ON u.user_id=p.user_id
       WHERE NOT p.archived AND p.status IN ('ACTIVE','VERIFIED') AND u.disabled_at IS NULL
         AND p.created_at < $2::timestamptz) AS profiles,
      ((SELECT count(*) FROM orders o JOIN electricity_orders e ON e.id=o.id
        WHERE o.order_type='electricity' AND e.submitted_at >= $1::timestamptz AND e.submitted_at < $2::timestamptz) +
       (SELECT count(*) FROM saving_orders WHERE submitted_at >= $1::timestamptz AND submitted_at < $2::timestamptz) +
       (SELECT count(*) FROM solar_construction_requests WHERE submitted_at >= $1::timestamptz AND submitted_at < $2::timestamptz) +
       (SELECT count(*) FROM consultation_requests WHERE submitted_at >= $1::timestamptz AND submitted_at < $2::timestamptz))::double precision AS orders`,
    [start, end]
  );
  if (
    !row ||
    ![row.profiles, row.orders].every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    throw new Error('Invalid monthly usage denominators');
  return row;
}

export async function collectMonthlyCostMetrics(
  pool: Pick<Pool, 'query'>,
  data: unknown,
  now: Date
) {
  const snapshot = parseSnapshot(data, now);
  const usage = await readUsage(pool, snapshot.start, snapshot.end);
  const registry = new Registry();
  const makeGauge = <Label extends string>(name: string, help: string, labelNames: Label[]) =>
    new Gauge({ name: `barghsa_monthly_cost_${name}`, help, labelNames, registers: [registry] });
  const common = { month: snapshot.month, currency: snapshot.currency };
  const bySource = makeGauge('amount', 'Reported cost allocation in reporting currency units', [
    'month',
    'currency',
    'category',
    'provider',
    'model',
  ]);
  const budget = makeGauge(
    'budget',
    'Approved full-month category budget in reporting currency units',
    ['month', 'currency', 'category']
  );
  const variance = makeGauge(
    'variance_exceeded',
    'Whether reported spend exceeds the category variance threshold',
    ['month', 'currency', 'category']
  );
  const unitCost = makeGauge('per_unit', 'Reported cost per active profile or submitted order', [
    'month',
    'currency',
    'unit',
  ]);
  const usageCount = makeGauge(
    'units',
    'Active profiles at collection and orders submitted in the snapshot period',
    ['month', 'unit']
  );
  const cutoff = makeGauge('cutoff_timestamp_seconds', 'Exclusive cost and order coverage cutoff', [
    'month',
  ]);
  cutoff.set({ month: snapshot.month }, +snapshot.end / 1000);

  for (const { amount, ...labels } of snapshot.entries)
    bySource.set({ ...common, ...labels }, Number(amount) / 1_000_000);
  for (const [category, approved] of snapshot.budget) {
    const actual = snapshot.totals.get(category)!;
    const difference = snapshot.closed && actual < approved ? approved - actual : actual - approved;
    budget.set({ ...common, category }, Number(approved) / 1_000_000);
    variance.set({ ...common, category }, difference * 5n > approved ? 1 : 0);
  }
  for (const [unit, count] of [
    ['active_profile', usage.profiles],
    ['order', usage.orders],
  ] as const) {
    usageCount.set({ month: snapshot.month, unit }, count);
    if (count > 0) unitCost.set({ ...common, unit }, Number(snapshot.total) / 1_000_000 / count);
  }
  return registry.metrics();
}

export async function serveMonthlyCostMetrics(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pick<Pool, 'query'>
) {
  const path = process.env['OPS_MONTHLY_COST_SNAPSHOT_FILE'];
  const tokenPath = process.env['OPS_MONTHLY_COST_SCRAPE_TOKEN_FILE'];
  if (req.method !== 'GET' || !path || !tokenPath) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const token = (await readProtectedFile(tokenPath, 256)).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid cost scrape credential');
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${token}`))) {
      res.writeHead(401).end();
      return;
    }
    const data: unknown = JSON.parse(await readProtectedFile(path, 64 * 1024));
    const body = await collectMonthlyCostMetrics(pool, data, new Date());
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }).end(body);
  } catch {
    // A missing or invalid report is unavailable. Never emit cost amounts or file contents in logs.
    res.writeHead(503).end();
  }
}
