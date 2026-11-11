import { randomUUID } from 'node:crypto';
import { readCappedJson } from './storage/read-capped-bytes.js';

export const browserErrorCodes = ['CHUNK_LOAD_FAILED', 'ROUTE_RENDER_FAILED'] as const;
const serverProcesses = {
  API_REQUEST_FAILED: 'api',
  API_STARTUP_FAILED: 'api',
  WORKER_POLLER_FAILED: 'worker',
  WORKER_UNHANDLED_REJECTION: 'worker',
  WORKER_STARTUP_FAILED: 'worker',
  AI_INFERENCE_STARTUP_FAILED: 'ai-inference',
} as const;

const MAX_IN_FLIGHT = 4;
const MAX_RECEIPT_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 3000;
const inFlight = { web: 0, server: 0 };

function deploymentEnvironment() {
  const value = process.env.BARGHSA_DEPLOYMENT_ENV ?? process.env.NODE_ENV;
  if (value === 'staging' || value === 'development') return value;
  return value === 'production' || process.env.NODE_ENV === 'production'
    ? 'production'
    : 'development';
}

function shouldSample(environment: ReturnType<typeof deploymentEnvironment>): boolean {
  if (environment !== 'production') return true;
  const configured = process.env.SENTRY_ERROR_SAMPLE_RATE?.trim();
  const parsed = configured ? Number(configured) : NaN;
  const rate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
  return Math.random() < rate;
}

function sentryEndpoint(dsn: string): URL | null {
  const url = URL.parse(dsn);
  const project = url && /^(?<base>(?:\/[a-z0-9._-]+)*)\/(?<id>[0-9]+)\/?$/i.exec(url.pathname);
  if (
    !url ||
    url.protocol !== 'https:' ||
    !/^[a-z0-9]+$/i.test(url.username) ||
    url.password ||
    url.search ||
    url.hash ||
    !project?.groups?.id
  ) {
    return null;
  }
  return new URL(`${project.groups.base}/api/${project.groups.id}/envelope/`, url.origin);
}

async function deliver(
  dsn: string,
  code: string,
  processName: 'web' | (typeof serverProcesses)[keyof typeof serverProcesses],
  reference: string,
  route?: string
): Promise<'acknowledged' | 'sampled-out' | 'unavailable'> {
  const endpoint = sentryEndpoint(dsn);
  if (!endpoint) return 'unavailable';
  const environment = deploymentEnvironment();
  if (!shouldSample(environment)) return 'sampled-out';
  const lane = processName === 'web' ? 'web' : 'server';
  if (inFlight[lane] >= MAX_IN_FLIGHT) return 'unavailable';

  const eventId = reference.replaceAll('-', '').toLowerCase();
  const release = process.env.BARGHSA_RELEASE_SHA;
  const event = JSON.stringify({
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    message: code,
    fingerprint: route ? [code, route] : [code],
    environment,
    ...(/^[a-f0-9]{40}$/.test(release ?? '') ? { release } : {}),
    tags: {
      process: processName,
      ...(processName === 'web' ? { support_reference: reference } : {}),
      ...(route ? { route } : {}),
    },
  });
  const envelope = [
    JSON.stringify({ event_id: eventId, dsn }),
    JSON.stringify({ type: 'event', length: Buffer.byteLength(event) }),
    event,
  ].join('\n');

  inFlight[lane]++;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: envelope,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const receipt = (await readCappedJson(response, MAX_RECEIPT_BYTES)) as {
        id?: unknown;
      } | null;
      if (receipt?.id === eventId) return 'acknowledged';
    } else {
      await response.body?.cancel();
    }
  } catch {
    // Receiver errors and receipts are never logged or sent back to callers.
  } finally {
    inFlight[lane]--;
  }
  return 'unavailable';
}

export function reportBrowserError(code: (typeof browserErrorCodes)[number], reference: string) {
  return deliver(process.env.ROUTE_ERROR_SENTRY_DSN ?? '', code, 'web', reference);
}

export async function reportServerError(
  code: keyof typeof serverProcesses,
  routeTemplate?: unknown
) {
  const route =
    typeof routeTemplate === 'string' && /^\/[a-z0-9_:/-]{0,159}$/i.test(routeTemplate)
      ? routeTemplate
      : undefined;
  await deliver(
    process.env.SERVER_ERROR_SENTRY_DSN ?? '',
    code,
    serverProcesses[code],
    randomUUID(),
    route
  );
}
