import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@barghsa/ui';
import { FormControl, FormField, FormItem, FormLabel, type UseFormReturn } from '@barghsa/ui/form';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { authoringUuid, type ContractContextValues } from '../lib/contract-authoring-form.js';
import { DocumentRequestError } from '../lib/documents.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { CatalogueChoicePicker } from './CatalogueChoicePicker.js';
import { CompactFieldFeedback } from './CompactFieldFeedback.js';

type InvoiceChoice = { id: string; createdAt: string };
type InvoiceChoices = { invoices: InvoiceChoice[]; nextBefore: string | null };
const noInvoice = 'none';
const inputId = 'contract-context-invoice';

export function ContractInvoicePicker({
  contractId,
  versionId,
  profileId,
  control,
  disabled,
  formatDate,
}: {
  contractId: string;
  versionId: string;
  profileId: string;
  control: UseFormReturn<ContractContextValues>['control'];
  disabled: boolean;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const locale = useLocale();
  const copy = (key: string) => tContractAuthoring(key, locale);
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedContractRead(actor, revision, profileId, versionId);
  const [manual, setManual] = useState(false);
  const [choices, setChoices] = useState<InvoiceChoices | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied'>('loading');
  const [request, setRequest] = useState<{ before: string | null }>({ before: null });
  const requestActions = useRef<HTMLDivElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  function loadInvoices(before: string | null) {
    restoreFocus.current = true;
    setStatus('loading');
    setRequest({ before });
  }

  useEffect(() => {
    if (status === 'loading' || !restoreFocus.current) return;
    restoreFocus.current = false;
    const active = document.activeElement;
    if (active !== document.body && !requestActions.current?.contains(active)) return;
    if (status === 'failed') retryButton.current?.focus();
    else document.getElementById(inputId)?.focus();
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    if (!actor) return;
    const params = new URLSearchParams({ versionId });
    if (request.before) params.set('before', request.before);
    void read<
      Partial<InvoiceChoices> & { contractId?: string; profileId?: string; versionId?: string }
    >(
      `/api/admin/contracts/${encodeURIComponent(contractId)}/activation/invoice-options?${params}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        if (
          !page ||
          page.contractId !== contractId ||
          page.profileId !== profileId ||
          page.versionId !== versionId ||
          !Array.isArray(page.invoices) ||
          page.invoices.length > 50 ||
          !page.invoices.every(
            (row) =>
              row &&
              authoringUuid(row.id) &&
              (!request.before || row.id < request.before) &&
              typeof row.createdAt === 'string' &&
              Number.isFinite(Date.parse(row.createdAt))
          ) ||
          new Set(page.invoices.map((row) => row.id)).size !== page.invoices.length ||
          (page.nextBefore !== null &&
            (!authoringUuid(page.nextBefore) || page.nextBefore !== page.invoices.at(-1)?.id))
        )
          throw new Error('Invalid invoice choices');
        const { invoices, nextBefore } = page;
        setChoices((previous) => ({
          invoices: request.before && previous ? [...previous.invoices, ...invoices] : invoices,
          nextBefore,
        }));
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DocumentRequestError && [401, 403, 404].includes(error.status)) {
          setChoices(null);
          setStatus('denied');
        } else {
          setStatus('failed');
        }
      });
    return () => controller.abort();
  }, [actor, contractId, versionId, profileId, read, request]);

  const options = [
    { id: noInvoice, title: copy('noLinkedInvoice') },
    ...(choices?.invoices ?? []).map((invoice) => {
      const date = formatDate(invoice.createdAt, { dateStyle: 'medium' });
      return {
        id: invoice.id,
        title: `${date} · …${invoice.id.slice(-12)}`,
        searchText: `${invoice.id} ${invoice.createdAt.slice(0, 10)}`,
      };
    }),
  ];

  return (
    <FormField
      control={control}
      name="initialInvoiceId"
      render={({ field, fieldState }) => (
        <FormItem id={inputId}>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <FormLabel>
              {manual ? contractText('contextInvoice', locale) : copy('initialInvoice')}
            </FormLabel>
            <Button
              type="button"
              variant="link"
              className="px-0"
              disabled={disabled}
              onClick={() => setManual((value) => !value)}
            >
              {copy(manual ? 'invoiceChoose' : 'invoiceEnterId')}
            </Button>
          </div>
          <FormControl>
            {manual ? (
              <Input
                {...field}
                dir="ltr"
                autoCapitalize="none"
                spellCheck={false}
                disabled={disabled}
              />
            ) : (
              <CatalogueChoicePicker
                id={inputId}
                locale={locale}
                options={options}
                selected={field.value || noInvoice}
                required={false}
                disabled={disabled}
                field={field}
                labels={{
                  search: copy('invoiceFind'),
                  noMatches: copy('invoiceNoMatches'),
                  empty: copy('invoiceEmpty'),
                  unavailable: `…${field.value.slice(-12)}`,
                }}
                onChange={(id) => field.onChange(id === noInvoice ? '' : id)}
              />
            )}
          </FormControl>
          <CompactFieldFeedback
            help={copy(
              manual
                ? 'invoiceIdHelp'
                : choices?.invoices.length === 0
                  ? 'invoiceEmpty'
                  : 'invoiceChooseHelp'
            )}
            validationMessage={copy('invoiceInvalid')}
            invalid={fieldState.invalid}
          />
          {!manual && (
            <div ref={requestActions}>
              {status === 'loading' && (
                <p role="status" className="text-sm text-muted-foreground">
                  {copy('invoiceLoading')}
                </p>
              )}
              {status === 'denied' && (
                <p role="status" className="text-sm text-muted-foreground">
                  {copy('invoiceLookupDenied')}
                </p>
              )}
              {status === 'failed' && (
                <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/35 p-2.5">
                  <p role="alert" className="min-w-0 flex-1 basis-36 text-sm text-muted-foreground">
                    {copy(request.before ? 'invoiceOlderLookupError' : 'invoiceLookupError')}
                  </p>
                  <Button
                    ref={retryButton}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => loadInvoices(request.before)}
                  >
                    {contractText('retry', locale)}
                  </Button>
                </div>
              )}
              {status === 'ready' && choices?.nextBefore && (
                <Button
                  type="button"
                  variant="link"
                  className="px-0"
                  disabled={disabled}
                  onClick={() => loadInvoices(choices.nextBefore)}
                >
                  {copy('invoiceOlder')}
                </Button>
              )}
            </div>
          )}
        </FormItem>
      )}
    />
  );
}
