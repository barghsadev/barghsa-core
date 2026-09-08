import type { TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from './csrf.js';
export type Transport = 'smtp' | 'resend';
export type Status = 'draft' | 'active' | 'superseded' | 'disabled';
export type TestStatus = 'pending' | 'passed' | 'failed';
export interface EmailProvider {
  id: string;
  transport: Transport;
  label: string;
  status: Status;
  lastTestStatus: TestStatus;
  activatedAt?: string | null;
  activatedBy?: string | null;
  lastTestAt?: string | null;
  lastTestError?: string | null;
}
export interface TestConnectionOutcome {
  ok: boolean;
  error: string | null;
}
export class ProviderRequestError extends Error {}
export class ProviderStepUpError extends ProviderRequestError {
  constructor(readonly action: Pick<TeamAction, 'path' | 'method' | 'body'>) {
    super();
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function provider(value: unknown): EmailProvider {
  const row = record(value);
  if (
    !row ||
    typeof row.id !== 'string' ||
    !row.id.trim() ||
    typeof row.label !== 'string' ||
    typeof row.transport !== 'string' ||
    !['smtp', 'resend'].includes(row.transport) ||
    typeof row.status !== 'string' ||
    !['draft', 'active', 'superseded', 'disabled'].includes(row.status) ||
    typeof row.lastTestStatus !== 'string' ||
    !['pending', 'passed', 'failed'].includes(row.lastTestStatus)
  )
    throw new ProviderRequestError();
  for (const field of ['activatedAt', 'lastTestAt']) {
    const date = row[field];
    if (
      date !== undefined &&
      date !== null &&
      (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))
    )
      throw new ProviderRequestError();
  }
  for (const field of ['activatedBy', 'lastTestError']) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string')
      throw new ProviderRequestError();
  }
  return row as unknown as EmailProvider;
}
async function request(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  try {
    const response = await fetch(`/api/admin/email-providers${path}`, {
      method,
      ...(signal ? { signal } : {}),
      ...(method !== 'GET' ? { headers: withCsrf({ 'Content-Type': 'application/json' }) } : {}),
      ...(payload !== undefined ? { body: payload } : {}),
    });
    if (response.status === 403 && method !== 'GET') {
      const errorBody = record(
        await response
          .clone()
          .json()
          .catch(() => null)
      );
      const code =
        typeof errorBody?.error === 'string' ? errorBody.error : record(errorBody?.error)?.code;
      if (code === 'AUTHZ:STEP_UP_REQUIRED' || errorBody?.requiresStepUp === true) {
        throw new ProviderStepUpError({
          path: `/api/admin/email-providers${path}`,
          method,
          ...(payload !== undefined ? { body: JSON.parse(payload) as unknown } : {}),
        });
      }
    }
    if (!response.ok) throw new ProviderRequestError();
    return await response.json();
  } catch (error) {
    if (signal?.aborted || error instanceof ProviderStepUpError) throw error;
    throw new ProviderRequestError();
  }
}
export function validateProviderResult(value: unknown, status: Status, id?: string): EmailProvider {
  const row = provider(value);
  if (row.status !== status || (id !== undefined && row.id !== id))
    throw new ProviderRequestError();
  return row;
}
export async function listProviders(signal?: AbortSignal): Promise<EmailProvider[]> {
  const data = await request('', 'GET', undefined, signal);
  if (!Array.isArray(data)) throw new ProviderRequestError();
  return data.map(provider);
}
export async function createProvider(
  transport: Transport,
  label: string,
  config: Record<string, unknown>
) {
  const row = validateProviderResult(
    await request('', 'POST', { transport, label, config }),
    'draft'
  );
  if (row.transport !== transport) throw new ProviderRequestError();
  return row;
}
export async function updateProvider(
  id: string,
  body: { label?: string; config?: Record<string, unknown> }
) {
  return validateProviderResult(
    await request(`/${encodeURIComponent(id)}`, 'PUT', body),
    'draft',
    id
  );
}
export async function testConnection(
  id: string,
  recipient?: string
): Promise<TestConnectionOutcome> {
  const data = await request(
    `/${encodeURIComponent(id)}/test-connection`,
    'POST',
    recipient ? { recipient } : {}
  );
  return validateConnectionResult(data, id);
}
export function validateConnectionResult(data: unknown, id: string): TestConnectionOutcome {
  const row = provider(data);
  const test = record(record(data)?.test);
  if (
    row.id !== id ||
    !test ||
    typeof test.ok !== 'boolean' ||
    (test.error !== null && typeof test.error !== 'string') ||
    (test.ok && test.error !== null) ||
    row.lastTestStatus !== (test.ok ? 'passed' : 'failed')
  )
    throw new ProviderRequestError();
  return { ok: test.ok, error: test.error as string | null };
}
export async function activateProvider(id: string) {
  return validateProviderResult(
    await request(`/${encodeURIComponent(id)}/activate`, 'POST'),
    'active',
    id
  );
}
export async function disableProvider(id: string) {
  return validateProviderResult(
    await request(`/${encodeURIComponent(id)}/disable`, 'POST'),
    'disabled',
    id
  );
}
export async function rollbackProvider(id: string) {
  const row = validateProviderResult(
    await request(`/${encodeURIComponent(id)}/rollback`, 'POST'),
    'active'
  );
  if (row.id === id) throw new ProviderRequestError();
  return row;
}
