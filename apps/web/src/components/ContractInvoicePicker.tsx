import { useEffect, useState } from 'react';
import { Button, Input, NativeSelect } from '@barghsa/ui';
import { FormControl, FormField, FormItem, FormLabel, type UseFormReturn } from '@barghsa/ui/form';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { authoringUuid, type ContractContextValues } from '../lib/contract-authoring-form.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { CompactFieldFeedback } from './CompactFieldFeedback.js';

type InvoiceChoice = { id: string; createdAt: string };
type InvoiceChoices = { invoices: InvoiceChoice[]; nextBefore: string | null };

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
  formatDate: (value: string) => string;
}) {
  const locale = useLocale();
  const copy = (key: string) => tContractAuthoring(key, locale);
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedContractRead(actor, revision, profileId, versionId);
  const [manual, setManual] = useState(false);
  const [choices, setChoices] = useState<InvoiceChoices | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState<{ before: string | null }>({ before: null });

  useEffect(() => {
    const controller = new AbortController();
    if (!actor) return;
    const params = new URLSearchParams({ versionId });
    if (request.before) params.set('before', request.before);
    setLoading(true);
    setFailed(false);
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
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setChoices(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [actor, contractId, versionId, profileId, read, request]);

  return (
    <FormField
      control={control}
      name="initialInvoiceId"
      render={({ field, fieldState }) => (
        <FormItem id="contract-context-invoice">
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
              <NativeSelect {...field} className="w-full" disabled={disabled}>
                <option value="">{copy('noLinkedInvoice')}</option>
                {field.value && !choices?.invoices.some((row) => row.id === field.value) && (
                  <option value={field.value}>{`…${field.value.slice(-12)}`}</option>
                )}
                {choices?.invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {`…${invoice.id.slice(-12)} · ${formatDate(invoice.createdAt)}`}
                  </option>
                ))}
              </NativeSelect>
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
          {loading && !manual && (
            <p role="status" className="text-sm text-muted-foreground">
              {copy('invoiceLoading')}
            </p>
          )}
          {failed && !manual && (
            <p role="status" className="text-sm text-muted-foreground">
              {copy('invoiceLookupError')}
            </p>
          )}
          {!manual && (choices?.nextBefore || failed) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {!manual && choices?.nextBefore && (
                <Button
                  type="button"
                  variant="link"
                  className="px-0"
                  disabled={disabled || loading}
                  onClick={() => setRequest({ before: choices.nextBefore })}
                >
                  {copy('invoiceOlder')}
                </Button>
              )}
              {failed && !manual && (
                <Button
                  type="button"
                  variant="link"
                  className="px-0"
                  disabled={disabled}
                  onClick={() => setRequest({ before: null })}
                >
                  {contractText('retry', locale)}
                </Button>
              )}
            </div>
          )}
        </FormItem>
      )}
    />
  );
}
