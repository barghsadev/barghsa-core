import { readWithDeadline } from '../lib/server-query-client.js';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  LoadingStatus,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { useLocale } from '../hooks/useLocale.js';
import { validEffective, type EffectivePermissions } from '../lib/staff-permissions.js';
import { EffectivePermissionsView } from './EffectivePermissionsView.js';

export function StaffEffectivePermissions({
  target,
  paused,
  onClose,
  onDenied,
  finalFocus,
}: {
  target: { userId: string; username: string; name: string };
  paused: boolean;
  onClose: () => void;
  onDenied: (status: 401 | 403) => void;
  finalFocus: ComponentProps<typeof DialogContent>['finalFocus'];
}) {
  const locale = useLocale();
  const text = (key: string) => t(`admin.roles.effective.${key}`, locale);
  const [data, setData] = useState<EffectivePermissions | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const accepted = data?.userId === target.userId ? data : null;
  const denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    if (paused) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { status, ok, json } = await readWithDeadline(controller.signal, async (signal) => {
          const response = await fetch(
            `/api/admin/users/${encodeURIComponent(target.userId)}/effective-permissions`,
            { credentials: 'include', signal }
          );
          return {
            status: response.status,
            ok: response.ok,
            json: response.ok ? ((await response.json()) as unknown) : null,
          };
        });
        if (controller.signal.aborted) return;
        if (status === 401 || status === 403) {
          setData(null);
          denied.current(status);
          return;
        }
        if (status === 404) setData(null);
        if (!ok)
          throw new Error(
            status === 404 ? 'admin.roles.user.notfound' : 'admin.roles.user.lookup.failed'
          );
        if (!validEffective(json, target.userId)) throw new Error('admin.roles.user.lookup.failed');
        if (!controller.signal.aborted) setData(json);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error && failure.message === 'admin.roles.user.notfound'
              ? failure.message
              : 'admin.roles.user.lookup.failed'
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [target.userId, revision, paused]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-2xl overflow-y-auto"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        finalFocus={finalFocus}
      >
        <DialogHeader className="pe-8">
          <DialogTitle>{text('title')}</DialogTitle>
          <DialogDescription>
            <bdi>{target.name}</bdi> ·{' '}
            <bdi dir="ltr" className="break-all">
              {target.username}
            </bdi>
          </DialogDescription>
        </DialogHeader>
        {paused ? (
          <p role="status">{text('paused')}</p>
        ) : loading ? (
          <LoadingStatus>{text('loading')}</LoadingStatus>
        ) : null}
        {error && (
          <div role="alert" className="space-y-2">
            <p>{t(error, locale)}</p>
            {accepted && <p>{text('retained')}</p>}
          </div>
        )}
        {accepted && <EffectivePermissionsView data={accepted} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={paused || loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            {error ? t('admin.roles.retry', locale) : t('admin.jobs.refresh', locale)}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {text('close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
