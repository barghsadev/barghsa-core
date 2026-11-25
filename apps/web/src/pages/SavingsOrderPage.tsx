import { readWithDeadline } from '../lib/server-query-client.js';
import { toast } from '../lib/toast-api.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { SubmissionRecovery } from '../components/SubmissionRecovery.js';
import SavingsOrderReview from '../components/SavingsOrderReview.js';
import { ConfirmationFields } from '@barghsa/ui';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { useOwnedIntakeRead } from '../hooks/useOwnedIntakeRead.js';
import { queryKeys } from '../lib/query-keys.js';
import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import {
  wizardActionSurface,
  wizardChoiceCard as choiceCard,
  wizardChoiceRadio as choiceRadio,
} from '../components/FormWizard.js';
import { ValidatedFormWizard } from '../components/ValidatedFormWizard.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { z } from 'zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LoadingStatus,
  Button,
  Card,
  CardContent,
  DependentSelect,
  Input,
  NativeSelect,
  Textarea,
} from '@barghsa/ui';
import { ChevronDownIcon } from 'lucide-react';
import { addressesText } from '@barghsa/i18n/addresses';
import { validatePostalCode } from '@barghsa/shared/validation';
import { useGeographyOptions } from '../hooks/useGeographyOptions.js';
import { GeographyLoadError } from '../components/GeographyLoadError.js';
import { t } from '@barghsa/i18n/app';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { useWizardDraftProtection } from '../hooks/useWizardDraftProtection.js';
import { useReviewedSubmission } from '../hooks/useReviewedSubmission.js';
import { uuidReference } from '../lib/form-receipt.js';
import { tSaving } from '@barghsa/i18n/saving';
import { withCsrf } from '../lib/csrf.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useFormDraft, type DraftSchema } from '../hooks/useFormDraft.js';
import { useSettingsCommand } from '../hooks/useSettingsCommand.js';
import { useCommandFeedback } from '../hooks/useCommandFeedback.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { addressReceipt } from '../lib/settings-form.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import {
  parseSavingCatalogue,
  type SavingPlan as Plan,
  type SavingProduct as Product,
} from '../lib/customer-saving-catalogue.js';
import {
  defaultIntakeAddressId,
  readIntakeProfile,
  readIntakeAddresses,
  type IntakeAddress as Address,
} from '../lib/service-intake-records.js';

export interface SavingQuote {
  reviewDigest: string;
  plan: { id: string; title: Product['title'] };
  hardware: { id: string; title: Product['title'] };
  billIdentifier: string;
  address: {
    id: string;
    province_id: string;
    city_id: string;
    full_address: string;
    postal_code: string;
  };
  agreement: { versionId: string; title: string; body: string };
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
  lines: Array<{
    type: string;
    title: { fa: string; en: string };
    amountIrR: string;
    discountIrR: string;
    vatIrR: string;
  }>;
}
interface Draft {
  planId: string;
  hardwareId: string;
  billIdentifier: string;
  addressId: string;
  giftCode: string;
}
type AddressDraftField = 'provinceId' | 'cityId' | 'fullAddress' | 'postalCode';
const draftSchema: DraftSchema<Draft> = {
  safeParse(value) {
    if (!value || typeof value !== 'object') return { success: false };
    const data = value as Record<string, unknown>;
    if (
      ['planId', 'hardwareId', 'billIdentifier', 'addressId', 'giftCode'].some(
        (key) => typeof data[key] !== 'string'
      )
    )
      return { success: false };
    return { success: true, data: data as unknown as Draft };
  },
};

async function postJson<T>(
  url: string,
  body: unknown,
  signal: AbortSignal | null = null
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

const LeaveDialog = lazy(() => import('../components/WizardLeaveDialog.js'));

export function SavingsOrderPage({ preferredPlanId }: { preferredPlanId?: string } = {}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedSavingsOrderPage
      key={JSON.stringify([actor, revision])}
      preferredPlanId={preferredPlanId}
    />
  );
}
function OwnedSavingsOrderPage({ preferredPlanId }: { preferredPlanId: string | undefined }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const navigate = useNavigate();
  const copy = (key: string) => tSaving(key, locale);
  const title = (product: Pick<Product, 'title'>) =>
    product.title[locale] || product.title.en || product.title.fa;
  const [profileId, setProfileId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [addressLoading, setAddressLoading] = useState(true);
  const [loadError, setLoadError] = useState<'intake' | 'addresses' | 'authority' | null>(null);
  const [intakeAttempt, setIntakeAttempt] = useState(0);
  const [addressAttempt, setAddressAttempt] = useState(0);
  const wizard = useWizardStep('/savings/orders/new', 3);
  const { step } = wizard;
  const [verification, setVerification] = useState<'idle' | 'checking' | 'verified' | 'manual'>(
    'idle'
  );
  const [duplicate, setDuplicate] = useState<{
    duplicate: boolean;
    preventActiveDuplicates: boolean;
    existingOrderId: string | null;
  } | null>(null);
  const invalidField = t('formWizard.invalidField', locale);
  const fields = useWizardForm(
    z
      .object({
        planId: z.string(),
        hardwareId: z.string(),
        hardwareConfirmed: z.boolean(),
        billIdentifier: z.string().regex(/^[0-9]{6,13}$/, copy('invalidBill')),
        duplicateAcknowledged: z.boolean(),
        addressId: z
          .string()
          .refine((id) => addresses.some((address) => address.id === id), invalidField),
        provinceId: z.string(),
        cityId: z.string(),
        fullAddress: z.string(),
        postalCode: z.string(),
        agreementAccepted: z.boolean().refine(Boolean, invalidField),
        giftCode: z.string(),
        appliedGiftCode: z.string(),
        submitForReview: z.boolean().refine(Boolean, invalidField),
      })
      .superRefine((value, context) => {
        const plan = plans.find((item) => item.id === value.planId);
        if (!plan?.available)
          context.addIssue({ code: 'custom', path: ['planId'], message: invalidField });
        const hardware = plan?.hardware.find((item) => item.id === value.hardwareId);
        if (
          !hardware ||
          hardware.status !== 'active' ||
          (hardware.stock_tracking && (hardware.available_count ?? 0) < 1)
        )
          context.addIssue({ code: 'custom', path: ['hardwareId'], message: invalidField });
        if (!value.hardwareConfirmed)
          context.addIssue({ code: 'custom', path: ['hardwareConfirmed'], message: invalidField });
        if (
          duplicate?.duplicate &&
          (duplicate.preventActiveDuplicates || !value.duplicateAcknowledged)
        )
          context.addIssue({
            code: 'custom',
            path: ['duplicateAcknowledged'],
            message: invalidField,
          });
        if (value.giftCode.trim() !== value.appliedGiftCode)
          context.addIssue({
            code: 'custom',
            path: ['giftCode'],
            message: t('electricity.order.applyGiftFirst', locale),
          });
      }),
    {
      planId: '',
      hardwareId: '',
      hardwareConfirmed: false,
      billIdentifier: '',
      duplicateAcknowledged: false,
      addressId: '',
      provinceId: '',
      cityId: '',
      fullAddress: '',
      postalCode: '',
      agreementAccepted: false,
      giftCode: '',
      appliedGiftCode: '',
      submitForReview: false,
    }
  );
  const [planId, setPlanId] = fields.field('planId');
  const [hardwareId, setHardwareId] = fields.field('hardwareId');
  const [hardwareConfirmed, setHardwareConfirmed] = fields.field('hardwareConfirmed');
  const [billIdentifier, setBillIdentifier] = fields.field('billIdentifier');
  const validBill = /^[0-9]{6,13}$/.test(billIdentifier);
  const invalidBill = billIdentifier !== '' && !validBill;
  const [duplicateAcknowledged, setDuplicateAcknowledged] = fields.field('duplicateAcknowledged');
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  const [duplicateRevision, setDuplicateRevision] = useState(0);
  const [addressId, setAddressId] = fields.field('addressId');
  const [addingAddress, setAddingAddress] = useState(false);
  const addressHeading = useRef<HTMLHeadingElement>(null);
  const addAddressButton = useRef<HTMLButtonElement>(null);
  const [provinceId, setProvinceId] = fields.field('provinceId');
  const [cityId, setCityId] = fields.field('cityId');
  const provinceOptions = useGeographyOptions(addingAddress ? '/api/geography/provinces' : null);
  const cityOptions = useGeographyOptions(
    addingAddress && provinceId
      ? `/api/geography/provinces/${encodeURIComponent(provinceId)}/cities`
      : null,
    provinceId || undefined
  );
  const provinces = provinceOptions.options;
  const cities = cityOptions.options;
  const addressLocationReady =
    provinceOptions.ready &&
    cityOptions.ready &&
    provinces.some((province) => province.id === provinceId) &&
    cities.some((city) => city.id === cityId);
  const [fullAddress, setFullAddress] = fields.field('fullAddress');
  const [postalCode, setPostalCode] = fields.field('postalCode');
  const validPostalCode = validatePostalCode(postalCode);
  const invalidPostalCode = postalCode !== '' && !validPostalCode;
  const [agreementAccepted, setAgreementAccepted] = fields.field('agreementAccepted');
  const [giftCode, setGiftCode] = fields.field('giftCode');
  const [appliedGiftCode, setAppliedGiftCode] = fields.field('appliedGiftCode');
  const [quotePacket, setQuotePacket] = useState<{ key: string; value: SavingQuote } | null>(null);
  const [quoteError, setQuoteError] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [submitForReview, setSubmitForReview] = fields.field('submitForReview');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submission = useReviewedSubmission(
    '/api/saving/orders',
    profileId,
    (value) => uuidReference((value as { savingOrderId?: unknown } | null)?.savingOrderId),
    { addIdempotencyKey: true }
  );
  const hydratedProfile = useRef<string | null>(null);
  const [addressErrors, setAddressErrors] = useState<AddressDraftField[]>([]);
  const actorId = useAccountUser();
  const contextRevision = useProfileContextRevision();
  const readIntake = useOwnedIntakeRead(JSON.stringify([actorId, contextRevision]));
  const intakeScope = useMemo(
    () => ({
      context: 'account' as const,
      ownerId: actorId ?? 'current-session',
      accountId: actorId,
      revision: contextRevision,
    }),
    [actorId, contextRevision]
  );
  const addressCommand = useSettingsCommand(
    JSON.stringify([actorId, contextRevision, profileId]),
    () => {
      setLoadError('authority');
      setAddresses([]);
      setAddressId('');
      setAddingAddress(false);
    },
    () =>
      !!profileId &&
      !addressLoading &&
      !loadError &&
      getProfileContextRevision() === contextRevision
  );
  const savingAddress = addressCommand.busy;
  const addressErrorMessage = addressErrors.length
    ? t('settings.addresses.error.create', locale)
    : null;
  function bindAddressField(name: AddressDraftField) {
    const rejected = addressErrors.includes(name);
    const postal = name === 'postalCode';
    return {
      ...fields.bind(name),
      'aria-required': true,
      'aria-invalid': rejected || (postal && invalidPostalCode) || undefined,
      'aria-describedby': rejected || postal ? fields.errorId(name) : undefined,
    };
  }
  function addressFieldError(name: AddressDraftField) {
    return addressErrors.includes(name) ? (
      <p id={fields.errorId(name)} className="text-sm text-destructive">
        {invalidField}
      </p>
    ) : null;
  }
  useCommandFeedback({
    error: addressCommand.error ? copy('addressUnconfirmed') : addressErrorMessage,
    operation: profileId ?? undefined,
  });
  const [draftSaved, setDraftSaved] = useState(false);
  const draftKey =
    profileId && plans.length
      ? `/api/saving/orders/draft?profileId=${encodeURIComponent(profileId)}`
      : null;
  const {
    draft,
    loading: draftLoading,
    error: draftError,
    save: saveDraft,
    retry: retryDraft,
  } = useFormDraft(draftKey, draftSchema);
  // Persist the completed stages using the existing server draft numbers.
  const saveWizardDraft = useCallback(
    (stage: number, data: Draft) => saveDraft(stage * 2, data),
    [saveDraft]
  );
  const currentDraft = useMemo(
    () => ({ planId, hardwareId, billIdentifier, addressId, giftCode }),
    [planId, hardwareId, billIdentifier, addressId, giftCode]
  );
  const addressDirty = addingAddress && !!(provinceId || cityId || fullAddress || postalCode);
  const protection = useWizardDraftProtection({
    profileId,
    data: currentDraft,
    step,
    ready: !!draft && !loading && !loadError && !addressLoading && !draftLoading && !draftError,
    saveDraft: saveWizardDraft,
    go: wizard.go,
    extraDirty: addressDirty,
    saveDisabled: addressDirty,
    unconfirmed: submission.unconfirmed,
  });
  const savingDraft = protection.busy;
  const draftSaveError = protection.saveError;
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === planId), [plans, planId]);
  const selectedHardware = selectedPlan?.hardware.find((item) => item.id === hardwareId);
  const canConfirmHardware =
    selectedHardware?.status === 'active' &&
    (!selectedHardware.stock_tracking || (selectedHardware.available_count ?? 0) > 0);
  const steps = ['stepPackage', 'stepInstallation', 'stepReview'];
  const agreementVersionId = selectedPlan?.agreement?.versionId;
  const quoteKey = JSON.stringify([
    profileId,
    planId,
    hardwareId,
    billIdentifier,
    addressId,
    agreementVersionId,
    appliedGiftCode,
    quoteRevision,
  ]);
  const quote = step === 3 && quotePacket?.key === quoteKey ? quotePacket.value : null;
  useEffect(() => {
    setAgreementAccepted(false);
    setSubmitForReview(false);
  }, [quote?.reviewDigest]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [profile, catalogue] = await Promise.all([
          readIntake<unknown>(
            queryKeys.profiles.authority(intakeScope, 'saving-intake-profile'),
            '/api/profiles',
            'load',
            { credentials: 'include', signal: controller.signal }
          ),
          readIntake<unknown>(
            queryKeys.catalogue.detail(intakeScope, 'saving-intake-plans'),
            '/api/saving/plans',
            'load',
            { credentials: 'include', signal: controller.signal }
          ),
        ]);
        if (controller.signal.aborted) return;
        const plans = parseSavingCatalogue(catalogue);
        if (!plans) throw new Error('Invalid saving plans');
        const active = readIntakeProfile(profile);
        if (active && active.type !== 'INDIVIDUAL' && active.type !== 'LEGAL') {
          throw new Error('Invalid saving profile type');
        }
        setProfileId(active?.type === 'INDIVIDUAL' ? active.id : null);
        setPlans(plans);
      } catch {
        if (!controller.signal.aborted) setLoadError('intake');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [readIntake, intakeScope, intakeAttempt]);

  useEffect(() => {
    if (!profileId || !plans.length) return;
    const controller = new AbortController();
    void readIntake<unknown>(
      queryKeys.profiles.list(
        { ...intakeScope, context: 'customer', ownerId: profileId },
        new URLSearchParams({ owner: 'saving-intake-addresses' })
      ),
      `/api/profiles/${encodeURIComponent(profileId)}/addresses`,
      'addresses',
      { credentials: 'include', signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          const addresses = readIntakeAddresses(result, profileId);
          setAddresses(addresses);
          setAddressId((current) => current || defaultIntakeAddressId(addresses));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError('addresses');
      })
      .finally(() => {
        if (!controller.signal.aborted) setAddressLoading(false);
      });
    return () => controller.abort();
  }, [profileId, plans.length, readIntake, intakeScope, addressAttempt]);

  function retryIntakeRead() {
    if (loadError === 'intake') {
      setLoading(true);
      setIntakeAttempt((attempt) => attempt + 1);
    } else if (loadError === 'addresses') {
      setAddressLoading(true);
      setAddressAttempt((attempt) => attempt + 1);
    } else return;
    setLoadError(null);
  }

  useEffect(() => {
    if (!profileId || !draft || loading || addressLoading || hydratedProfile.current === profileId)
      return;
    hydratedProfile.current = profileId;
    const saved = draft.data;
    const availablePlans = plans.filter((item) => item.available);
    const initialPlan =
      availablePlans.find((item) => item.id === preferredPlanId) ??
      (!saved && availablePlans.length === 1 ? availablePlans[0] : undefined);
    if (saved) {
      setPlanId(saved.planId);
      setHardwareId(saved.hardwareId);
      setBillIdentifier(saved.billIdentifier);
      setAddressId((current) => saved.addressId || current);
      setGiftCode(saved.giftCode);
    }
    if (initialPlan && initialPlan.id !== saved?.planId) {
      setPlanId(initialPlan.id);
      setHardwareId('');
      setGiftCode('');
    }
    // Renew equipment confirmation and acceptance when restoring a draft.
    wizard.restore(1);
    const baseline = saved
      ? { ...saved, addressId: saved.addressId || currentDraft.addressId }
      : { ...currentDraft, planId: initialPlan?.id ?? '' };
    protection.markSaved(baseline, 1);
  }, [
    profileId,
    draft,
    loading,
    addressLoading,
    currentDraft,
    plans,
    preferredPlanId,
    wizard.restore,
    protection.markSaved,
  ]);
  useEffect(() => {
    if (step > 1 && !hardwareConfirmed) wizard.restore(1);
  }, [step, hardwareConfirmed, wizard.restore]);
  async function saveNow() {
    const saved = await protection.save();
    if (saved) {
      setDraftSaved(true);
      toast.success(t('electricity.order.draftSaved', locale));
    }
    return saved;
  }
  async function advanceStep() {
    if (!canNext) return;
    if (step === 2) setQuotePacket(null);
    await protection.save(step + 1);
  }

  function closeAddressEditor() {
    setAddingAddress(false);
    setProvinceId('');
    setCityId('');
    setFullAddress('');
    setPostalCode('');
    setAddressErrors([]);
  }

  async function saveAddress() {
    if (
      !profileId ||
      !addressLocationReady ||
      !fullAddress.trim() ||
      !validPostalCode ||
      protection.busy ||
      addressCommand.coordination.isLocked()
    )
      return;
    await protection.run(async () => {
      if (!addressCommand.coordination.claim('address')) return;
      setAddressErrors([]);
      const patch = { provinceId, cityId, fullAddress: fullAddress.trim(), postalCode };
      await addressCommand.submit({
        owner: 'address',
        path: `/api/profiles/${profileId}/addresses`,
        method: 'POST',
        status: 201,
        keyed: true,
        body: { ...patch, idempotencyKey: crypto.randomUUID() },
        receipt: (value) => addressReceipt(value, profileId, null, patch),
        fields: (names) => {
          if (
            !names.length ||
            !names.every(
              (name): name is AddressDraftField =>
                typeof name === 'string' && Object.hasOwn(patch, name)
            )
          )
            return false;
          setAddressErrors(names);
          return true;
        },
        accepted: (value) => {
          const address = value as Address;
          setAddresses((values) => [...values.filter((row) => row.id !== address.id), address]);
          setAddressId(address.id);
          closeAddressEditor();
          requestAnimationFrame(() => addressHeading.current?.focus());
          toast.success(t('settings.addresses.success.create', locale));
        },
      });
    });
  }
  async function verifyBill() {
    if (!profileId || !/^[0-9]{6,13}$/.test(billIdentifier)) return;
    await protection.run(async (current, alive) => {
      setVerification('checking');
      let status: 'verified' | 'manual' = 'manual';
      try {
        const result = await postJson<{ status: string }>('/api/saving/orders/verify-bill', {
          profileId,
          billIdentifier,
        });
        status = result.status === 'verified' ? 'verified' : 'manual';
      } catch {
        /* A bill can still be submitted for manual staff verification. */
      } finally {
        if (alive()) setVerification(current() ? status : 'idle');
      }
    });
  }

  useEffect(() => {
    if (step !== 3 || !profileId || !agreementVersionId || !selectedHardware || !addressId) return;
    const controller = new AbortController();
    setQuotePacket(null);
    setQuoteError(false);
    setQuoting(true);
    void readWithDeadline(controller.signal, (signal) =>
      postJson<SavingQuote>(
        '/api/saving/orders/quote',
        {
          profileId,
          savingPlanId: planId,
          hardwareProductId: hardwareId,
          billIdentifier,
          installationAddressId: addressId,
          agreementVersionId,
          ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
        },
        signal
      )
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          !result ||
          !/^[a-f0-9]{64}$/.test(result.reviewDigest) ||
          result.plan?.id !== planId ||
          result.hardware?.id !== hardwareId ||
          result.address?.id !== addressId ||
          result.billIdentifier !== billIdentifier ||
          result.agreement?.versionId !== agreementVersionId ||
          typeof result.agreement.body !== 'string' ||
          !Array.isArray(result.lines)
        )
          throw new Error('Invalid saving quote');
        setQuotePacket({ key: quoteKey, value: result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuoteError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoting(false);
      });
    return () => controller.abort();
  }, [
    step,
    profileId,
    agreementVersionId,
    selectedHardware,
    addressId,
    planId,
    hardwareId,
    billIdentifier,
    appliedGiftCode,
    quoteKey,
  ]);

  useEffect(() => {
    if (step !== 2) {
      setDuplicateChecking(false);
      return;
    }
    setDuplicate(null);
    setDuplicateAcknowledged(false);
    setDuplicateError(false);
    if (!profileId || !planId || !/^[0-9]{6,13}$/.test(billIdentifier)) {
      setDuplicateChecking(false);
      return;
    }
    const controller = new AbortController();
    setDuplicateChecking(true);
    const timer = setTimeout(() => {
      void readWithDeadline(controller.signal, (signal) =>
        postJson<{
          duplicate: boolean;
          preventActiveDuplicates: boolean;
          existingOrderId: string | null;
        }>(
          '/api/saving/orders/duplicate',
          { profileId, savingPlanId: planId, billIdentifier },
          signal
        )
      )
        .then((result) => {
          if (!controller.signal.aborted) setDuplicate(result);
        })
        .catch(() => {
          if (!controller.signal.aborted) setDuplicateError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setDuplicateChecking(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [step, profileId, planId, billIdentifier, duplicateRevision]);

  const canNext =
    step === 1
      ? !!selectedPlan?.available && canConfirmHardware && hardwareConfirmed
      : step === 2
        ? validBill &&
          !duplicateChecking &&
          !duplicateError &&
          (duplicate?.duplicate === false ||
            (duplicate?.preventActiveDuplicates === false && duplicateAcknowledged)) &&
          !addressLoading &&
          !addingAddress &&
          addresses.some((address) => address.id === addressId)
        : false;
  const financialGate = useRiskConfirmation(
    JSON.stringify([
      profileId,
      addressId,
      quote?.reviewDigest,
      planId,
      hardwareId,
      appliedGiftCode,
    ]),
    locale,
    'financial'
  );
  async function sendOrder(input?: object) {
    await protection.run(async (current, alive) => {
      setSubmitting(true);
      setSubmitError('');
      const ownsSubmission = () => current() && getProfileContextRevision() === contextRevision;
      try {
        const result = await submission.send(input, ownsSubmission);
        if (!ownsSubmission()) return;
        if (result.status === 'confirmed') {
          protection.completed.current = true;
          protection.blocker.reset?.();
          toast.success(copy('orderSubmitted'));
          await navigate({
            to: '/savings/orders/$orderId',
            params: { orderId: result.receipt },
          }).catch(() => {});
        } else if (result.status === 'unconfirmed') {
          toast.error(t('electricity.order.unconfirmed', locale));
        } else if (result.status === 'conflict' || result.status === 'rejected') {
          if (result.status === 'conflict') {
            submission.resetPreparation();
            setQuoteRevision((value) => value + 1);
          }
          setSubmitError(copy('orderError'));
        }
      } finally {
        if (alive()) setSubmitting(false);
      }
    });
  }
  async function submit() {
    if (!financialGate.allowed || submission.unconfirmed) return;
    if (
      !profileId ||
      !selectedPlan?.available ||
      !selectedPlan.agreement ||
      !selectedHardware ||
      !hardwareConfirmed ||
      !agreementAccepted ||
      !quote ||
      quoting ||
      quoteError ||
      !submitForReview ||
      addressDirty ||
      giftCode.trim() !== appliedGiftCode ||
      !addresses.some((address) => address.id === addressId)
    )
      return;
    await sendOrder({
      profileId,
      savingPlanId: planId,
      hardwareProductId: hardwareId,
      billIdentifier,
      installationAddressId: addressId,
      agreementVersionId: selectedPlan.agreement.versionId,
      ...(appliedGiftCode ? { giftCode: appliedGiftCode } : {}),
      expectedQuoteDigest: quote.reviewDigest,
      ...(duplicateAcknowledged ? { duplicateAcknowledged: true } : {}),
      agreementAccepted: true,
      hardwareConfirmed: true,
      submitForStaffReview: true,
    });
  }

  const showWizard =
    !loading && loadError !== 'authority' && !!profileId && !!draft && !draftLoading && !draftError;
  const commandBlocked = protection.busy || protection.completed.current || submission.unconfirmed;
  const controlsBlocked = !!loadError || commandBlocked;
  return (
    <div
      className="mx-auto w-full max-w-4xl space-y-4 py-3 sm:py-5"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {protection.blocker.status === 'blocked' && (
        <Suspense fallback={<p role="status">{copy('loading')}</p>}>
          <LeaveDialog
            onSave={saveNow}
            working={protection.busy || fields.pending}
            workingLabel={copy('loading')}
            saveDisabled={addressDirty || submission.unconfirmed}
            errorMessage={
              submission.unconfirmed
                ? t('electricity.order.unconfirmed', locale)
                : addressDirty
                  ? t('electricity.order.unsaved.address', locale)
                  : draftSaveError
                    ? copy('draftSaveError')
                    : undefined
            }
            onStay={() => protection.blocker.reset?.()}
            onLeave={() => protection.blocker.proceed?.()}
          />
        </Suspense>
      )}
      <header className="space-y-1" data-toast-anchor={!showWizard || undefined}>
        <Link to="/savings" className="touch-action text-sm text-primary hover:underline">
          {copy('title')}
        </Link>
        <h1 className="text-2xl font-semibold sm:text-3xl">{copy('orderTitle')}</h1>
      </header>
      {loading && <LoadingStatus>{copy('loading')}</LoadingStatus>}
      {loadError && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{copy(loadError === 'intake' ? 'intakeLoadError' : 'addressLoadError')}</p>
          {loadError !== 'authority' && (
            <Button variant="outline" onClick={retryIntakeRead}>
              {copy('retry')}
            </Button>
          )}
        </div>
      )}
      {draftError && profileId && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{copy('draftLoadError')}</p>
          <Button variant="outline" onClick={retryDraft}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {draftLoading && profileId && <LoadingStatus>{copy('loading')}</LoadingStatus>}
      {!loading && !loadError && !profileId && <p role="alert">{copy('profileRequired')}</p>}
      {!loading && !loadError && profileId && !plans.length && <p role="status">{copy('empty')}</p>}
      {addressCommand.phase !== 'ready' && (
        <div role="alert" className="space-y-2">
          <p>{copy('addressUnconfirmed')}</p>
          <Button
            disabled={addressCommand.busy || protection.busy}
            onClick={() =>
              void protection.run(async () => {
                await addressCommand.send();
              })
            }
          >
            {copy('retryAddress')}
          </Button>
        </div>
      )}
      {addressDirty && step !== 2 && (
        <div role="alert" className="space-y-2">
          <p>{t('electricity.order.unsaved.address', locale)}</p>
          <Button
            variant="outline"
            onClick={() => {
              void wizard.go(2, step);
            }}
          >
            {copy('stepAddress')}
          </Button>
        </div>
      )}
      {submission.unconfirmed && (
        <SubmissionRecovery
          history="/savings/orders"
          busy={submitting}
          onRetry={() => void sendOrder()}
        />
      )}
      {showWizard && (
        <ValidatedFormWizard
          form={fields.form}
          errorId={fields.errorId}
          onPendingChange={fields.setValidationPending}
          disabled={
            loading ||
            (step === 1 && addressLoading) ||
            draftLoading ||
            !!draftError ||
            !!addressCommand.locked ||
            !profileId ||
            controlsBlocked ||
            submitting
          }
          onInvalidStep={(target) => wizard.go(target, step)}
          fields={[
            [
              { name: 'planId', label: copy('choosePlan') },
              { name: 'hardwareId', label: copy('chooseHardware') },
              { name: 'hardwareConfirmed', label: copy('confirmHardware') },
            ],
            [
              { name: 'billIdentifier', label: copy('billIdentifier') },
              { name: 'duplicateAcknowledged', label: copy('acknowledgeDuplicate') },
              { name: 'addressId', label: copy('chooseAddress') },
            ],
            [
              { name: 'agreementAccepted', label: copy('acceptAgreement') },
              { name: 'giftCode', label: copy('giftCode') },
              { name: 'submitForReview', label: copy('submitForReview') },
            ],
          ]}
          steps={steps.map(copy)}
          step={step}
          ariaLabel={copy('orderTitle')}
          anchorNotices
          compactProgress
          actionsClassName={
            step < 3 && (step !== 2 || !addingAddress)
              ? `${wizardActionSurface} max-lg:sticky max-lg:bottom-0 max-lg:z-20 [&>button]:min-h-11`
              : wizardActionSurface
          }
          backLabel={copy('back')}
          saveLabel={t('electricity.order.saveDraft', locale)}
          nextLabel={copy(step === 2 ? 'stepReview' : 'next')}
          submitLabel={copy('submit')}
          savingLabel={t('electricity.order.savingDraft', locale)}
          submittingLabel={copy('submitting')}
          saving={savingDraft}
          submitting={submitting}
          backDisabled={controlsBlocked || addressDirty}
          saveDisabled={controlsBlocked || addressDirty}
          nextDisabled={controlsBlocked || !canNext}
          submitDisabled={
            controlsBlocked ||
            !financialGate.allowed ||
            !quote ||
            quoting ||
            quoteError ||
            !hardwareConfirmed ||
            !agreementAccepted ||
            !submitForReview ||
            giftCode.trim() !== appliedGiftCode ||
            addressDirty
          }
          onBack={() => void protection.save(step - 1)}
          onSave={() => void saveNow()}
          onNext={advanceStep}
          onSubmit={submit}
        >
          {(pending) => (
            <Card size="sm">
              <CardContent className="space-y-4">
                <fieldset
                  className="min-w-0 space-y-4"
                  disabled={pending || commandBlocked || !!addressCommand.locked}
                >
                  <legend className="sr-only">{copy(steps[step - 1] ?? 'orderTitle')}</legend>
                  {step === 1 && (
                    <div
                      className={
                        selectedPlan?.available
                          ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]'
                          : undefined
                      }
                    >
                      <section className="min-w-0 space-y-2">
                        <h2 id="saving-plan-title" className="text-base font-semibold">
                          {copy('choosePlan')}
                        </h2>
                        <div
                          role="radiogroup"
                          aria-labelledby="saving-plan-title"
                          aria-required="true"
                          className="space-y-2"
                        >
                          {plans.map((plan) => (
                            <label key={plan.id} className={choiceCard}>
                              <input
                                type="radio"
                                {...fields.bind('planId')}
                                className={choiceRadio}
                                value={plan.id}
                                checked={planId === plan.id}
                                disabled={!plan.available}
                                onChange={() => {
                                  setPlanId(plan.id);
                                  setHardwareId('');
                                  setHardwareConfirmed(false);
                                  setAgreementAccepted(false);
                                }}
                              />
                              <span className="min-w-0 flex-1 space-y-1">
                                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                  <span className="text-sm font-medium">{title(plan)}</span>
                                  <bdi className="text-sm font-medium wrap-anywhere">
                                    {plan.price ? numbers.money(plan.price) : copy('unpriced')}
                                  </bdi>
                                </span>
                                {!plan.available && (
                                  <span className="block text-xs font-medium text-muted-foreground">
                                    {copy('unavailable')}
                                  </span>
                                )}
                                {plan.description?.[locale] && (
                                  <span className="block text-xs text-muted-foreground">
                                    {plan.description[locale]}
                                  </span>
                                )}
                              </span>
                            </label>
                          ))}
                        </div>
                      </section>
                      {selectedPlan?.available && (
                        <section className="min-w-0 space-y-2 border-t pt-3 lg:border-s lg:border-t-0 lg:ps-4 lg:pt-0">
                          <h2 id="saving-hardware-title" className="text-base font-semibold">
                            {copy('chooseHardware')}
                          </h2>
                          <div
                            role="radiogroup"
                            aria-labelledby="saving-hardware-title"
                            aria-required="true"
                            className="space-y-2"
                          >
                            {selectedPlan.hardware.map((item) => {
                              const outOfStock =
                                !!item.stock_tracking && (item.available_count ?? 0) < 1;
                              return (
                                <label key={item.id} className={choiceCard}>
                                  <input
                                    type="radio"
                                    {...fields.bind('hardwareId')}
                                    className={choiceRadio}
                                    value={item.id}
                                    checked={hardwareId === item.id}
                                    disabled={item.status !== 'active' || outOfStock}
                                    onChange={() => {
                                      setHardwareId(item.id);
                                      setHardwareConfirmed(false);
                                    }}
                                  />
                                  <span className="min-w-0 flex-1 space-y-1">
                                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                      <span
                                        id={`saving-equipment-${item.id}`}
                                        className="text-sm font-medium"
                                      >
                                        {title(item)}
                                      </span>
                                      <bdi className="text-sm font-medium wrap-anywhere">
                                        {item.price ? numbers.money(item.price) : copy('unpriced')}
                                      </bdi>
                                    </span>
                                    {item.description?.[locale] && (
                                      <span className="block text-xs text-muted-foreground">
                                        {item.description[locale]}
                                      </span>
                                    )}
                                    <span className="block text-xs text-muted-foreground">
                                      {copy(
                                        item.status !== 'active'
                                          ? 'unavailable'
                                          : outOfStock
                                            ? 'outOfStock'
                                            : item.stock_tracking
                                              ? 'inStock'
                                              : 'stockPending'
                                      )}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          {canConfirmHardware && (
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/45 px-3 py-1.5 text-sm">
                              <input
                                type="checkbox"
                                {...fields.bind('hardwareConfirmed')}
                                className="size-4 shrink-0 accent-primary"
                                aria-required="true"
                                aria-describedby={[
                                  `saving-equipment-${hardwareId}`,
                                  fields.form.getFieldState('hardwareConfirmed').invalid
                                    ? fields.errorId('hardwareConfirmed')
                                    : undefined,
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                checked={hardwareConfirmed}
                                onChange={(event) => setHardwareConfirmed(event.target.checked)}
                              />
                              {copy('confirmHardware')}
                            </label>
                          )}
                        </section>
                      )}
                    </div>
                  )}
                  {step === 2 && (
                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                      <section className="min-w-0 space-y-2">
                        <h2 className="text-base font-semibold">
                          <label htmlFor="saving-bill-identifier">{copy('billIdentifier')}</label>
                        </h2>
                        <p id="saving-bill-hint" className="text-xs text-muted-foreground">
                          {copy('billIdentifierHint')}
                        </p>
                        <div className="flex items-start gap-2">
                          <Input
                            id="saving-bill-identifier"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={13}
                            {...fields.bind('billIdentifier')}
                            aria-required="true"
                            aria-invalid={
                              invalidBill ||
                              fields.form.getFieldState('billIdentifier').invalid ||
                              undefined
                            }
                            aria-describedby={
                              invalidBill
                                ? 'saving-bill-error'
                                : fields.form.getFieldState('billIdentifier').invalid
                                  ? fields.errorId('billIdentifier')
                                  : 'saving-bill-hint'
                            }
                            value={billIdentifier}
                            onChange={(event) => {
                              setBillIdentifier(
                                normalizeProfileDigits(event.target.value).replace(/[^0-9]/g, '')
                              );
                              setDuplicate(null);
                              setDuplicateAcknowledged(false);
                              setVerification('idle');
                            }}
                            className="min-w-0 flex-1 tabular-nums"
                            dir="ltr"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 shrink-0"
                            disabled={!validBill || verification === 'checking'}
                            onClick={() => void verifyBill()}
                          >
                            {copy(verification === 'checking' ? 'verifyingBill' : 'verifyBill')}
                          </Button>
                        </div>
                        {invalidBill && (
                          <p id="saving-bill-error" className="text-sm text-destructive">
                            {copy('invalidBill')}
                          </p>
                        )}
                        {duplicateError && (
                          <div role="alert" className="space-y-2 text-sm text-destructive">
                            <p>{copy('duplicateCheckError')}</p>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setDuplicateRevision((value) => value + 1)}
                            >
                              {copy('retry')}
                            </Button>
                          </div>
                        )}
                        {duplicateChecking && (
                          <p role="status" className="text-sm text-muted-foreground">
                            {copy('duplicateChecking')}
                          </p>
                        )}
                        {verification === 'verified' && (
                          <p role="status" className="text-sm font-medium">
                            {copy('verified')}
                          </p>
                        )}
                        {verification === 'manual' && (
                          <p role="status" className="text-sm text-muted-foreground">
                            {copy('manualReview')}
                          </p>
                        )}
                        {duplicate?.duplicate && (
                          <div
                            role="alert"
                            className="rounded-md border border-destructive/30 p-3 text-sm"
                          >
                            <p>
                              {copy(
                                !duplicate.preventActiveDuplicates
                                  ? 'duplicateAllowedNotice'
                                  : duplicate.existingOrderId
                                    ? 'duplicateOrder'
                                    : 'duplicateSupport'
                              )}
                            </p>
                            {duplicate.existingOrderId && (
                              <Link
                                to="/savings/orders/$orderId"
                                params={{ orderId: duplicate.existingOrderId }}
                                className="text-primary hover:underline"
                              >
                                {copy('openExisting')}
                              </Link>
                            )}
                            {!duplicate.preventActiveDuplicates && (
                              <label className="touch-label mt-3 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  {...fields.bind('duplicateAcknowledged')}
                                  aria-required="true"
                                  checked={duplicateAcknowledged}
                                  onChange={(event) =>
                                    setDuplicateAcknowledged(event.target.checked)
                                  }
                                />
                                {copy('acknowledgeDuplicate')}
                              </label>
                            )}
                          </div>
                        )}
                      </section>
                      <section className="min-w-0 space-y-2 border-t pt-3 lg:border-s lg:border-t-0 lg:ps-4 lg:pt-0">
                        <h2
                          id="saving-address-title"
                          ref={addressHeading}
                          tabIndex={-1}
                          className="scroll-mt-3 text-base font-semibold"
                        >
                          {copy(addingAddress ? 'newInstallationAddress' : 'chooseAddress')}
                        </h2>
                        {addressLoading && <LoadingStatus>{copy('loading')}</LoadingStatus>}
                        {!addingAddress && !addressLoading && !loadError && !addresses.length && (
                          <p role="status">{copy('noSavedAddresses')}</p>
                        )}
                        {!addingAddress && addresses.length > 0 && (
                          <div
                            role="radiogroup"
                            aria-labelledby="saving-address-title"
                            aria-required="true"
                            className="space-y-2"
                          >
                            {addresses.map((address) => (
                              <label key={address.id} className={choiceCard}>
                                <input
                                  type="radio"
                                  {...fields.bind('addressId')}
                                  className={choiceRadio}
                                  value={address.id}
                                  checked={addressId === address.id}
                                  onChange={() => setAddressId(address.id)}
                                />
                                <span className="min-w-0 space-y-1 text-sm">
                                  <span className="block font-medium wrap-anywhere">
                                    {address.fullAddress}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {copy('postalCode')} <bdi>{address.postalCode}</bdi>
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        {!addingAddress && (
                          <Button
                            ref={addAddressButton}
                            type="button"
                            variant="outline"
                            disabled={addressLoading || !!loadError}
                            onClick={() => {
                              setAddingAddress(true);
                              requestAnimationFrame(() => addressHeading.current?.focus());
                            }}
                          >
                            {copy('newAddress')}
                          </Button>
                        )}
                        {addressErrorMessage && <p role="alert">{addressErrorMessage}</p>}
                        {addingAddress && (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="min-w-0 space-y-1">
                                <label
                                  htmlFor="saving-address-province"
                                  className="block text-sm font-medium"
                                >
                                  {copy('province')}
                                </label>
                                <NativeSelect
                                  id="saving-address-province"
                                  className="w-full"
                                  {...bindAddressField('provinceId')}
                                  value={provinceId}
                                  disabled={savingAddress || !provinceOptions.ready}
                                  onChange={(event) => {
                                    setProvinceId(event.target.value);
                                    setCityId('');
                                  }}
                                >
                                  <option value="">
                                    {t('settings.addresses.form.provincePlaceholder', locale)}
                                  </option>
                                  {provinces.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {locale === 'fa' ? item.nameFa : item.nameEn}
                                    </option>
                                  ))}
                                </NativeSelect>
                                {addressFieldError('provinceId')}
                                <GeographyLoadError
                                  {...provinceOptions}
                                  message={t('settings.addresses.error.loadProvinces', locale)}
                                  locale={locale}
                                  testId="saving-address-province-retry"
                                />
                              </div>
                              <div className="min-w-0 space-y-1">
                                <label
                                  htmlFor="saving-address-city"
                                  className="block text-sm font-medium"
                                >
                                  {copy('city')}
                                </label>
                                <div className="relative">
                                  <DependentSelect
                                    id="saving-address-city"
                                    className="h-11 appearance-none rounded-lg bg-transparent py-1 pe-8 ps-2.5"
                                    dependencyValue={provinceId}
                                    {...bindAddressField('cityId')}
                                    value={cityId}
                                    ready={cityOptions.ready}
                                    loading={cityOptions.loading}
                                    disabled={savingAddress}
                                    options={cities.map((city) => ({
                                      value: city.id,
                                      label: locale === 'fa' ? city.nameFa : city.nameEn,
                                      dependencyValue: city.provinceId ?? '',
                                    }))}
                                    placeholder={
                                      !provinceId
                                        ? addressesText('provinceFirst', locale)
                                        : cityOptions.loading
                                          ? addressesText('loadingCities', locale)
                                          : t('settings.addresses.form.cityPlaceholder', locale)
                                    }
                                    onChange={(event) => setCityId(event.target.value)}
                                  />
                                  <ChevronDownIcon
                                    aria-hidden="true"
                                    className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                                  />
                                </div>
                                {addressFieldError('cityId')}
                                <GeographyLoadError
                                  {...cityOptions}
                                  message={t('settings.addresses.error.loadCities', locale)}
                                  locale={locale}
                                  testId="saving-address-city-retry"
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label
                                htmlFor="saving-address-full"
                                className="block text-sm font-medium"
                              >
                                {copy('fullAddress')}
                              </label>
                              <Textarea
                                id="saving-address-full"
                                autoComplete="street-address"
                                placeholder={addressesText('streetExample', locale)}
                                rows={2}
                                maxLength={500}
                                {...bindAddressField('fullAddress')}
                                value={fullAddress}
                                onChange={(event) => setFullAddress(event.target.value)}
                              />
                              {addressFieldError('fullAddress')}
                            </div>
                            <div className="max-w-xs space-y-1">
                              <label
                                htmlFor="saving-address-postal"
                                className="block text-sm font-medium"
                              >
                                {copy('postalCode')}
                              </label>
                              <Input
                                id="saving-address-postal"
                                autoComplete="postal-code"
                                inputMode="numeric"
                                dir="ltr"
                                maxLength={10}
                                {...bindAddressField('postalCode')}
                                value={postalCode}
                                onChange={(event) =>
                                  setPostalCode(
                                    normalizeProfileDigits(event.target.value).replace(
                                      /[^0-9]/g,
                                      ''
                                    )
                                  )
                                }
                              />
                              <p
                                id={fields.errorId('postalCode')}
                                className={
                                  invalidPostalCode || addressErrors.includes('postalCode')
                                    ? 'text-xs text-destructive'
                                    : 'text-xs text-muted-foreground'
                                }
                              >
                                {addressErrors.includes('postalCode') && !invalidPostalCode
                                  ? invalidField
                                  : addressesText('postalCodeFormat', locale)}
                              </p>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={savingAddress}
                                onClick={() => {
                                  closeAddressEditor();
                                  requestAnimationFrame(() => addAddressButton.current?.focus());
                                }}
                              >
                                {t('electricity.order.cancel', locale)}
                              </Button>
                              <Button
                                type="button"
                                disabled={
                                  savingAddress ||
                                  !addressLocationReady ||
                                  !fullAddress.trim() ||
                                  !validPostalCode
                                }
                                onClick={() => void saveAddress()}
                              >
                                {copy('saveAddress')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                  {step === 3 && (
                    <section className="space-y-4">
                      <SavingsOrderReview
                        quote={quote}
                        quoting={quoting}
                        quoteError={quoteError}
                        retryQuote={() => setQuoteRevision((value) => value + 1)}
                        plan={selectedPlan}
                        hardware={selectedHardware}
                        billIdentifier={billIdentifier}
                        address={addresses.find((address) => address.id === addressId)}
                        appliedGiftCode={appliedGiftCode}
                        onEdit={(target) => void protection.save(target)}
                        editDisabled={pending || protection.busy || protection.completed.current}
                      />
                      <label className="touch-label flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...fields.bind('agreementAccepted')}
                          aria-required="true"
                          checked={agreementAccepted}
                          disabled={!quote || quoting || quoteError}
                          onChange={(event) => setAgreementAccepted(event.target.checked)}
                        />
                        {copy('acceptAgreement')}
                      </label>
                      <div className="space-y-2">
                        <details className="group rounded-lg border [&[open]>div]:px-3 [&[open]>div]:pb-3">
                          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                            {copy('giftOptional')}
                            <ChevronDownIcon
                              aria-hidden="true"
                              className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                            />
                          </summary>
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="min-w-0 flex-1 basis-32 text-sm">
                              {copy('giftCode')}
                              <input
                                className="mt-1 w-full rounded-md border bg-background p-2"
                                {...fields.bind('giftCode')}
                                value={giftCode}
                                onChange={(event) => setGiftCode(event.target.value)}
                              />
                            </label>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setAppliedGiftCode(giftCode.trim());
                                setQuoteRevision((value) => value + 1);
                                submission.resetPreparation();
                              }}
                            >
                              {copy('apply')}
                            </Button>
                          </div>
                        </details>
                        {giftCode.trim() !== appliedGiftCode && (
                          <p role="status" className="text-sm">
                            {t('electricity.order.applyGiftFirst', locale)}
                          </p>
                        )}
                      </div>
                      {profileId && (
                        <div className="rounded-lg border p-3 [&_button]:self-start">
                          <OrderWalletBalance
                            profileId={profileId}
                            total={quote?.totalIrR ?? '0'}
                            checkout={{
                              label: copy('walletBalance'),
                              balanceField: 'availableBalance',
                            }}
                          />
                        </div>
                      )}
                      <label className="touch-label flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...fields.bind('submitForReview')}
                          aria-required="true"
                          checked={submitForReview}
                          onChange={(event) => setSubmitForReview(event.target.checked)}
                        />
                        {copy('submitForReview')}
                      </label>
                      <CommandFeedback
                        message={submitError || null}
                        kind="error"
                        className="text-destructive"
                      />
                    </section>
                  )}
                </fieldset>
                {draftSaved && !protection.dirty && !draftSaveError && (
                  <p role="status">{t('electricity.order.draftSaved', locale)}</p>
                )}
                {draftSaveError && (
                  <p role="alert" className="text-destructive">
                    {copy('draftSaveError')}
                  </p>
                )}
                {step === 3 && (
                  <ConfirmationFields
                    gate={financialGate}
                    disabled={submitting || submission.unconfirmed}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </ValidatedFormWizard>
      )}
    </div>
  );
}
