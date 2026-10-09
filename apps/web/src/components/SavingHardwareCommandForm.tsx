import { useOwnedFinancialRead } from '../hooks/useOwnedFinancialRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, Input, FinancialReviewSummary } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import type {
  SavingHardwareAmendmentReview,
  SavingHardwareUpgradeCancellationReview,
} from '@barghsa/shared/finance';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { tSavingHardware } from '@barghsa/i18n/saving-hardware';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import type { SavingHardwareUpgrade } from './SavingHardwareUpgradeHistory.js';
import {
  cancellableSavingUpgrade,
  matchedSavingHardwareReview,
  matchedSavingHardwareReceipt,
  publicSavingHardwareError,
  definitiveSavingHardwareRejection,
  type SavingHardwareDraft,
  type SavingHardwareOwner,
  type SavingHardwareSource,
  type SavingHardwareReview,
  type SavingHardwareDraftCache,
} from '../lib/saving-hardware-form.js';
interface SavingHardwareCommand {
  action: TeamAction;
  review: SavingHardwareReview;
  owner: SavingHardwareOwner;
  rejected: boolean;
}
export function SavingHardwareCommandForm(
  props: Parameters<typeof OwnedSavingHardwareCommandForm>[0]
) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return (
    <OwnedSavingHardwareCommandForm key={JSON.stringify([actor, profileRevision])} {...props} />
  );
}
function OwnedSavingHardwareCommandForm({
  order,
  upgrade,
  owner,
  scope,
  currentScope,
  draftCache,
  baseScope,
  currentBaseScope,
  blocked,
  notify,
  onPending,
  onSuccess,
  onWithdraw,
}: {
  order: SavingHardwareSource;
  upgrade?: SavingHardwareUpgrade;
  owner: RefObject<SavingHardwareOwner | null>;
  scope: string;
  currentScope: RefObject<string>;
  draftCache: RefObject<Map<string, SavingHardwareDraftCache>>;
  baseScope: string;
  currentBaseScope: RefObject<string>;
  blocked: () => boolean;
  notify: () => void;
  onPending: () => void;
  onSuccess: () => void;
  onWithdraw: (reason: 'forbidden' | 'missing') => void;
}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readFinancial = useOwnedFinancialRead(
    actor,
    profileRevision,
    JSON.stringify([scope, baseScope, order, upgrade])
  );
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const formCopy = (key: string) => tSavingHardware(key, locale);
  const cancellation = !!upgrade;
  const draftId = upgrade?.id ?? 'hardware';
  const cacheScope = JSON.stringify([
    baseScope,
    order.profileId,
    order.versionId,
    order.hardwareProductId,
    draftId,
  ]);
  const mounted = useRef(false);
  const request = useRef(0);
  const preparing = useRef(false);
  const pending = useRef(false);
  const captured = useRef<SavingHardwareCommand | null>(null);
  const operationOwner = useRef<SavingHardwareOwner | null>(null);
  const privateWithdrawn = useRef(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [review, setReview] = useState<SavingHardwareReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const messages = {
    hardwareProductId: formCopy('hardwareInvalid'),
    reason: formCopy('reasonInvalid'),
  };
  const form: ReturnType<typeof useZodForm<SavingHardwareDraft>> = useZodForm<SavingHardwareDraft>(
    async () => {
      const raw = JSON.stringify(form.getValues());
      const generation = request.current;
      const schemas = await import('../lib/saving-hardware-form-schemas.js');
      return currentScope.current === scope &&
        generation === request.current &&
        raw === JSON.stringify(form.getValues())
        ? schemas.savingHardwareSchema(
            order.hardwareProductId,
            order.hardwareOptions.map((option) => option.id),
            cancellation,
            messages
          )
        : schemas.inactiveSavingHardwareSchema;
    },
    {
      defaultValues:
        draftCache.current.get(draftId)?.scope === cacheScope
          ? draftCache.current.get(draftId)!.value
          : {
              hardwareProductId: cancellation ? '' : (order.hardwareOptions[0]?.id ?? ''),
              reason: '',
            },
      validationUnavailableMessage: formCopy('validationUnavailable'),
    }
  );
  const applyFields = useActionFieldErrors(
    form,
    cancellation ? { reason: messages.reason } : messages,
    copy('staffReviewError')
  );
  const active = () =>
    mounted.current && currentScope.current === scope && !privateWithdrawn.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      if (!privateWithdrawn.current && currentBaseScope.current === baseScope)
        draftCache.current.set(draftId, { baseScope, scope: cacheScope, value: form.getValues() });
      mounted.current = false;
      ++request.current;
      if (owner.current === operationOwner.current) {
        owner.current = null;
        notify();
      }
    };
  }, []);
  function release() {
    ++request.current;
    preparing.current = false;
    pending.current = false;
    captured.current = null;
    if (owner.current === operationOwner.current) owner.current = null;
    operationOwner.current = null;
    setAction(null);
    setReview(null);
    setBusy(false);
    setUncertain(false);
    notify();
  }
  function withdraw(reason: 'forbidden' | 'missing') {
    if (!active()) return;
    privateWithdrawn.current = true;
    draftCache.current.delete(draftId);
    form.reset({ hardwareProductId: '', reason: '' });
    release();
    onWithdraw(reason);
  }
  function live(command: SavingHardwareCommand, ownedAction: TeamAction) {
    return (
      active() &&
      captured.current === command &&
      command.action === ownedAction &&
      owner.current === command.owner
    );
  }
  function unconfirmed(command: SavingHardwareCommand, ownedAction: TeamAction) {
    if (!live(command, ownedAction)) return;
    command.owner.uncertain = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
    setReview(null);
    notify();
  }
  function close(command: SavingHardwareCommand, ownedAction: TeamAction) {
    if (!live(command, ownedAction) || pending.current) return;
    if (command.owner.uncertain || (command.owner.attempted && !command.rejected))
      unconfirmed(command, ownedAction);
    else release();
  }
  function decorate(command: SavingHardwareCommand, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (value: unknown) => {
          if (!live(command, ownedAction)) return copy('staffReviewError');
          if (publicSavingHardwareError(value)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
            withdraw('missing');
            return formCopy('missing');
          }
          const rejection = definitiveSavingHardwareRejection(value);
          if (rejection) {
            command.rejected = true;
            if (
              !command.owner.uncertain &&
              rejection.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(rejection.fields) &&
              applyFields(rejection.fields)
            ) {
              pending.current = false;
              close(command, ownedAction);
            }
          }
          return copy(code.startsWith('CONFLICT:') ? 'staffConflict' : 'staffReviewError');
        },
      ])
    );
  }
  function prepare() {
    if (
      !active() ||
      preparing.current ||
      pending.current ||
      captured.current ||
      owner.current ||
      blocked() ||
      form.isSubmissionPending() ||
      !(upgrade ? cancellableSavingUpgrade(upgrade) : order.canAmendHardware)
    )
      return;
    const token: SavingHardwareOwner = {
      attempted: false,
      uncertain: false,
      kind: cancellation ? 'cancellation' : 'hardware',
    };
    owner.current = token;
    operationOwner.current = token;
    preparing.current = true;
    setBusy(true);
    setError(false);
    notify();
    onPending();
    const generation = ++request.current;
    const raw = JSON.stringify(form.getValues());
    const authorized = () => active() && request.current === generation && owner.current === token;
    const fresh = () => authorized() && raw === JSON.stringify(form.getValues());
    void form
      .handleSubmit(async (draft) => {
        if (!fresh() || JSON.stringify(draft) !== raw) return;
        const body = upgrade
          ? { upgradeId: upgrade.id, reason: draft.reason.trim() }
          : {
              expectedVersionId: order.versionId,
              expectedHardwareId: order.hardwareProductId,
              hardwareProductId: draft.hardwareProductId,
              reason: draft.reason.trim(),
            };
        try {
          const response = await readFinancial(
            `/api/staff/saving/orders/${encodeURIComponent(order.id)}/${cancellation ? 'cancel-hardware-upgrade-review' : 'amend-hardware-review'}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
            },
            true
          );
          if (!authorized()) return;
          if ([401, 403].includes(response.status)) {
            withdraw('forbidden');
            return;
          }
          if (response.status === 404) {
            withdraw('missing');
            return;
          }
          const value: unknown = await response.json().catch(() => null);
          if (!fresh()) return;
          if (response.status === 400 && definitiveSavingHardwareRejection(value)) {
            const fields = publicSavingHardwareError(value)?.fields;
            if (Array.isArray(fields) && applyFields(fields)) return;
          }
          if (response.status !== 200) throw new Error('review');
          const financialReview = matchedSavingHardwareReview(value, order, draft, upgrade);
          if (!financialReview) throw new Error('review mismatch');
          const ownedAction: TeamAction = {
            title: copy(cancellation ? 'hardwareUpgradeCancel' : 'staffAmendHardware'),
            description: copy(
              cancellation ? 'staffUpgradeCancellationConfirm' : 'staffHardwareReviewConfirm'
            ),
            method: 'POST',
            path: `/api/staff/saving/orders/${order.id}/${cancellation ? 'cancel-hardware-upgrade' : 'amend-hardware'}`,
            successStatus: cancellation ? 200 : 201,
            body: Object.freeze({
              ...body,
              idempotencyKey: crypto.randomUUID(),
              expectedReviewHash: financialReview.value.hash,
            }),
            conflictMessage: copy('staffConflict'),
            forbiddenMessage: copy('staffForbidden'),
          };
          const command = {
            action: ownedAction,
            review: financialReview,
            owner: token,
            rejected: false,
          };
          captured.current = command;
          decorate(command, ownedAction);
          setReview(financialReview);
          setAction(ownedAction);
        } catch {
          if (fresh()) setError(true);
        }
      })()
      .finally(() => {
        if (active() && request.current === generation) {
          preparing.current = false;
          setBusy(false);
          if (!captured.current && owner.current === token) {
            owner.current = null;
            operationOwner.current = null;
            notify();
          }
        }
      });
  }
  function retry() {
    const command = captured.current;
    if (
      !active() ||
      !command ||
      !live(command, command.action) ||
      !command.owner.uncertain ||
      pending.current ||
      action
    )
      return;
    const next = { ...command.action };
    command.action = next;
    decorate(command, next);
    setReview(command.review);
    setAction(next);
  }
  const frozen = !!captured.current || pending.current || uncertain;
  const command = captured.current;
  return (
    <div
      className="space-y-3 rounded-md border p-4"
      data-testid={
        cancellation ? `saving-upgrade-cancel-form-${upgrade.id}` : 'saving-staff-hardware-form'
      }
    >
      {!cancellation && <h3 className="font-semibold">{copy('staffAmendHardware')}</h3>}
      <p className="text-sm text-muted-foreground">
        {!cancellation && copy('staffAmendHardwareHelp')}
      </p>
      <Form {...form}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          {!cancellation && (
            <FormField
              control={form.control}
              name="hardwareProductId"
              render={({ field }) => (
                <FormItem id="saving-amend-hardware">
                  <FormLabel>{copy('stepHardware')}</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      disabled={frozen}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">{copy('chooseHardware')}</option>
                      {order.hardwareOptions.map((hardware) => (
                        <option key={hardware.id} value={hardware.id}>
                          {hardware.title[locale]}
                          {BigInt(hardware.priceDeltaIrR) < 0n
                            ? ` · ${copy('hardwareCreditIssued')}: ${numbers.money((-BigInt(hardware.priceDeltaIrR)).toString())}`
                            : BigInt(hardware.priceDeltaIrR) > 0n
                              ? ` · ${copy('hardwareAdditionalCharge')}: ${numbers.money(hardware.priceDeltaIrR)}`
                              : ''}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>{formCopy('hardwareHelp')}</FormDescription>
                  <FormMessage reserveSpace />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem
                id={
                  upgrade ? `saving-upgrade-cancel-${upgrade.id}` : 'saving-amend-hardware-reason'
                }
              >
                <FormLabel>{copy('staffAmendReason')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={frozen} />
                </FormControl>
                <FormDescription>
                  {formCopy(cancellation ? 'cancellationReasonHelp' : 'hardwareReasonHelp')}
                </FormDescription>
                <FormMessage reserveSpace />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={frozen || busy || blocked()}
            aria-busy={busy || undefined}
          >
            {busy && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {copy(cancellation ? 'hardwareUpgradeCancel' : 'staffAmendHardware')}
          </Button>
          {busy && <p role="status">{formCopy('checking')}</p>}
          {error && <p role="alert">{copy('staffReviewError')}</p>}
          {form.formState.errors.root?.validation && (
            <p role="alert">{formCopy('validationUnavailable')}</p>
          )}
        </form>
      </Form>
      {uncertain && (
        <div role="alert" className="space-y-2">
          <p>{formCopy('uncertain')}</p>
          <Button
            type="button"
            variant="outline"
            data-testid={
              cancellation
                ? `saving-upgrade-cancel-retry-${upgrade.id}`
                : 'saving-staff-hardware-retry'
            }
            disabled={pending.current || !!action}
            onClick={retry}
          >
            {formCopy(cancellation ? 'retryCancellation' : 'retryCaptured')}
          </Button>
        </div>
      )}
      {action && command && live(command, action) && (
        <TeamActionDialog
          action={action}
          summary={
            review ? (
              review.kind === 'hardware' ? (
                <HardwareReviewSummary hardwareReview={review.value} />
              ) : (
                <UpgradeCancellationReviewSummary upgradeCancellationReview={review.value} />
              )
            ) : undefined
          }
          onClose={() => close(command, action)}
          onValidationError={() => false}
          onDenied={() => {
            if (live(command, action)) withdraw('forbidden');
          }}
          onUnconfirmed={() => unconfirmed(command, action)}
          onPendingChange={(value) => {
            if (!live(command, action)) return;
            pending.current = value;
            if (value) {
              command.owner.attempted = true;
              onPending();
              notify();
            }
          }}
          onSuccess={async (value) => {
            if (!live(command, action)) return;
            if (!matchedSavingHardwareReceipt(value, command.review)) {
              unconfirmed(command, action);
              return;
            }
            privateWithdrawn.current = true;
            draftCache.current.delete(draftId);
            form.reset({ hardwareProductId: form.getValues('hardwareProductId'), reason: '' });
            release();
            onSuccess();
          }}
        />
      )}
    </div>
  );
}

function HardwareReviewSummary({
  hardwareReview,
}: {
  hardwareReview: SavingHardwareAmendmentReview;
}) {
  const locale = useLocale();
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  return (
    <FinancialReviewSummary
      title={copy('staffHardwareReviewTitle')}
      rows={[
        {
          id: 'customer',
          label: copy('customer'),
          value: hardwareReview.data.customerName,
        },
        {
          id: 'profile',
          label: copy('staffReviewProfile'),
          value: hardwareReview.data.profileName,
        },
        {
          id: 'bill',
          label: copy('staffBill'),
          value: hardwareReview.data.billIdentifier,
        },
        {
          id: 'address',
          label: copy('staffAddress'),
          value: String(hardwareReview.data.addressSnapshot.full_address ?? ''),
        },
        {
          id: 'contract',
          label: copy('staffReviewContractVersion'),
          value: money.number(hardwareReview.data.versionNumber),
        },
        {
          id: 'invoice',
          label: copy('staffInvoice'),
          value: t(`invoices.state.${hardwareReview.data.invoiceState}`, locale),
        },
        {
          id: 'paid',
          label: copy('staffPaid'),
          value: money.money(hardwareReview.data.paidAmount),
        },
        {
          id: 'current-hardware',
          label: copy('staffHardwareCurrent'),
          value: hardwareReview.data.currentHardwareTitle[locale],
        },
        {
          id: 'current-price',
          label: copy('staffHardwareCurrentPrice'),
          value: money.money(hardwareReview.data.currentHardwarePriceIrR),
        },
        {
          id: 'current-vat',
          label: copy('staffHardwareCurrentVat'),
          value: `${money.number(hardwareReview.data.currentHardwareVatRateBps / 100)}%`,
        },
        {
          id: 'current-total',
          label: copy('staffHardwareCurrentTotal'),
          value: money.money(hardwareReview.data.currentOrderTotalIrR),
        },
        {
          id: 'target-hardware',
          label: copy('staffHardwareTarget'),
          value: hardwareReview.data.targetHardwareTitle[locale],
        },
        {
          id: 'target-price',
          label: copy('staffHardwareTargetPrice'),
          value: money.money(hardwareReview.data.targetHardwarePriceIrR),
        },
        {
          id: 'target-vat',
          label: copy('staffHardwareTargetVat'),
          value: `${money.number(hardwareReview.data.targetHardwareVatRateBps / 100)}%`,
        },
        {
          id: 'outcome',
          label: copy('staffReviewOutcome'),
          value: copy(`staffHardwareOutcome.${hardwareReview.data.outcome}`),
        },
        {
          id: 'delta',
          label: copy('staffHardwareDelta'),
          value: money.money(
            (hardwareReview.data.priceDeltaIrR.startsWith('-')
              ? -BigInt(hardwareReview.data.priceDeltaIrR)
              : BigInt(hardwareReview.data.priceDeltaIrR)
            ).toString()
          ),
        },
        ...(hardwareReview.data.targetStockTracking
          ? [
              {
                id: 'availability',
                label: copy('staffHardwareAvailable'),
                value: money.number(hardwareReview.data.targetAvailableCount),
              },
            ]
          : []),
      ]}
      total={{
        label: copy('staffHardwareTargetTotal'),
        value: money.money(hardwareReview.data.targetOrderTotalIrR),
      }}
      notice={
        <div className="space-y-2">
          <p>{hardwareReview.data.reason}</p>
          <p className="whitespace-pre-wrap break-words" dir="auto">
            {hardwareReview.data.agreementSnapshot}
          </p>
        </div>
      }
    />
  );
}
function UpgradeCancellationReviewSummary({
  upgradeCancellationReview,
}: {
  upgradeCancellationReview: SavingHardwareUpgradeCancellationReview;
}) {
  const locale = useLocale();
  const money = useNumberFormatting(locale);
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  return (
    <FinancialReviewSummary
      title={copy('staffUpgradeCancellationTitle')}
      rows={[
        {
          id: 'customer',
          label: copy('customer'),
          value: upgradeCancellationReview.data.customerName,
        },
        {
          id: 'profile',
          label: copy('staffReviewProfile'),
          value: upgradeCancellationReview.data.profileName,
        },
        {
          id: 'bill',
          label: copy('staffBill'),
          value: upgradeCancellationReview.data.billIdentifier,
        },
        {
          id: 'address',
          label: copy('staffAddress'),
          value: String(upgradeCancellationReview.data.addressSnapshot.full_address ?? ''),
        },
        {
          id: 'contract',
          label: copy('staffReviewContractVersion'),
          value: money.number(upgradeCancellationReview.data.versionNumber),
        },
        {
          id: 'previous-hardware',
          label: copy('staffHardwareCurrent'),
          value: upgradeCancellationReview.data.previousHardware.title[locale],
        },
        {
          id: 'replacement-hardware',
          label: copy('staffHardwareTarget'),
          value: upgradeCancellationReview.data.replacementHardware.title[locale],
        },
        {
          id: 'invoice',
          label: copy('staffInvoice'),
          value: t(
            `invoices.state.${upgradeCancellationReview.data.adjustmentInvoiceState}`,
            locale
          ),
        },
        {
          id: 'paid',
          label: copy('staffPaid'),
          value: money.money(upgradeCancellationReview.data.invoicePaidIrR),
        },
        {
          id: 'charge',
          label: copy('hardwareAdditionalCharge'),
          value: money.money(upgradeCancellationReview.data.additionalChargeIrR),
        },
        {
          id: 'reservation',
          label: copy('staffUpgradeCancellationReservation'),
          value: copy(
            upgradeCancellationReview.data.stockReserved
              ? 'staffUpgradeCancellationRelease'
              : 'staffUpgradeCancellationNoReservation'
          ),
        },
      ]}
      total={{
        label: copy('staffTotal'),
        value: money.money(upgradeCancellationReview.data.invoiceTotalIrR),
      }}
      notice={
        <div className="space-y-2">
          <p>{copy('staffUpgradeCancellationOutcome')}</p>
          <p>{upgradeCancellationReview.data.reason}</p>
          <p className="whitespace-pre-wrap break-words" dir="auto">
            {upgradeCancellationReview.data.agreementSnapshot}
          </p>
        </div>
      }
    />
  );
}
