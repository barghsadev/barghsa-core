import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';

type RequestType = 'export' | 'closure';
type BlockerCode =
  | 'legalHold'
  | 'unpaidInvoice'
  | 'pendingRefund'
  | 'walletBalance'
  | 'activeContract'
  | 'securityReview';
interface Blocker {
  code: BlockerCode;
  count: number;
  owner: string;
  nextStep: string;
}
interface Preview {
  profileId: string;
  blockers: Blocker[];
  requests: { ticketId: string; type: RequestType; status: string; createdAt: string }[];
}
const blockerCodes: BlockerCode[] = [
  'legalHold',
  'unpaidInvoice',
  'pendingRefund',
  'walletBalance',
  'activeContract',
  'securityReview',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePreview(value: unknown): Preview {
  if (!value || typeof value !== 'object') throw new Error('Invalid preview');
  const row = value as Record<string, unknown>;
  if (
    typeof row.profileId !== 'string' ||
    !uuid.test(row.profileId) ||
    !Array.isArray(row.blockers) ||
    !Array.isArray(row.requests)
  )
    throw new Error('Invalid preview');
  if (
    !row.blockers.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const blocker = item as Record<string, unknown>;
      return (
        blockerCodes.includes(blocker.code as BlockerCode) &&
        typeof blocker.count === 'number' &&
        Number.isSafeInteger(blocker.count) &&
        blocker.count >= 0 &&
        typeof blocker.owner === 'string' &&
        typeof blocker.nextStep === 'string'
      );
    })
  )
    throw new Error('Invalid blockers');
  if (
    !row.requests.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const request = item as Record<string, unknown>;
      return (
        typeof request.ticketId === 'string' &&
        uuid.test(request.ticketId) &&
        (request.type === 'export' || request.type === 'closure') &&
        typeof request.status === 'string' &&
        typeof request.createdAt === 'string'
      );
    })
  )
    throw new Error('Invalid requests');
  return row as unknown as Preview;
}

export function ProfileLifecyclePanel() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'ownerOnly'>('loading');
  const [submitting, setSubmitting] = useState<RequestType | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const key = useRef<{ type: RequestType; value: string } | null>(null);
  const busy = useRef(false);

  async function refresh(signal?: AbortSignal) {
    const response = await fetch('/api/tickets/lifecycle-preview', {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
    if (response.status === 403) {
      setState('ownerOnly');
      return;
    }
    if (!response.ok) throw new Error('Preview unavailable');
    setPreview(parsePreview(await response.json()));
    setState('ready');
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setState('error');
    });
    return () => controller.abort();
  }, []);

  async function request(type: RequestType) {
    if (busy.current || state !== 'ready') return;
    busy.current = true;
    setSubmitting(type);
    setSubmitError(false);
    if (!key.current || key.current.type !== type)
      key.current = { type, value: crypto.randomUUID() };
    try {
      const response = await fetch('/api/tickets/lifecycle-requests', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type, idempotencyKey: key.current.value, locale }),
      });
      if (!response.ok) throw new Error('Request failed');
      await refresh();
      key.current = null;
    } catch {
      setSubmitError(true);
    } finally {
      busy.current = false;
      setSubmitting(null);
    }
  }

  return (
    <main
      className="container mx-auto max-w-3xl space-y-6 px-4 py-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{t('settings.privacy.title', locale)}</h1>
      <p className="text-muted-foreground">{t('settings.privacy.intro', locale)}</p>
      {state === 'loading' && <p role="status">{t('settings.privacy.loading', locale)}</p>}
      {state === 'error' && <p role="alert">{t('settings.privacy.error', locale)}</p>}
      {state === 'ownerOnly' && <p role="alert">{t('settings.privacy.ownerOnly', locale)}</p>}
      {state === 'ready' && preview && (
        <>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h2 className="text-lg font-semibold">
                {t('settings.privacy.export.title', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.privacy.export.description', locale)}
              </p>
              <Button
                type="button"
                disabled={submitting !== null}
                onClick={() => void request('export')}
              >
                {t('settings.privacy.export.action', locale)}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <h2 className="text-lg font-semibold">
                {t('settings.privacy.closure.title', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.privacy.closure.description', locale)}
              </p>
              <ul className="space-y-2">
                {preview.blockers.map((blocker) => (
                  <li key={blocker.code} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{t(`settings.privacy.blocker.${blocker.code}`, locale)}</strong>
                      <span
                        className={blocker.count > 0 ? 'text-destructive' : 'text-muted-foreground'}
                      >
                        {blocker.count > 0
                          ? t('settings.privacy.blocked', locale).replace(
                              '{count}',
                              numbers.number(blocker.count)
                            )
                          : t('settings.privacy.clear', locale)}
                      </span>
                    </div>
                    {blocker.count > 0 && (
                      <p className="mt-1 text-muted-foreground">
                        {t(`settings.privacy.owner.${blocker.owner}`, locale)} ·{' '}
                        {t(`settings.privacy.step.${blocker.nextStep}`, locale)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                disabled={submitting !== null}
                onClick={() => void request('closure')}
              >
                {t('settings.privacy.closure.action', locale)}
              </Button>
            </CardContent>
          </Card>
          {submitError && (
            <p role="alert" className="text-destructive">
              {t('settings.privacy.submitError', locale)}
            </p>
          )}
          {preview.requests.length > 0 && (
            <section className="space-y-2" aria-label={t('settings.privacy.requests', locale)}>
              <h2 className="text-lg font-semibold">{t('settings.privacy.requests', locale)}</h2>
              <ul className="space-y-2">
                {preview.requests.map((item) => (
                  <li key={item.ticketId}>
                    <a
                      className="text-primary underline underline-offset-2"
                      href={`/tickets?ticketId=${item.ticketId}`}
                    >
                      {t(`settings.privacy.${item.type}.title`, locale)} ·{' '}
                      {t(`tickets.${item.status}`, locale)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
