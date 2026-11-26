import { toast } from '../lib/toast-api.js';
import { takeSavedOrderAddress } from '../lib/order-address-handoff.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { SubmissionRecovery } from '../components/SubmissionRecovery.js';
import { ConfirmationFields } from '@barghsa/ui';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { queryKeys } from '../lib/query-keys.js';
import { useOwnedManualServerRead } from '../hooks/useServerQuery.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { SolarRequestReview } from '../components/SolarRequestReview.js';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, Info, PlusIcon } from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  LoadingStatus,
  Button,
  Card,
  CardContent,
  DatePicker,
  Input,
  Label,
  NativeSelect,
  Textarea,
  datePickerCalendarDate,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { wizardActionSurface } from '../components/FormWizard.js';
import { ValidatedFormWizard } from '../components/ValidatedFormWizard.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { z } from 'zod';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { useWizardDraftProtection } from '../hooks/useWizardDraftProtection.js';
import { useReviewedSubmission } from '../hooks/useReviewedSubmission.js';
import { sameFormData, uuidReference } from '../lib/form-receipt.js';
import { tSolar } from '@barghsa/i18n/solar';
import { solarIntakeText } from '@barghsa/i18n/solar-intake';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { useFormDraft, type DraftSchema } from '../hooks/useFormDraft.js';
import {
  defaultIntakeAddressId,
  readIntakeProfile,
  readIntakeAddresses,
  type IntakeAddress as Address,
} from '../lib/service-intake-records.js';

export interface SolarReview {
  hash: string;
  data: {
    submission: Record<string, string | number | boolean>;
    siteAddress: string | null;
    siteAddressSnapshot: {
      id: string;
      province_id: string;
      city_id: string;
      full_address: string;
      postal_code: string;
    };
    agreementVersion: string;
    agreementText: string;
    createsContract: false;
    createsInvoice: false;
  };
}
type BuildingType = 'building_apartment' | 'non_household';
const gridTypes = ['on_grid', 'off_grid'] as const;
type GridType = '' | (typeof gridTypes)[number];
const propertyForms = ['apartment', 'villa'] as const;
const structuralFrames = ['concrete', 'steel', 'other'] as const;
const siteCategories = ['agricultural', 'industrial'] as const;
const installationSurfaces = ['land', 'rooftop', 'both'] as const;
const siteRelationships = ['owner', 'tenant', 'authorized_operator'] as const;
interface SolarDraft {
  buildingType: BuildingType;
  propertyForm: '' | (typeof propertyForms)[number];
  structuralFrame: '' | (typeof structuralFrames)[number];
  buildingCompletionDate: string;
  totalUnits: string;
  siteCategory: '' | (typeof siteCategories)[number];
  installationSurface: '' | (typeof installationSurfaces)[number];
  usableAreaSqm: string;
  siteAddressId: string;
  siteRelationship: '' | (typeof siteRelationships)[number];
  siteDescription: string;
  gridType: GridType;
  billIdentifier: string;
}

const solarDraftSchema: DraftSchema<SolarDraft> = {
  safeParse(value) {
    if (!value || typeof value !== 'object') return { success: false };
    const data = value as Record<string, unknown>;
    if (
      !['building_apartment', 'non_household'].includes(String(data.buildingType)) ||
      !['', ...propertyForms].includes(String(data.propertyForm)) ||
      !['', ...structuralFrames].includes(String(data.structuralFrame)) ||
      !['', ...siteCategories].includes(String(data.siteCategory)) ||
      !['', ...installationSurfaces].includes(String(data.installationSurface)) ||
      !['', ...siteRelationships].includes(String(data.siteRelationship)) ||
      !['', ...gridTypes].includes(String(data.gridType)) ||
      [
        'buildingCompletionDate',
        'totalUnits',
        'usableAreaSqm',
        'siteAddressId',
        'siteDescription',
        'billIdentifier',
      ].some((key) => typeof data[key] !== 'string')
    )
      return { success: false };
    return { success: true, data: data as unknown as SolarDraft };
  },
};

function completionDateValid(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10)
  );
}

const persianCompletionDate = new Intl.DateTimeFormat('fa-IR', {
  calendar: 'persian',
  timeZone: 'UTC',
  dateStyle: 'long',
});
const gregorianCompletionDate = new Intl.DateTimeFormat('en-US', {
  calendar: 'gregory',
  timeZone: 'UTC',
  dateStyle: 'long',
});
const persianAge = new Intl.NumberFormat('fa-IR');

function normalizeQuantity(value: string) {
  return normalizeProfileDigits(value).replace(/٫/g, '.');
}
function quantityValue(value: string) {
  const normalized = normalizeQuantity(value);
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)
    ? Number(normalized)
    : NaN;
}
function unitsValid(value: string) {
  const units = quantityValue(value);
  return Number.isInteger(units) && units >= 1 && units <= 100000;
}
function areaValid(value: string) {
  const area = quantityValue(value);
  return area >= 0.01 && area <= 1000000 && Math.round(area * 100) / 100 === area;
}

const LeaveDialog = lazy(() => import('../components/WizardLeaveDialog.js'));
const solarChoice =
  'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/35 has-checked:border-primary has-checked:bg-primary/5';

export function SolarRequestPage() {
  const navigate = useNavigate();
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const wizard = useWizardStep('/solar/requests/new', 3);
  const { step } = wizard;
  const [profileId, setProfileId] = useState('');
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readReview = useOwnedManualServerRead(JSON.stringify([actor, profileRevision, profileId]));
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const invalidField = t('formWizard.invalidField', locale);
  const fields = useWizardForm(
    z
      .object({
        buildingType: z.enum(['building_apartment', 'non_household']),
        propertyForm: z.enum(['', ...propertyForms]),
        structuralFrame: z.enum(['', ...structuralFrames]),
        buildingCompletionDate: z.string(),
        totalUnits: z.string(),
        siteCategory: z.enum(['', ...siteCategories]),
        installationSurface: z.enum(['', ...installationSurfaces]),
        usableAreaSqm: z.string(),
        siteAddressId: z.string(),
        siteRelationship: z.enum(['', ...siteRelationships]),
        siteDescription: z.string(),
        gridType: z.enum(['', ...gridTypes]),
        billIdentifier: z.string(),
        agreementAccepted: z.boolean(),
      })
      .superRefine((value, context) => {
        const invalid = (name: keyof typeof value, message = invalidField) =>
          context.addIssue({ code: 'custom', path: [name], message });
        if (!addresses.some((address) => address.id === value.siteAddressId))
          invalid('siteAddressId');
        if (value.buildingType === 'building_apartment') {
          if (!value.propertyForm)
            invalid('propertyForm', solarIntakeText('choosePropertyForm', locale));
          if (!value.structuralFrame)
            invalid('structuralFrame', solarIntakeText('chooseStructuralFrame', locale));
          if (!completionDateValid(value.buildingCompletionDate)) invalid('buildingCompletionDate');
          if (value.propertyForm === 'apartment' && !unitsValid(value.totalUnits))
            invalid('totalUnits', solarIntakeText('unitsFormat', locale));
        } else {
          if (!value.siteCategory)
            invalid('siteCategory', solarIntakeText('chooseSiteCategory', locale));
          if (!value.installationSurface)
            invalid('installationSurface', solarIntakeText('chooseInstallationSurface', locale));
          if (!value.siteRelationship)
            invalid('siteRelationship', solarIntakeText('chooseSiteRelationship', locale));
          if (!areaValid(value.usableAreaSqm))
            invalid('usableAreaSqm', solarIntakeText('areaFormat', locale));
        }
        if (!value.gridType) invalid('gridType', solarIntakeText('chooseGridType', locale));
        if (
          value.gridType === 'on_grid' &&
          !/^[0-9]{6,13}$/.test(normalizeProfileDigits(value.billIdentifier))
        )
          invalid('billIdentifier', solarIntakeText('billFormat', locale));
        if (!value.agreementAccepted) invalid('agreementAccepted');
      }),
    {
      buildingType: 'building_apartment',
      propertyForm: '',
      structuralFrame: '',
      buildingCompletionDate: '',
      totalUnits: '',
      siteCategory: '',
      installationSurface: '',
      usableAreaSqm: '',
      siteAddressId: '',
      siteRelationship: '',
      siteDescription: '',
      gridType: '',
      billIdentifier: '',
      agreementAccepted: false,
    }
  );
  const [buildingType, setBuildingType] = fields.field('buildingType');
  const [propertyForm, setPropertyForm] = fields.field('propertyForm');
  const [structuralFrame, setStructuralFrame] = fields.field('structuralFrame');
  const [buildingCompletionDate, setBuildingCompletionDate] =
    fields.field('buildingCompletionDate');
  const { onBlur: blurCompletionDate, ...completionDateField } =
    fields.bind('buildingCompletionDate');
  const [manualCompletionDate, setManualCompletionDate] = useState(false);
  const focusCompletionDate = useRef(false);
  useEffect(() => {
    if (!focusCompletionDate.current) return;
    focusCompletionDate.current = false;
    document.getElementById('solar-completion')?.focus();
  }, [manualCompletionDate]);
  const completionDateAttributes = {
    ...completionDateField,
    'aria-required': true,
    'aria-describedby': [completionDateField['aria-describedby'], 'solar-completion-hint']
      .filter(Boolean)
      .join(' '),
  };
  const [totalUnits, setTotalUnits] = fields.field('totalUnits');
  const [siteCategory, setSiteCategory] = fields.field('siteCategory');
  const [installationSurface, setInstallationSurface] = fields.field('installationSurface');
  const [usableAreaSqm, setUsableAreaSqm] = fields.field('usableAreaSqm');
  const [siteAddressId, setSiteAddressId] = fields.field('siteAddressId');
  const selectedSiteAddress = addresses.find((address) => address.id === siteAddressId);
  const hasSiteAddresses = addresses.length > 0;
  const savedSiteAddressUnavailable = Boolean(siteAddressId && !selectedSiteAddress);
  const siteAddressField = fields.bind('siteAddressId');
  const [siteRelationship, setSiteRelationship] = fields.field('siteRelationship');
  const [siteDescription, setSiteDescription] = fields.field('siteDescription');
  const [gridType, setGridType] = fields.field('gridType');
  const [billIdentifier, setBillIdentifier] = fields.field('billIdentifier');
  const [agreementAccepted, setAgreementAccepted] = fields.field('agreementAccepted');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const submission = useReviewedSubmission('/api/solar/requests', profileId, (value) =>
    uuidReference((value as { requestId?: unknown } | null)?.requestId)
  );
  const [review, setReview] = useState<SolarReview | null>(null);
  const [reviewInput, setReviewInput] = useState<Record<string, unknown> | null>(null);
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const reviewFingerprint = useRef('');
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftKey = profileId
    ? `/api/solar/requests/draft?profileId=${encodeURIComponent(profileId)}`
    : null;
  const {
    draft,
    loading: draftLoading,
    error: draftError,
    save: saveDraft,
    retry: retryDraft,
  } = useFormDraft(draftKey, solarDraftSchema, 4);
  const saveWizardDraft = useCallback(
    (target: number, data: SolarDraft) => saveDraft(target === 3 ? 4 : target, data),
    [saveDraft]
  );

  useEffect(() => {
    const controller = new AbortController();
    void readWithDeadline(controller.signal, async (signal) => {
      const response = await fetch('/api/profiles', { credentials: 'include', signal });
      if (!response.ok) throw new Error('profile');
      const active = readIntakeProfile(await response.json());
      if (!active) return { id: '', addresses: [] };
      signal.throwIfAborted();
      const addressResponse = await fetch(
        `/api/profiles/${encodeURIComponent(active.id)}/addresses`,
        {
          credentials: 'include',
          signal,
        }
      );
      if (!addressResponse.ok) throw new Error('addresses');
      return {
        id: active.id,
        addresses: readIntakeAddresses(await addressResponse.json(), active.id),
      };
    })
      .then(({ id, addresses: siteAddresses }) => {
        if (controller.signal.aborted) return;
        setProfileId(id);
        setAddresses(siteAddresses);
        setSiteAddressId((current) => current || defaultIntakeAddressId(siteAddresses));
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadAttempt]);

  const currentDraft = useMemo<SolarDraft>(
    () => ({
      buildingType,
      propertyForm,
      structuralFrame,
      buildingCompletionDate,
      totalUnits,
      siteCategory,
      installationSurface,
      usableAreaSqm,
      siteAddressId,
      siteRelationship,
      siteDescription,
      gridType,
      billIdentifier,
    }),
    [
      buildingType,
      propertyForm,
      structuralFrame,
      buildingCompletionDate,
      totalUnits,
      siteCategory,
      installationSurface,
      usableAreaSqm,
      siteAddressId,
      siteRelationship,
      siteDescription,
      gridType,
      billIdentifier,
    ]
  );

  const protection = useWizardDraftProtection({
    profileId,
    data: currentDraft,
    step,
    ready: draftHydrated && !loading && !draftLoading && !draftError,
    saveDraft: saveWizardDraft,
    go: wizard.go,
    unconfirmed: submission.unconfirmed,
  });
  const fingerprint = JSON.stringify([profileId, currentDraft, agreementAccepted]);
  const propertyValid = (value: SolarDraft) =>
    addresses.some((address) => address.id === value.siteAddressId) &&
    (value.buildingType === 'non_household'
      ? value.siteCategory !== '' &&
        value.installationSurface !== '' &&
        value.siteRelationship !== '' &&
        areaValid(value.usableAreaSqm)
      : value.propertyForm !== '' &&
        value.structuralFrame !== '' &&
        completionDateValid(value.buildingCompletionDate) &&
        (value.propertyForm === 'villa' || unitsValid(value.totalUnits)));
  const gridValid = (value: SolarDraft) =>
    value.gridType === 'off_grid' ||
    (value.gridType === 'on_grid' &&
      /^[0-9]{6,13}$/.test(normalizeProfileDigits(value.billIdentifier)));
  useEffect(() => {
    if (!draft || draftHydrated || loading) return;
    const saved = draft.data;
    const returnedAddress = takeSavedOrderAddress(profileId, addresses);
    if (saved) {
      setBuildingType(saved.buildingType);
      setPropertyForm(saved.propertyForm);
      setStructuralFrame(saved.structuralFrame);
      setBuildingCompletionDate(saved.buildingCompletionDate);
      setTotalUnits(saved.totalUnits);
      setSiteCategory(saved.siteCategory);
      setInstallationSurface(saved.installationSurface);
      setUsableAreaSqm(saved.usableAreaSqm);
      setSiteAddressId(
        returnedAddress ?? (saved.siteAddressId || defaultIntakeAddressId(addresses))
      );
      setSiteRelationship(saved.siteRelationship);
      setSiteDescription(saved.siteDescription);
      setGridType(saved.gridType);
      setBillIdentifier(saved.billIdentifier);
    } else if (returnedAddress) setSiteAddressId(returnedAddress);
    // Consent and the server review are renewed in every resumed session.
    const restored = saved && propertyValid(saved) ? Math.min(draft.currentStep, 2) : 1;
    wizard.restore(restored);
    protection.markSaved(saved ?? currentDraft, restored);
    setDraftHydrated(true);
  }, [
    draft,
    draftHydrated,
    loading,
    profileId,
    currentDraft,
    wizard.restore,
    protection.markSaved,
    addresses,
  ]);

  useEffect(() => {
    if (review && reviewFingerprint.current !== fingerprint) {
      setReview(null);
      setReviewInput(null);
      wizard.restore(Math.min(step, 2));
    }
  }, [fingerprint, review, step, wizard.restore]);

  useEffect(() => {
    if (
      !draftHydrated ||
      !protection.dirty ||
      protection.busy ||
      protection.blocker.status === 'blocked' ||
      protection.saveError ||
      submission.unconfirmed ||
      submitting
    )
      return;
    const timer = setTimeout(() => {
      void protection.save();
    }, 1200);
    return () => clearTimeout(timer);
  }, [
    draftHydrated,
    protection.dirty,
    protection.busy,
    protection.blocker.status,
    protection.saveError,
    protection.save,
    submission.unconfirmed,
    submitting,
  ]);

  async function saveNow(): Promise<boolean> {
    const saved = await protection.save();
    if (saved) setDraftSaved(true);
    return saved;
  }
  async function leaveForAddress() {
    if (await saveNow())
      await navigate({
        to: '/settings/addresses/new',
        search: { returnTo: '/solar/requests/new' },
      });
  }
  const canNext =
    step === 1
      ? propertyValid(currentDraft)
      : step === 2 && propertyValid(currentDraft) && gridValid(currentDraft) && agreementAccepted;
  async function advanceStep() {
    if (!canNext) return;
    if (step === 1) {
      await protection.save(2);
      return;
    }
    await protection.run(async (current, alive) => {
      setSubmitting(true);
      setSubmitError(false);
      setDraftSaveError(false);
      const base = {
        profileId,
        gridType,
        siteAddressId,
        ...(gridType === 'on_grid'
          ? { billIdentifier: normalizeProfileDigits(billIdentifier) }
          : {}),
        agreementAccepted: true,
      };
      const details =
        buildingType === 'building_apartment'
          ? {
              buildingType,
              propertyForm,
              structuralFrame,
              buildingCompletionDate,
              ...(propertyForm === 'apartment' ? { totalUnits: quantityValue(totalUnits) } : {}),
            }
          : {
              buildingType,
              siteCategory,
              installationSurface,
              usableAreaSqm: quantityValue(usableAreaSqm),
              siteRelationship,
              ...(siteDescription.trim() ? { siteDescription: siteDescription.trim() } : {}),
            };
      const keyFingerprint = JSON.stringify([base, details]);
      if (submissionKey.current?.fingerprint !== keyFingerprint)
        submissionKey.current = { fingerprint: keyFingerprint, key: crypto.randomUUID() };
      const input = { ...base, ...details, submissionKey: submissionKey.current.key };
      try {
        const receipt = await readReview(
          queryKeys.solar.detail(
            {
              context: 'customer',
              ownerId: profileId,
              accountId: actor,
              revision: profileRevision,
            },
            'submission-review'
          ),
          undefined,
          async (signal) => {
            const response = await fetch('/api/solar/requests/review', {
              method: 'POST',
              credentials: 'include',
              signal,
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(input),
            });
            if (!response.ok) throw new Error('review');
            return (await response.json()) as SolarReview;
          }
        );
        if (!current()) return;
        if (
          !receipt ||
          !/^[a-f0-9]{64}$/.test(receipt.hash) ||
          !receipt.data ||
          !sameFormData(receipt.data.submission, input) ||
          receipt.data.createsContract !== false ||
          receipt.data.createsInvoice !== false ||
          typeof receipt.data.agreementVersion !== 'string' ||
          !receipt.data.agreementVersion ||
          typeof receipt.data.agreementText !== 'string' ||
          !receipt.data.agreementText ||
          typeof receipt.data.siteAddress !== 'string' ||
          !receipt.data.siteAddress.trim() ||
          !receipt.data.siteAddressSnapshot ||
          receipt.data.siteAddressSnapshot.id !== siteAddressId ||
          receipt.data.siteAddressSnapshot.full_address !== receipt.data.siteAddress ||
          typeof receipt.data.siteAddressSnapshot.province_id !== 'string' ||
          !receipt.data.siteAddressSnapshot.province_id ||
          typeof receipt.data.siteAddressSnapshot.city_id !== 'string' ||
          !receipt.data.siteAddressSnapshot.city_id ||
          typeof receipt.data.siteAddressSnapshot.postal_code !== 'string' ||
          !/^[0-9]{10}$/.test(receipt.data.siteAddressSnapshot.postal_code)
        )
          throw new Error('Invalid review');
        try {
          await saveWizardDraft(3, currentDraft);
        } catch (error) {
          if (current()) setDraftSaveError(true);
          throw error;
        }
        if (!current()) return;
        protection.markSaved(currentDraft, 3);
        reviewFingerprint.current = fingerprint;
        setReview(receipt);
        setReviewInput(input);
        await protection.move(3, step);
      } catch {
        if (current()) {
          protection.completed.current = false;
          setSubmitError(true);
        }
      } finally {
        if (alive()) setSubmitting(false);
      }
    });
  }
  const financialGate = useRiskConfirmation(
    JSON.stringify([review?.hash, fingerprint]),
    locale,
    'financial'
  );
  async function sendRequest(input?: object) {
    await protection.run(async (current, alive) => {
      setSubmitting(true);
      setSubmitError(false);
      const ownsSubmission = () => current() && getProfileContextRevision() === profileRevision;
      try {
        const result = await submission.send(input, ownsSubmission);
        if (!ownsSubmission()) return;
        if (result.status === 'confirmed') {
          protection.completed.current = true;
          protection.blocker.reset?.();
          toast.success(copy('history_solar.request.submitted'));
          await navigate({
            to: '/solar/requests/$requestId',
            params: { requestId: result.receipt },
          }).catch(() => {});
        } else if (result.status === 'unconfirmed') {
          toast.error(copy('submissionUnconfirmed'));
        } else if (result.status === 'rejected' || result.status === 'conflict') {
          setSubmitError(true);
          toast.error(copy('submitError'));
        }
      } finally {
        if (alive()) setSubmitting(false);
      }
    });
  }
  async function confirmSubmission() {
    if (
      !financialGate.allowed ||
      submission.unconfirmed ||
      !review ||
      !reviewInput ||
      reviewFingerprint.current !== fingerprint ||
      !agreementAccepted ||
      !propertyValid(currentDraft) ||
      !gridValid(currentDraft)
    )
      return;
    await sendRequest({ ...reviewInput, expectedReviewHash: review.hash });
  }

  const today = new Date().toISOString().slice(0, 10);
  const age = completionDateValid(buildingCompletionDate)
    ? Number(today.slice(0, 4)) -
      Number(buildingCompletionDate.slice(0, 4)) -
      Number(today.slice(5) < buildingCompletionDate.slice(5))
    : null;
  const localizedCompletion =
    age !== null
      ? (locale === 'fa' ? persianCompletionDate : gregorianCompletionDate).format(
          new Date(buildingCompletionDate)
        )
      : null;
  const reviewedCompletion = review?.data.submission.buildingCompletionDate;
  const stages = ['requestStage', 'uploadStage', 'verifyStage', 'postalStage', 'finalStage'];

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-3 sm:py-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {protection.blocker.status === 'blocked' && (
        <Suspense fallback={<p role="status">{copy('loading')}</p>}>
          <LeaveDialog
            onSave={saveNow}
            saveDisabled={submission.unconfirmed}
            working={protection.busy || fields.pending}
            workingLabel={copy('submitting')}
            errorMessage={
              submission.unconfirmed
                ? copy('submissionUnconfirmed')
                : draftSaveError || protection.saveError
                  ? copy('draftSaveError')
                  : undefined
            }
            onStay={() => protection.blocker.reset?.()}
            onLeave={() => protection.blocker.proceed?.()}
          />
        </Suspense>
      )}
      <div className="space-y-2">
        <Link to="/solar/requests" className="touch-action text-sm text-primary underline">
          {copy('myRequests')}
        </Link>
        <h1 className="text-2xl font-semibold sm:text-3xl">{copy('title')}</h1>
        {step === 1 && (
          <p className="text-sm text-muted-foreground">{copy('uploadAfterRequest')}</p>
        )}
      </div>
      {loading && <LoadingStatus>{copy('loading')}</LoadingStatus>}
      {loadError && (
        <div role="alert">
          <p>{copy('loadError')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLoadError(false);
              setLoading(true);
              setLoadAttempt((current) => current + 1);
            }}
          >
            {copy('retry')}
          </Button>
        </div>
      )}
      {!loading && !loadError && !profileId && <p role="alert">{copy('profileRequired')}</p>}
      {profileId && draftLoading && <LoadingStatus>{copy('draftLoading')}</LoadingStatus>}
      {profileId && draftError && (
        <div role="alert">
          <p>{copy('draftLoadError')}</p>
          <Button type="button" variant="outline" onClick={retryDraft}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {(draftSaveError || protection.saveError) && <p role="alert">{copy('draftSaveError')}</p>}
      <CommandFeedback
        message={
          draftSaved && !protection.dirty && !draftSaveError && !protection.saveError
            ? copy('draftSaved')
            : null
        }
      />
      {submission.unconfirmed && (
        <SubmissionRecovery
          history="/solar/requests"
          busy={submitting}
          onRetry={() => void sendRequest()}
          copy={{
            unconfirmed: copy('submissionUnconfirmed'),
            retry: copy('retrySubmission'),
            busy: copy('submitting'),
            history: copy('checkRequests'),
          }}
        />
      )}
      {!loading && !loadError && profileId && draftHydrated && !draftError && (
        <ValidatedFormWizard
          form={fields.form}
          errorId={fields.errorId}
          onPendingChange={fields.setValidationPending}
          disabled={
            loading ||
            loadError ||
            draftLoading ||
            !!draftError ||
            !draftHydrated ||
            !profileId ||
            protection.busy ||
            protection.completed.current ||
            submission.unconfirmed ||
            submitting
          }
          onInvalidStep={(target) => wizard.go(target, step)}
          fields={[
            [
              { name: 'buildingType', label: copy('instruction') },
              { name: 'siteAddressId', label: copy('address') },
              ...(buildingType === 'building_apartment'
                ? [
                    { name: 'propertyForm' as const, label: copy('propertyForm') },
                    { name: 'structuralFrame' as const, label: copy('structuralFrame') },
                    { name: 'buildingCompletionDate' as const, label: copy('completionDate') },
                    ...(propertyForm === 'apartment'
                      ? [{ name: 'totalUnits' as const, label: copy('totalUnits') }]
                      : []),
                  ]
                : [
                    { name: 'siteCategory' as const, label: copy('siteCategory') },
                    { name: 'installationSurface' as const, label: copy('installationSurface') },
                    { name: 'usableAreaSqm' as const, label: copy('usableArea') },
                    { name: 'siteRelationship' as const, label: copy('relationship') },
                    { name: 'siteDescription' as const, label: copy('description') },
                  ]),
            ],
            [
              { name: 'gridType', label: copy('gridType') },
              ...(gridType === 'on_grid'
                ? [{ name: 'billIdentifier' as const, label: copy('billIdentifier') }]
                : []),
              { name: 'agreementAccepted', label: copy('agreement') },
            ],
            [],
          ]}
          step={step}
          compactProgress
          actionsClassName={
            step < 3
              ? `${wizardActionSurface} max-lg:sticky max-lg:bottom-0 max-lg:z-20 [&>button]:min-h-11`
              : wizardActionSurface
          }
          steps={['wizardProperty', 'gridType', 'reviewTitle'].map(copy)}
          ariaLabel={copy('title')}
          backLabel={t('electricity.order.back', locale)}
          saveLabel={copy('saveDraft')}
          savingLabel={t('electricity.order.savingDraft', locale)}
          nextLabel={step === 2 ? copy('reviewTitle') : t('electricity.order.next', locale)}
          submitLabel={copy('submit')}
          submittingLabel={copy('submitting')}
          saving={protection.busy && !submitting}
          submitting={submitting}
          saveDisabled={protection.completed.current || submission.unconfirmed}
          backDisabled={protection.completed.current || submission.unconfirmed}
          nextDisabled={!canNext || submission.unconfirmed}
          submitDisabled={
            !financialGate.allowed ||
            !review ||
            !agreementAccepted ||
            protection.completed.current ||
            submission.unconfirmed
          }
          onBack={() => {
            void protection.save(step - 1);
          }}
          onSave={() => {
            void saveNow();
          }}
          onNext={advanceStep}
          onSubmit={confirmSubmission}
        >
          {(pending) => (
            <fieldset
              className="min-w-0 space-y-3"
              disabled={
                pending || protection.busy || protection.completed.current || submission.unconfirmed
              }
            >
              {step === 1 && (
                <>
                  <fieldset
                    role="radiogroup"
                    aria-labelledby="solar-building-type-label"
                    aria-required="true"
                    className="grid min-w-0 gap-2 min-[375px]:grid-cols-2"
                  >
                    <legend id="solar-building-type-label" className="sr-only">
                      {copy('instruction')}
                    </legend>
                    <p aria-hidden="true" className="col-span-full text-sm font-semibold">
                      {copy('instruction')}
                    </p>
                    {(['building_apartment', 'non_household'] as const).map((type) => (
                      <label key={type} className={solarChoice}>
                        <input
                          type="radio"
                          {...fields.bind('buildingType')}
                          value={type}
                          checked={buildingType === type}
                          onChange={() => setBuildingType(type)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium">
                            {copy(type === 'building_apartment' ? 'building' : 'nonHousehold')}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {copy(
                              type === 'building_apartment' ? 'buildingHelp' : 'nonHouseholdHelp'
                            )}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <Card size="sm">
                    <CardContent className="grid min-w-0 items-start gap-3 min-[375px]:grid-cols-2">
                      {buildingType === 'building_apartment' ? (
                        <>
                          <div className="space-y-1">
                            <Label htmlFor="solar-property-form">{copy('propertyForm')}</Label>
                            <NativeSelect
                              id="solar-property-form"
                              className="w-full"
                              {...fields.bind('propertyForm')}
                              required
                              aria-required="true"
                              value={propertyForm}
                              onChange={(e) =>
                                setPropertyForm(e.target.value as typeof propertyForm)
                              }
                            >
                              <option value="" disabled>
                                {solarIntakeText('choosePropertyForm', locale)}
                              </option>
                              {propertyForms.map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="solar-structural-frame">
                              {copy('structuralFrame')}
                            </Label>
                            <NativeSelect
                              id="solar-structural-frame"
                              className="w-full"
                              {...fields.bind('structuralFrame')}
                              required
                              aria-required="true"
                              value={structuralFrame}
                              onChange={(e) =>
                                setStructuralFrame(e.target.value as typeof structuralFrame)
                              }
                            >
                              <option value="" disabled>
                                {solarIntakeText('chooseStructuralFrame', locale)}
                              </option>
                              {structuralFrames.map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <div
                            className={`min-w-0 space-y-1 ${propertyForm === 'apartment' ? '' : 'col-span-full sm:max-w-xs'}`}
                          >
                            <Label htmlFor="solar-completion">{copy('completionDate')}</Label>
                            {manualCompletionDate ? (
                              <Input
                                id="solar-completion"
                                type="date"
                                dir="ltr"
                                lang="en"
                                className="w-full min-w-0"
                                {...completionDateAttributes}
                                onBlur={blurCompletionDate}
                                value={buildingCompletionDate}
                                max={new Date().toISOString().slice(0, 10)}
                                onChange={(event) => setBuildingCompletionDate(event.target.value)}
                                required
                              />
                            ) : (
                              <DatePicker
                                id="solar-completion"
                                label={copy('completionDate')}
                                locale={locale}
                                timezone="UTC"
                                showYearSelect
                                compactLabel
                                maxDate={new Date()}
                                value={datePickerCalendarDate(buildingCompletionDate, 'UTC')}
                                onChange={(date) =>
                                  setBuildingCompletionDate(date?.toISOString().slice(0, 10) ?? '')
                                }
                                triggerProps={completionDateAttributes}
                                onBlur={blurCompletionDate}
                                className="min-h-11 border-border"
                              />
                            )}
                            <p
                              id="solar-completion-hint"
                              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
                            >
                              {localizedCompletion && (!manualCompletionDate || locale === 'fa') ? (
                                <time
                                  dateTime={buildingCompletionDate}
                                  className={
                                    manualCompletionDate ? 'font-medium text-foreground' : 'sr-only'
                                  }
                                >
                                  {localizedCompletion}
                                </time>
                              ) : (
                                age === null &&
                                solarIntakeText(
                                  manualCompletionDate
                                    ? 'completionDateFormat'
                                    : 'completionDateCalendar',
                                  locale
                                )
                              )}
                              {age !== null && (
                                <span>
                                  {age === 0
                                    ? solarIntakeText('buildingAgeUnderOne', locale)
                                    : copy('buildingAge').replace(
                                        '{years}',
                                        locale === 'fa' ? persianAge.format(age) : String(age)
                                      )}
                                </span>
                              )}
                            </p>
                            <button
                              type="button"
                              className="min-h-8 rounded-sm text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11"
                              onClick={() => {
                                focusCompletionDate.current = true;
                                setManualCompletionDate((manual) => !manual);
                              }}
                            >
                              {solarIntakeText(
                                manualCompletionDate
                                  ? 'completionDatePicker'
                                  : 'completionDateManual',
                                locale
                              )}
                            </button>
                          </div>
                          {propertyForm === 'apartment' && (
                            <div className="min-w-0 space-y-1">
                              <Label htmlFor="solar-units">{copy('totalUnits')}</Label>
                              <Input
                                id="solar-units"
                                inputMode="numeric"
                                dir="ltr"
                                maxLength={6}
                                {...fields.bind('totalUnits')}
                                aria-describedby={
                                  fields.form.getFieldState('totalUnits').invalid
                                    ? fields.errorId('totalUnits')
                                    : 'solar-units-hint'
                                }
                                value={totalUnits}
                                onChange={(e) =>
                                  setTotalUnits(normalizeProfileDigits(e.target.value))
                                }
                                required
                                aria-required="true"
                              />
                              <p id="solar-units-hint" className="text-xs text-muted-foreground">
                                {solarIntakeText('unitsFormat', locale)}
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="space-y-1">
                            <Label htmlFor="solar-site-category">{copy('siteCategory')}</Label>
                            <NativeSelect
                              id="solar-site-category"
                              className="w-full"
                              {...fields.bind('siteCategory')}
                              required
                              aria-required="true"
                              value={siteCategory}
                              onChange={(e) =>
                                setSiteCategory(e.target.value as typeof siteCategory)
                              }
                            >
                              <option value="" disabled>
                                {solarIntakeText('chooseSiteCategory', locale)}
                              </option>
                              {siteCategories.map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="solar-installation-surface">
                              {copy('installationSurface')}
                            </Label>
                            <NativeSelect
                              id="solar-installation-surface"
                              className="w-full"
                              {...fields.bind('installationSurface')}
                              required
                              aria-required="true"
                              value={installationSurface}
                              onChange={(e) =>
                                setInstallationSurface(e.target.value as typeof installationSurface)
                              }
                            >
                              <option value="" disabled>
                                {solarIntakeText('chooseInstallationSurface', locale)}
                              </option>
                              {installationSurfaces.map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <div className="min-w-0 space-y-1">
                            <Label htmlFor="solar-area" className="min-[375px]:max-sm:text-xs">
                              {copy('usableArea')}
                            </Label>
                            <Input
                              id="solar-area"
                              inputMode="decimal"
                              dir="ltr"
                              maxLength={20}
                              {...fields.bind('usableAreaSqm')}
                              aria-describedby={
                                fields.form.getFieldState('usableAreaSqm').invalid
                                  ? fields.errorId('usableAreaSqm')
                                  : 'solar-area-hint'
                              }
                              value={usableAreaSqm}
                              onChange={(e) => setUsableAreaSqm(normalizeQuantity(e.target.value))}
                              required
                              aria-required="true"
                            />
                            <p id="solar-area-hint" className="text-xs text-muted-foreground">
                              {solarIntakeText('areaExample', locale)}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="solar-site-relationship">{copy('relationship')}</Label>
                            <NativeSelect
                              id="solar-site-relationship"
                              className="w-full"
                              {...fields.bind('siteRelationship')}
                              required
                              aria-required="true"
                              value={siteRelationship}
                              onChange={(e) =>
                                setSiteRelationship(e.target.value as typeof siteRelationship)
                              }
                            >
                              <option value="" disabled>
                                {solarIntakeText('chooseSiteRelationship', locale)}
                              </option>
                              {siteRelationships.map((item) => (
                                <option key={item} value={item}>
                                  {copy(
                                    item === 'authorized_operator' ? 'authorizedOperator' : item
                                  )}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <details
                            open={siteDescription !== '' || undefined}
                            className="group col-span-full border-t pt-1"
                          >
                            <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-primary">
                              {copy('description')}
                              <ChevronDownIcon
                                aria-hidden="true"
                                className="size-4 motion-safe:transition-transform group-open:rotate-180"
                              />
                            </summary>
                            <Textarea
                              id="solar-site-description"
                              aria-label={copy('description')}
                              rows={2}
                              className="min-h-14"
                              maxLength={2000}
                              placeholder={solarIntakeText('descriptionExample', locale)}
                              {...fields.bind('siteDescription')}
                              value={siteDescription}
                              onChange={(e) => setSiteDescription(e.target.value)}
                            />
                          </details>
                        </>
                      )}
                      <div className="col-span-full min-w-0 space-y-1 border-t pt-2">
                        <div className="flex flex-wrap items-center justify-between gap-x-2">
                          {hasSiteAddresses ? (
                            <Label htmlFor="solar-site-address-id">{copy('address')}</Label>
                          ) : (
                            <p className="text-sm font-medium">{copy('address')}</p>
                          )}
                          <Link
                            className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary hover:underline"
                            to="/settings/addresses/new"
                            search={{ returnTo: '/solar/requests/new' }}
                            aria-disabled={protection.busy}
                            onClick={(event) => {
                              event.preventDefault();
                              if (!protection.busy) void leaveForAddress();
                            }}
                          >
                            <PlusIcon className="size-4 shrink-0" aria-hidden="true" />
                            {copy('addAddress')}
                          </Link>
                        </div>
                        {(savedSiteAddressUnavailable || !hasSiteAddresses) && (
                          <p
                            id="solar-site-address-recovery"
                            role="status"
                            className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground"
                          >
                            {savedSiteAddressUnavailable && (
                              <span className="block">
                                {solarIntakeText('savedAddressUnavailable', locale)}
                              </span>
                            )}
                            {!hasSiteAddresses && (
                              <span className="block">{copy('noAddresses')}</span>
                            )}
                          </p>
                        )}
                        {hasSiteAddresses && (
                          <NativeSelect
                            id="solar-site-address-id"
                            className="w-full"
                            {...siteAddressField}
                            value={selectedSiteAddress?.id ?? ''}
                            onChange={(e) => setSiteAddressId(e.target.value)}
                            required
                            aria-required="true"
                            aria-invalid={
                              savedSiteAddressUnavailable || siteAddressField['aria-invalid']
                            }
                            aria-describedby={
                              [
                                siteAddressField['aria-describedby'],
                                savedSiteAddressUnavailable && 'solar-site-address-recovery',
                                selectedSiteAddress && 'solar-site-address-postal',
                              ]
                                .filter(Boolean)
                                .join(' ') || undefined
                            }
                          >
                            <option value="">
                              {solarIntakeText('chooseSavedAddress', locale)}
                            </option>
                            {addresses.map((address) => (
                              <option key={address.id} value={address.id}>
                                {`${address.fullAddress} · \u2066${address.postalCode}\u2069`}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                        {selectedSiteAddress && (
                          <p
                            id="solar-site-address-postal"
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                          >
                            <span>
                              {t('electricity.order.postalCode', locale)}{' '}
                              <bdi dir="ltr" className="font-medium text-foreground">
                                {selectedSiteAddress.postalCode}
                              </bdi>
                            </span>
                            {selectedSiteAddress.mainAddress && (
                              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                                {t('electricity.order.mainAddress', locale)}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
              {step === 2 && (
                <Card size="sm">
                  <CardContent className="space-y-3">
                    <fieldset
                      role="radiogroup"
                      aria-labelledby="solar-grid-type-label"
                      aria-describedby={gridType === 'off_grid' ? 'solar-off-grid-note' : undefined}
                      aria-required="true"
                      className="grid min-w-0 gap-2 sm:grid-cols-2"
                    >
                      <legend id="solar-grid-type-label" className="sr-only">
                        {copy('gridType')}
                      </legend>
                      <p
                        aria-hidden="true"
                        className="col-span-full hidden text-sm font-semibold sm:block"
                      >
                        {copy('gridType')}
                      </p>
                      {gridTypes.map((type) => (
                        <label key={type} className={solarChoice}>
                          <input
                            type="radio"
                            {...fields.bind('gridType')}
                            value={type}
                            checked={gridType === type}
                            onChange={() => setGridType(type)}
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                          />
                          <span className="min-w-0 space-y-1">
                            <span className="block text-sm font-medium">
                              {copy(type === 'on_grid' ? 'onGrid' : 'offGrid')}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {copy(type === 'on_grid' ? 'onGridHelp' : 'offGridHelp')}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {gridType === 'off_grid' && (
                      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                        <Info aria-hidden="true" className="size-4 shrink-0 text-primary" />
                        <p id="solar-off-grid-note">{solarIntakeText('offGridOutage', locale)}</p>
                      </div>
                    )}
                    {gridType === 'on_grid' && (
                      <div className="max-w-sm space-y-1">
                        <Label htmlFor="solar-bill">{copy('billIdentifier')}</Label>
                        <Input
                          id="solar-bill"
                          inputMode="numeric"
                          pattern="[0-9۰-۹٠-٩]{6,13}"
                          minLength={6}
                          maxLength={13}
                          dir="ltr"
                          {...fields.bind('billIdentifier')}
                          aria-describedby={
                            fields.form.getFieldState('billIdentifier').invalid
                              ? fields.errorId('billIdentifier')
                              : 'solar-bill-hint'
                          }
                          value={billIdentifier}
                          onChange={(e) =>
                            setBillIdentifier(normalizeProfileDigits(e.target.value))
                          }
                          required
                          aria-required="true"
                        />
                        <p id="solar-bill-hint" className="text-xs text-muted-foreground">
                          {solarIntakeText('billFormat', locale)}
                        </p>
                      </div>
                    )}
                    <div className="space-y-2 border-t pt-2">
                      <details className="group">
                        <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-primary">
                          {copy('stages')}
                          <ChevronDownIcon
                            aria-hidden="true"
                            className="size-4 motion-safe:transition-transform group-open:rotate-180"
                          />
                        </summary>
                        <ol className="list-inside list-decimal space-y-2 pb-2 text-sm">
                          {stages.map((stage) => (
                            <li key={stage}>{copy(stage)}</li>
                          ))}
                        </ol>
                      </details>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/45 px-3 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
                          {...fields.bind('agreementAccepted')}
                          checked={agreementAccepted}
                          onChange={(e) => setAgreementAccepted(e.target.checked)}
                          required
                          aria-required="true"
                        />
                        {copy('agreement')}
                      </label>
                    </div>
                  </CardContent>
                </Card>
              )}
              {step === 3 && (
                <Card size="sm">
                  <CardContent className="space-y-3">
                    {review && (
                      <SolarRequestReview
                        data={review.data}
                        completionDate={
                          typeof reviewedCompletion === 'string' && reviewedCompletion ? (
                            <time dateTime={reviewedCompletion}>
                              {locale === 'fa' && completionDateValid(reviewedCompletion)
                                ? persianCompletionDate.format(new Date(reviewedCompletion))
                                : reviewedCompletion}
                            </time>
                          ) : null
                        }
                        editDisabled={pending || protection.busy || protection.completed.current}
                        onEdit={(target) => void protection.save(target)}
                      />
                    )}
                    <div className="rounded-lg border p-3 [&_button]:self-start">
                      <OrderWalletBalance
                        profileId={profileId}
                        scopeKey={review?.hash ?? fingerprint}
                      />
                    </div>
                    {submitError && <p role="alert">{copy('submitError')}</p>}
                  </CardContent>
                </Card>
              )}
              {submitError && step !== 3 && <p role="alert">{copy('submitError')}</p>}
              {step === 3 && <ConfirmationFields gate={financialGate} disabled={submitting} />}
            </fieldset>
          )}
        </ValidatedFormWizard>
      )}
    </div>
  );
}
