import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/crm';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

interface AgentRecord {
  id: string;
  kind: 'agent' | 'invitation';
  profileId: string;
  profileTitle: string;
  username: string | null;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
}
interface VerificationRecord {
  id: string;
  event: string;
  actor: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  createdAt: string;
}
type Item = AgentRecord | VerificationRecord;
interface Page {
  items: Item[];
  nextCursor: string | null;
}
type Kind = 'agents' | 'verification';
function parsePage(value: unknown, kind: Kind): Page | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page.items) ||
    page.items.length > 20 ||
    !(
      page.nextCursor === null ||
      (typeof page.nextCursor === 'string' && page.nextCursor.length > 0)
    )
  )
    return null;
  const text = (value: unknown) => typeof value === 'string';
  const optionalText = (value: unknown) => value === null || text(value);
  const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const valid = page.items.every((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    if (!text(row.id) || !row.id || !date(row.createdAt)) return false;
    return kind === 'agents'
      ? ['agent', 'invitation'].includes(String(row.kind)) &&
          text(row.profileId) &&
          text(row.profileTitle) &&
          optionalText(row.username) &&
          text(row.role) &&
          text(row.status) &&
          (row.expiresAt === null || date(row.expiresAt))
      : text(row.event) &&
          text(row.actor) &&
          optionalText(row.previousStatus) &&
          optionalText(row.newStatus) &&
          optionalText(row.reason);
  });
  if (!valid || (!page.items.length && page.nextCursor !== null)) return null;
  const items = page.items as Item[];
  if (new Set(items.map((item) => item.id)).size !== items.length) return null;
  return { items, nextCursor: page.nextCursor as string | null };
}

export function CrmProfileRecords({
  profileId,
  kind,
  initial,
}: {
  profileId: string;
  kind: Kind;
  initial: unknown;
}) {
  const locale = useLocale(),
    time = useAccountTime();
  const [page, setPage] = useState<Page | null>(() => parsePage(initial, kind));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const retryCursor = useRef<string | undefined>(undefined);
  const load = useCallback(
    async (cursor?: string) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      retryCursor.current = cursor;
      setBusy(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/crm/profiles/${encodeURIComponent(profileId)}/records/${kind}${cursor ? '?' + new URLSearchParams({ cursor }) : ''}`,
          { credentials: 'include', signal: controller.signal }
        );
        if (!response.ok) throw new Error();
        const result = parsePage(await response.json(), kind);
        if (!result || (cursor && result.nextCursor === cursor)) throw new Error();
        if (!controller.signal.aborted)
          setPage((current) => ({
            items: cursor
              ? [
                  ...(current?.items ?? []),
                  ...result.items.filter(
                    (item) => !current?.items.some((old) => old.id === item.id)
                  ),
                ]
              : result.items,
            nextCursor: result.nextCursor,
          }));
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
        if (request.current === controller) request.current = null;
      }
    },
    [profileId, kind]
  );
  useEffect(() => {
    const firstPage = parsePage(initial, kind);
    setPage(firstPage);
    setError(false);
    setBusy(false);
    if (!firstPage) void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [initial, kind, load]);
  function label(group: string, value: string | null) {
    if (!value) return '—';
    const key = `crm.records.${group}.${value}`;
    const translated = t(key, locale);
    return translated === key ? t('crm.records.unknown', locale) : translated;
  }
  const headers =
    kind === 'agents'
      ? ['profile', 'contact', 'role', 'type', 'status', 'date', 'expires']
      : ['event', 'actor', 'before', 'after', 'reason', 'date'];
  return (
    <section
      className="space-y-3"
      aria-label={t(
        kind === 'agents' ? 'crm.profile.tab.agentInvites' : 'crm.profile.tab.verificationHistory',
        locale
      )}
    >
      <div className="flex justify-end">
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {t('crm.records.refresh', locale)}
        </Button>
      </div>
      {busy && <p role="status">{t('crm.records.loading', locale)}</p>}
      {error && (
        <div role="alert">
          <p>{t('crm.records.error', locale)}</p>
          <Button variant="outline" disabled={busy} onClick={() => void load(retryCursor.current)}>
            {t('crm.records.retry', locale)}
          </Button>
        </div>
      )}
      {page && !page.items.length && <p>{t('crm.records.empty', locale)}</p>}
      {!!page?.items.length && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">
              {t(
                kind === 'agents'
                  ? 'crm.profile.tab.agentInvites'
                  : 'crm.profile.tab.verificationHistory',
                locale
              )}
            </caption>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header} scope="col" className="p-3 text-start">
                    {t(`crm.records.${header}`, locale)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  {'kind' in row ? (
                    <>
                      <td className="p-3">{row.profileTitle}</td>
                      <td className="p-3">
                        <bdi>{row.username ?? '—'}</bdi>
                      </td>
                      <td className="p-3">{label('role', row.role)}</td>
                      <td className="p-3">{label('type', row.kind)}</td>
                      <td className="p-3">{label('status', row.status)}</td>
                      <td className="p-3 whitespace-nowrap">{time.format(row.createdAt)}</td>
                      <td className="p-3 whitespace-nowrap">{time.format(row.expiresAt)}</td>
                    </>
                  ) : (
                    <>
                      <td className="p-3">{label('event', row.event)}</td>
                      <td className="p-3">
                        <bdi>{row.actor}</bdi>
                      </td>
                      <td className="p-3">{label('status', row.previousStatus)}</td>
                      <td className="p-3">{label('status', row.newStatus)}</td>
                      <td className="p-3 whitespace-pre-wrap">{row.reason ?? '—'}</td>
                      <td className="p-3 whitespace-nowrap">{time.format(row.createdAt)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page?.nextCursor && !error && (
        <Button variant="outline" disabled={busy} onClick={() => void load(page.nextCursor!)}>
          {t('crm.records.older', locale)}
        </Button>
      )}
    </section>
  );
}
