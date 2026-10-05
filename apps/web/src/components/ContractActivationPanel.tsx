import { useEffect, useRef, useState } from 'react';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { contractAuthoringSource, contractActivationData } from '../lib/contract-authoring-form.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { Link } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, PageLoading, StatusBadge } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  contractBase,
  type ContractActivationData,
  type ContractVersion,
  type ContractDetailData,
} from '../lib/contracts.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { ContractContextEditor } from './ContractContextEditor.js';
export function ContractActivationPanel({
  id,
  versionId,
  staff,
  editableVersion,
  onChanged,
  source,
  coordination,
  onDenied,
  refreshRevision,
}: {
  id: string;
  versionId: string;
  staff: boolean;
  editableVersion?: ContractVersion | undefined;
  onChanged?: () => void;
  source?: ContractDetailData | undefined;
  refreshRevision?: number | undefined;
  coordination?: ContractFormCoordination | undefined;
  onDenied?: (() => void) | undefined;
}) {
  const locale = useLocale(),
    time = useAccountTime();
  const word = (key: string) => contractText(key, locale);
  const actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const scope = JSON.stringify([
      actor,
      profileRevision,
      id,
      versionId,
      staff,
      source && editableVersion
        ? contractAuthoringSource({ contract: source, version: editableVersion })
        : null,
    ]),
    current = useRef(scope);
  current.current = scope;
  const [accepted, setAccepted] = useState<{ scope: string; data: ContractActivationData } | null>(
      null
    ),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  const blocked = !!coordination?.blocked(),
    parentRevision = coordination?.revision?.(),
    callbacks = useRef({ coordination, onDenied });
  callbacks.current = { coordination, onDenied };
  const data = accepted?.scope === scope ? accepted.data : null;
  useEffect(() => {
    const controller = new AbortController();
    if (blocked) return () => controller.abort();
    const fresh = () =>
      !controller.signal.aborted &&
      current.current === scope &&
      parentRevision === callbacks.current.coordination?.revision?.() &&
      !callbacks.current.coordination?.blocked();
    setError(false);
    void documentRequest<unknown>(
      `${contractBase(staff)}/${id}/activation?versionId=${encodeURIComponent(versionId)}`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (!fresh()) return;
        const parsed = contractActivationData(value, id, versionId);
        if (!parsed) throw new Error('Invalid activation context');
        setAccepted((previous) =>
          previous?.scope === scope && JSON.stringify(previous.data) === JSON.stringify(parsed)
            ? previous
            : { scope, data: parsed }
        );
      })
      .catch((failure) => {
        if (!fresh()) return;
        setError(true);
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status)) {
          setAccepted(null);
          callbacks.current.onDenied?.();
        }
      });
    return () => controller.abort();
  }, [scope, reload, blocked, parentRevision, refreshRevision]);
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={word('activationTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('activationTitle')}</h3>
        <Button
          variant="ghost"
          disabled={blocked}
          onClick={() => {
            if (!callbacks.current.coordination?.blocked()) setReload((value) => value + 1);
          }}
        >
          {word('refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{word('activationNotice')}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      )}
      {!data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {!data.isCurrent ? <p>{word('historicalRequirements')}</p> : null}
          <ul className="divide-y">
            {data.checks.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-3">
                <span>{word('prerequisite.' + item.key)}</span>
                <StatusBadge label={word('prerequisite.' + item.status)} />
              </li>
            ))}
          </ul>
          {data.initialInvoiceId ? (
            <p className="text-sm">
              {word('initialInvoiceLinked')}{' '}
              {staff ? (
                <a
                  href={`/admin/invoices?invoiceId=${encodeURIComponent(data.initialInvoiceId)}`}
                  aria-disabled={blocked || undefined}
                  tabIndex={blocked ? -1 : undefined}
                  onClick={(event) => {
                    if (callbacks.current.coordination?.blocked()) event.preventDefault();
                  }}
                  className="text-primary underline underline-offset-4"
                >
                  {word('openInitialInvoice')}
                </a>
              ) : (
                <Link
                  to="/invoices/$invoiceId"
                  aria-disabled={blocked || undefined}
                  tabIndex={blocked ? -1 : undefined}
                  onClick={(event) => {
                    if (callbacks.current.coordination?.blocked()) event.preventDefault();
                  }}
                  params={{ invoiceId: data.initialInvoiceId }}
                  className="text-primary underline underline-offset-4"
                >
                  {word('openInitialInvoice')}
                </Link>
              )}
            </p>
          ) : data.checks.some((item) => item.key === 'initialPayment' && item.required) ? (
            <p className="text-sm text-muted-foreground">{word('initialInvoiceMissing')}</p>
          ) : null}
          {data.serviceStartsAt ? (
            <p className="text-sm">
              {word('prerequisite.serviceStart')}: {time.format(data.serviceStartsAt)}
            </p>
          ) : null}
          {data.serviceEndsAt ? (
            <p className="text-sm">
              {word('serviceEndsAt')}: {time.format(data.serviceEndsAt)}
            </p>
          ) : null}
          {data.state === 'Completed' ? <p role="status">{word('serviceCompleted')}</p> : null}
          {data.ready ? (
            <p role="status" className="font-medium">
              {word('prerequisitesReady')}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {word('evaluatedAt')}: {time.format(data.evaluatedAt)}
          </p>
          {staff &&
          data.isCurrent &&
          ['Draft', 'ChangesRequested'].includes(data.state) &&
          editableVersion?.id === data.versionId &&
          editableVersion.content &&
          onChanged &&
          source ? (
            <ContractContextEditor
              context={data}
              version={editableVersion}
              source={source}
              coordination={coordination}
              onDenied={onDenied}
              onChanged={onChanged}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
