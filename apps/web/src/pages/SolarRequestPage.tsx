import { StepReviewPage } from '../components/StepReviewPage.js';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { ValidatedFormWizard } from '../components/ValidatedFormWizard.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { z } from 'zod';
import { useWizardStep } from '../hooks/useWizardStep.js';
import { useWizardDraftProtection } from '../hooks/useWizardDraftProtection.js';
import { sameFormData, uuidReference } from '../lib/form-receipt.js';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { useFormDraft, type DraftSchema } from '../hooks/useFormDraft.js';

interface Address {
  id: string;
  fullAddress: string;
  postalCode: string;
}
interface SolarReview {
  hash: string;
  data: {
    submission: Record<string, string | number | boolean>;
    siteAddress: string | null;
    agreementVersion: string;
    agreementText: string;
    createsContract: false;
    createsInvoice: false;
  };
}
type BuildingType = 'building_apartment' | 'non_household';
type GridType = 'on_grid' | 'off_grid';
interface SolarDraft {
  buildingType: BuildingType;
  propertyForm: 'apartment' | 'villa';
  structuralFrame: 'concrete' | 'steel' | 'other';
  buildingCompletionDate: string;
  totalUnits: string;
  siteCategory: 'agricultural' | 'industrial';
  installationSurface: 'land' | 'rooftop' | 'both';
  usableAreaSqm: string;
  siteAddressId: string;
  siteRelationship: 'owner' | 'tenant' | 'authorized_operator';
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
      !['apartment', 'villa'].includes(String(data.propertyForm)) ||
      !['concrete', 'steel', 'other'].includes(String(data.structuralFrame)) ||
      !['agricultural', 'industrial'].includes(String(data.siteCategory)) ||
      !['land', 'rooftop', 'both'].includes(String(data.installationSurface)) ||
      !['owner', 'tenant', 'authorized_operator'].includes(String(data.siteRelationship)) ||
      !['on_grid', 'off_grid'].includes(String(data.gridType)) ||
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
function unitsValid(value: string) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100000;
}
function areaValid(value: string) {
  return (
    Number(value) > 0 &&
    Number(value) <= 1000000 &&
    Number.isInteger(Math.round(Number(value) * 10000) / 100)
  );
}

const LeaveDialog = lazy(() => import('../components/WizardLeaveDialog.js'));

export function SolarRequestPage() {
  const navigate = useNavigate();
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const wizard = useWizardStep('/solar/requests/new', 4);
  const { step } = wizard;
  const [profileId, setProfileId] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const invalidField = t('formWizard.invalidField', locale);
  const fields = useWizardForm(
    z
      .object({
        buildingType: z.enum(['building_apartment', 'non_household']),
        propertyForm: z.enum(['apartment', 'villa']),
        structuralFrame: z.enum(['concrete', 'steel', 'other']),
        buildingCompletionDate: z.string(),
        totalUnits: z.string(),
        siteCategory: z.enum(['agricultural', 'industrial']),
        installationSurface: z.enum(['land', 'rooftop', 'both']),
        usableAreaSqm: z.string(),
        siteAddressId: z.string(),
        siteRelationship: z.enum(['owner', 'tenant', 'authorized_operator']),
        siteDescription: z.string(),
        gridType: z.enum(['on_grid', 'off_grid']),
        billIdentifier: z.string(),
        agreementAccepted: z.boolean(),
      })
      .superRefine((value, context) => {
        const invalid = (name: keyof typeof value) =>
          context.addIssue({ code: 'custom', path: [name], message: invalidField });
        if (value.buildingType === 'building_apartment') {
          if (!completionDateValid(value.buildingCompletionDate)) invalid('buildingCompletionDate');
          if (value.propertyForm === 'apartment' && !unitsValid(value.totalUnits))
            invalid('totalUnits');
        } else {
          if (!areaValid(value.usableAreaSqm)) invalid('usableAreaSqm');
          if (!addresses.some((address) => address.id === value.siteAddressId))
            invalid('siteAddressId');
        }
        if (
          value.gridType === 'on_grid' &&
          !/^[0-9]{6,13}$/.test(normalizeProfileDigits(value.billIdentifier))
        )
          invalid('billIdentifier');
        if (!value.agreementAccepted) invalid('agreementAccepted');
      }),
    {
      buildingType: 'building_apartment',
      propertyForm: 'apartment',
      structuralFrame: 'concrete',
      buildingCompletionDate: '',
      totalUnits: '',
      siteCategory: 'agricultural',
      installationSurface: 'land',
      usableAreaSqm: '',
      siteAddressId: '',
      siteRelationship: 'owner',
      siteDescription: '',
      gridType: 'on_grid',
      billIdentifier: '',
      agreementAccepted: false,
    }
  );
  const [buildingType, setBuildingType] = fields.field('buildingType');
  const [propertyForm, setPropertyForm] = fields.field('propertyForm');
  const [structuralFrame, setStructuralFrame] = fields.field('structuralFrame');
  const [buildingCompletionDate, setBuildingCompletionDate] =
    fields.field('buildingCompletionDate');
  const [totalUnits, setTotalUnits] = fields.field('totalUnits');
  const [siteCategory, setSiteCategory] = fields.field('siteCategory');
  const [installationSurface, setInstallationSurface] = fields.field('installationSurface');
  const [usableAreaSqm, setUsableAreaSqm] = fields.field('usableAreaSqm');
  const [siteAddressId, setSiteAddressId] = fields.field('siteAddressId');
  const [siteRelationship, setSiteRelationship] = fields.field('siteRelationship');
  const [siteDescription, setSiteDescription] = fields.field('siteDescription');
  const [gridType, setGridType] = fields.field('gridType');
  const [billIdentifier, setBillIdentifier] = fields.field('billIdentifier');
  const [agreementAccepted, setAgreementAccepted] = fields.field('agreementAccepted');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
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

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/profiles', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('profile');
        const profile = (await response.json()) as {
          activeProfileId: string | null;
          profiles: Array<{ id: string }>;
        };
        const active = profile.profiles.find((item) => item.id === profile.activeProfileId);
        if (controller.signal.aborted) return;
        setProfileId(active?.id ?? '');
        if (active) {
          const addressResponse = await fetch(`/api/profiles/${active.id}/addresses`, {
            credentials: 'include',
            signal: controller.signal,
          });
          if (!addressResponse.ok) throw new Error('addresses');
          const result = (await addressResponse.json()) as { addresses: Address[] };
          if (!controller.signal.aborted) {
            setAddresses(result.addresses);
            setSiteAddressId((current) => current || result.addresses[0]?.id || '');
          }
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

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
    saveDraft,
    go: wizard.go,
  });
  const fingerprint = JSON.stringify([profileId, currentDraft, agreementAccepted]);
  const propertyValid = (value: SolarDraft) =>
    value.buildingType === 'non_household'
      ? areaValid(value.usableAreaSqm) &&
        addresses.some((address) => address.id === value.siteAddressId)
      : completionDateValid(value.buildingCompletionDate) &&
        (value.propertyForm === 'villa' || unitsValid(value.totalUnits));
  const gridValid = (value: SolarDraft) =>
    value.gridType === 'off_grid' ||
    /^[0-9]{6,13}$/.test(normalizeProfileDigits(value.billIdentifier));
  useEffect(() => {
    if (!draft || draftHydrated || loading) return;
    const saved = draft.data;
    if (saved) {
      setBuildingType(saved.buildingType);
      setPropertyForm(saved.propertyForm);
      setStructuralFrame(saved.structuralFrame);
      setBuildingCompletionDate(saved.buildingCompletionDate);
      setTotalUnits(saved.totalUnits);
      setSiteCategory(saved.siteCategory);
      setInstallationSurface(saved.installationSurface);
      setUsableAreaSqm(saved.usableAreaSqm);
      setSiteAddressId(saved.siteAddressId || addresses[0]?.id || '');
      setSiteRelationship(saved.siteRelationship);
      setSiteDescription(saved.siteDescription);
      setGridType(saved.gridType);
      setBillIdentifier(saved.billIdentifier);
    }
    // Consent and the server review are renewed in every resumed session.
    const restored = saved
      ? Math.min(draft.currentStep, !propertyValid(saved) ? 1 : !gridValid(saved) ? 2 : 3)
      : 1;
    wizard.restore(restored);
    protection.markSaved(saved ?? currentDraft, restored);
    setDraftHydrated(true);
  }, [
    draft,
    draftHydrated,
    loading,
    currentDraft,
    wizard.restore,
    protection.markSaved,
    addresses,
  ]);

  useEffect(() => {
    if (review && reviewFingerprint.current !== fingerprint) {
      setReview(null);
      setReviewInput(null);
      wizard.restore(Math.min(step, 3));
    }
  }, [fingerprint, review, step, wizard.restore]);

  useEffect(() => {
    if (
      !draftHydrated ||
      !protection.dirty ||
      protection.busy ||
      protection.blocker.status === 'blocked' ||
      protection.saveError ||
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
    submitting,
  ]);

  async function saveNow(): Promise<boolean> {
    const saved = await protection.save();
    if (saved) setDraftSaved(true);
    return saved;
  }
  async function leaveForAddress() {
    if (await saveNow())
      await navigate({ to: '/settings/addresses', search: { returnTo: '/solar/requests/new' } });
  }
  const canNext =
    step === 1
      ? propertyValid(currentDraft)
      : step === 2
        ? gridValid(currentDraft)
        : step === 3 && propertyValid(currentDraft) && gridValid(currentDraft) && agreementAccepted;
  async function advanceStep() {
    if (!canNext) return;
    if (step < 3) {
      await protection.save(step + 1);
      return;
    }
    await protection.run(async (current, alive) => {
      setSubmitting(true);
      setSubmitError(false);
      setDraftSaveError(false);
      const base = {
        profileId,
        gridType,
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
              ...(propertyForm === 'apartment' ? { totalUnits: Number(totalUnits) } : {}),
            }
          : {
              buildingType,
              siteCategory,
              installationSurface,
              usableAreaSqm: Number(usableAreaSqm),
              siteAddressId,
              siteRelationship,
              ...(siteDescription.trim() ? { siteDescription: siteDescription.trim() } : {}),
            };
      const keyFingerprint = JSON.stringify([base, details]);
      if (submissionKey.current?.fingerprint !== keyFingerprint)
        submissionKey.current = { fingerprint: keyFingerprint, key: crypto.randomUUID() };
      const input = { ...base, ...details, submissionKey: submissionKey.current.key };
      try {
        const response = await fetch('/api/solar/requests/review', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(input),
        });
        if (!response.ok) throw new Error('review');
        const receipt = (await response.json()) as SolarReview;
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
          (receipt.data.siteAddress !== null && typeof receipt.data.siteAddress !== 'string')
        )
          throw new Error('Invalid review');
        try {
          await saveDraft(4, currentDraft);
        } catch (error) {
          if (current()) setDraftSaveError(true);
          throw error;
        }
        if (!current()) return;
        protection.markSaved(currentDraft, 4);
        reviewFingerprint.current = fingerprint;
        setReview(receipt);
        setReviewInput(input);
        await protection.move(4, step);
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
  async function confirmSubmission() {
    if (
      !review ||
      !reviewInput ||
      reviewFingerprint.current !== fingerprint ||
      !agreementAccepted ||
      !propertyValid(currentDraft) ||
      !gridValid(currentDraft)
    )
      return;
    await protection.run(async (current, alive) => {
      setSubmitting(true);
      setSubmitError(false);
      try {
        const response = await fetch('/api/solar/requests', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ ...reviewInput, expectedReviewHash: review.hash }),
        });
        if (!response.ok) throw new Error('submit');
        const result = (await response.json()) as { requestId?: unknown };
        const requestId = uuidReference(result?.requestId);
        if (!current()) return;
        protection.completed.current = true;
        protection.blocker.reset?.();
        await navigate({ to: '/solar/requests/$requestId', params: { requestId } });
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

  const age = buildingCompletionDate
    ? Math.max(0, new Date().getFullYear() - Number(buildingCompletionDate.slice(0, 4)))
    : null;
  const stages = ['requestStage', 'uploadStage', 'verifyStage', 'postalStage', 'finalStage'];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {protection.blocker.status === 'blocked' && (
        <Suspense fallback={<p role="status">{copy('loading')}</p>}>
          <LeaveDialog
            onSave={saveNow}
            working={protection.busy || fields.pending}
            workingLabel={copy('submitting')}
            errorMessage={
              draftSaveError || protection.saveError ? copy('draftSaveError') : undefined
            }
            onStay={() => protection.blocker.reset?.()}
            onLeave={() => protection.blocker.proceed?.()}
          />
        </Suspense>
      )}
      <div className="space-y-2">
        <Link to="/solar/requests" className="text-sm text-primary underline">
          {copy('myRequests')}
        </Link>
        <h1 className="text-3xl font-semibold">{copy('title')}</h1>
        <p className="text-muted-foreground">{copy('instruction')}</p>
      </div>
      {loading && <p role="status">{copy('loading')}</p>}
      {loadError && <p role="alert">{copy('loadError')}</p>}
      {!loading && !profileId && <p role="alert">{copy('profileRequired')}</p>}
      {profileId && draftLoading && <p role="status">{copy('draftLoading')}</p>}
      {profileId && draftError && (
        <div role="alert">
          <p>{copy('draftLoadError')}</p>
          <Button type="button" variant="outline" onClick={retryDraft}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {(draftSaveError || protection.saveError) && <p role="alert">{copy('draftSaveError')}</p>}
      {draftSaved && !protection.dirty && !draftSaveError && !protection.saveError && (
        <p role="status">{copy('draftSaved')}</p>
      )}
      {!loading && profileId && draftHydrated && !draftError && (
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
            submitting
          }
          onInvalidStep={(target) => wizard.go(target, step)}
          fields={[
            [
              { name: 'buildingType', label: copy('instruction') },
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
                    { name: 'siteAddressId' as const, label: copy('address') },
                    { name: 'siteRelationship' as const, label: copy('relationship') },
                    { name: 'siteDescription' as const, label: copy('description') },
                  ]),
            ],
            [
              { name: 'gridType', label: copy('gridType') },
              ...(gridType === 'on_grid'
                ? [{ name: 'billIdentifier' as const, label: copy('billIdentifier') }]
                : []),
            ],
            [{ name: 'agreementAccepted', label: copy('agreement') }],
            [],
          ]}
          step={step}
          steps={['wizardProperty', 'gridType', 'stages', 'reviewTitle'].map(copy)}
          ariaLabel={copy('title')}
          backLabel={t('electricity.order.back', locale)}
          saveLabel={copy('saveDraft')}
          savingLabel={t('electricity.order.savingDraft', locale)}
          nextLabel={t('electricity.order.next', locale)}
          submitLabel={copy('submit')}
          submittingLabel={copy('submitting')}
          saving={protection.busy && !submitting}
          submitting={submitting}
          saveDisabled={protection.completed.current}
          backDisabled={protection.completed.current}
          nextDisabled={!canNext}
          submitDisabled={!review || !agreementAccepted || protection.completed.current}
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
              className="space-y-6 min-w-0"
              disabled={pending || protection.busy || protection.completed.current}
            >
              {step === 1 && (
                <>
                  <fieldset className="grid gap-3 sm:grid-cols-2">
                    <legend className="mb-3 font-semibold">{copy('instruction')}</legend>
                    {(['building_apartment', 'non_household'] as const).map((type) => (
                      <label
                        key={type}
                        className={`cursor-pointer rounded-xl border p-4 ${buildingType === type ? 'border-primary bg-primary/5' : ''}`}
                      >
                        <input
                          type="radio"
                          {...fields.bind('buildingType')}
                          value={type}
                          checked={buildingType === type}
                          onChange={() => setBuildingType(type)}
                          className="me-2"
                        />
                        <span className="font-medium">
                          {copy(type === 'building_apartment' ? 'building' : 'nonHousehold')}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {copy(
                            type === 'building_apartment' ? 'buildingHelp' : 'nonHouseholdHelp'
                          )}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <Card>
                    <CardContent className="space-y-4 pt-6">
                      {buildingType === 'building_apartment' ? (
                        <>
                          <label className="block space-y-1">
                            <span>{copy('propertyForm')}</span>
                            <select
                              className="w-full rounded-md border bg-background p-2"
                              {...fields.bind('propertyForm')}
                              value={propertyForm}
                              onChange={(e) =>
                                setPropertyForm(e.target.value as typeof propertyForm)
                              }
                            >
                              <option value="apartment">{copy('apartment')}</option>
                              <option value="villa">{copy('villa')}</option>
                            </select>
                          </label>
                          <label className="block space-y-1">
                            <span>{copy('structuralFrame')}</span>
                            <select
                              className="w-full rounded-md border bg-background p-2"
                              {...fields.bind('structuralFrame')}
                              value={structuralFrame}
                              onChange={(e) =>
                                setStructuralFrame(e.target.value as typeof structuralFrame)
                              }
                            >
                              {(['concrete', 'steel', 'other'] as const).map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <Label htmlFor="solar-completion">{copy('completionDate')}</Label>
                            <Input
                              id="solar-completion"
                              type="date"
                              {...fields.bind('buildingCompletionDate')}
                              value={buildingCompletionDate}
                              max={new Date().toISOString().slice(0, 10)}
                              onChange={(e) => setBuildingCompletionDate(e.target.value)}
                              required
                            />
                          </div>
                          {age !== null && (
                            <p className="text-sm text-muted-foreground">
                              {locale === 'fa'
                                ? `عمر تقریبی ساختمان: ${age} سال`
                                : `Approximate building age: ${age} years`}
                            </p>
                          )}
                          {propertyForm === 'apartment' && (
                            <div>
                              <Label htmlFor="solar-units">{copy('totalUnits')}</Label>
                              <Input
                                id="solar-units"
                                type="number"
                                min={1}
                                max={100000}
                                {...fields.bind('totalUnits')}
                                value={totalUnits}
                                onChange={(e) => setTotalUnits(e.target.value)}
                                required
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <label className="block space-y-1">
                            <span>{copy('siteCategory')}</span>
                            <select
                              className="w-full rounded-md border bg-background p-2"
                              {...fields.bind('siteCategory')}
                              value={siteCategory}
                              onChange={(e) =>
                                setSiteCategory(e.target.value as typeof siteCategory)
                              }
                            >
                              {(['agricultural', 'industrial'] as const).map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block space-y-1">
                            <span>{copy('installationSurface')}</span>
                            <select
                              className="w-full rounded-md border bg-background p-2"
                              {...fields.bind('installationSurface')}
                              value={installationSurface}
                              onChange={(e) =>
                                setInstallationSurface(e.target.value as typeof installationSurface)
                              }
                            >
                              {(['land', 'rooftop', 'both'] as const).map((item) => (
                                <option key={item} value={item}>
                                  {copy(item)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <Label htmlFor="solar-area">{copy('usableArea')}</Label>
                            <Input
                              id="solar-area"
                              type="number"
                              min="0.01"
                              step="0.01"
                              max={1000000}
                              {...fields.bind('usableAreaSqm')}
                              value={usableAreaSqm}
                              onChange={(e) => setUsableAreaSqm(e.target.value)}
                              required
                            />
                          </div>
                          <label className="block space-y-1">
                            <span>{copy('address')}</span>
                            <select
                              className="w-full rounded-md border bg-background p-2"
                              {...fields.bind('siteAddressId')}
                              value={siteAddressId}
                              onChange={(e) => setSiteAddressId(e.target.value)}
                              required
                            >
                              <option value="">—</option>
                              {addresses.map((address) => (
                                <option key={address.id} value={address.id}>
                                  {address.fullAddress}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Link
                            className="inline-flex min-h-11 items-center text-sm underline"
                            to="/settings/addresses"
                            aria-disabled={protection.busy}
                            onClick={(event) => {
                              event.preventDefault();
                              if (!protection.busy) void leaveForAddress();
                            }}
                          >
                            {copy(addresses.length ? 'addAddress' : 'noAddresses')}
                          </Link>
                          <label className="block space-y-1">
                            <span>{copy('relationship')}</span>
                            <select
                              className="w-full rounded-md border bg-background p-2"
                              {...fields.bind('siteRelationship')}
                              value={siteRelationship}
                              onChange={(e) =>
                                setSiteRelationship(e.target.value as typeof siteRelationship)
                              }
                            >
                              {(['owner', 'tenant', 'authorized_operator'] as const).map((item) => (
                                <option key={item} value={item}>
                                  {copy(
                                    item === 'authorized_operator' ? 'authorizedOperator' : item
                                  )}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block space-y-1">
                            <span>{copy('description')}</span>
                            <textarea
                              className="min-h-24 w-full rounded-md border bg-background p-2"
                              maxLength={2000}
                              {...fields.bind('siteDescription')}
                              value={siteDescription}
                              onChange={(e) => setSiteDescription(e.target.value)}
                            />
                          </label>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
              {step === 2 && (
                <>
                  <fieldset className="space-y-3">
                    <legend className="font-semibold">{copy('gridType')}</legend>
                    {(['on_grid', 'off_grid'] as const).map((type) => (
                      <label key={type} className="block rounded-xl border p-4">
                        <input
                          type="radio"
                          {...fields.bind('gridType')}
                          value={type}
                          checked={gridType === type}
                          onChange={() => setGridType(type)}
                          className="me-2"
                        />
                        <span className="font-medium">
                          {copy(type === 'on_grid' ? 'onGrid' : 'offGrid')}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {copy(type === 'on_grid' ? 'onGridHelp' : 'offGridHelp')}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {gridType === 'on_grid' && (
                    <div>
                      <Label htmlFor="solar-bill">{copy('billIdentifier')}</Label>
                      <Input
                        id="solar-bill"
                        inputMode="numeric"
                        pattern="[0-9۰-۹٠-٩]{6,13}"
                        minLength={6}
                        maxLength={13}
                        {...fields.bind('billIdentifier')}
                        value={billIdentifier}
                        onChange={(e) => setBillIdentifier(e.target.value)}
                        required
                      />
                    </div>
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <section aria-label={copy('stages')} className="rounded-xl border p-5">
                    <h2 className="mb-3 font-semibold">{copy('stages')}</h2>
                    <ol className="list-inside list-decimal space-y-2">
                      {stages.map((stage) => (
                        <li key={stage}>{copy(stage)}</li>
                      ))}
                    </ol>
                  </section>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      {...fields.bind('agreementAccepted')}
                      checked={agreementAccepted}
                      onChange={(e) => setAgreementAccepted(e.target.checked)}
                      required
                    />
                    {copy('agreement')}
                  </label>
                </>
              )}
              {step === 4 && (
                <Card>
                  <CardContent className="space-y-4 pt-6">
                    {review && (
                      <StepReviewPage
                        title={copy('reviewTitle')}
                        description={copy('reviewDescription')}
                        editLabel={t('electricity.order.edit', locale)}
                        disabled={pending || protection.busy || protection.completed.current}
                        onEdit={(target) => void protection.save(target)}
                        sections={[
                          {
                            id: 'property',
                            title: copy('wizardProperty'),
                            step: 1,
                            rows: [
                              {
                                label: copy('building'),
                                value: copy(
                                  review.data.submission.buildingType === 'non_household'
                                    ? 'nonHousehold'
                                    : 'building'
                                ),
                              },
                              ...[
                                ['propertyForm', 'propertyForm'],
                                ['structuralFrame', 'structuralFrame'],
                                ['siteCategory', 'siteCategory'],
                                ['installationSurface', 'installationSurface'],
                              ].flatMap(([field, label]) =>
                                review.data.submission[field!]
                                  ? [
                                      {
                                        label: copy(label!),
                                        value: copy(String(review.data.submission[field!])),
                                      },
                                    ]
                                  : []
                              ),
                              ...[
                                ['buildingCompletionDate', 'completionDate'],
                                ['totalUnits', 'totalUnits'],
                                ['usableAreaSqm', 'usableArea'],
                                ['siteDescription', 'description'],
                              ].flatMap(([field, label]) =>
                                review.data.submission[field!]
                                  ? [
                                      {
                                        label: copy(label!),
                                        value: String(review.data.submission[field!]),
                                      },
                                    ]
                                  : []
                              ),
                              ...(review.data.siteAddress
                                ? [{ label: copy('address'), value: review.data.siteAddress }]
                                : []),
                              ...(review.data.submission.siteRelationship
                                ? [
                                    {
                                      label: copy('relationship'),
                                      value: copy(
                                        review.data.submission.siteRelationship ===
                                          'authorized_operator'
                                          ? 'authorizedOperator'
                                          : String(review.data.submission.siteRelationship)
                                      ),
                                    },
                                  ]
                                : []),
                            ],
                          },
                          {
                            id: 'grid',
                            title: copy('gridType'),
                            step: 2,
                            rows: [
                              {
                                label: copy('gridType'),
                                value: copy(
                                  review.data.submission.gridType === 'off_grid'
                                    ? 'offGrid'
                                    : 'onGrid'
                                ),
                              },
                              ...(review.data.submission.billIdentifier
                                ? [
                                    {
                                      label: copy('billIdentifier'),
                                      value: String(review.data.submission.billIdentifier),
                                    },
                                  ]
                                : []),
                            ],
                          },
                          {
                            id: 'agreement',
                            title: copy('stages'),
                            step: 3,
                            rows: [
                              {
                                label: copy('reviewTermsVersion'),
                                value: review.data.agreementVersion,
                              },
                            ],
                            content: (
                              <div className="space-y-2 text-sm">
                                <p>{copy('agreement')}</p>
                                <p lang="fa" dir="rtl" className="whitespace-pre-wrap break-words">
                                  {review.data.agreementText}
                                </p>
                              </div>
                            ),
                          },
                        ]}
                      />
                    )}
                    <p className="rounded-md bg-muted p-3 text-sm">
                      {copy('reviewNoContractInvoice')}
                    </p>
                    {submitError && <p role="alert">{copy('submitError')}</p>}
                  </CardContent>
                </Card>
              )}
              {submitError && step !== 4 && <p role="alert">{copy('submitError')}</p>}
            </fieldset>
          )}
        </ValidatedFormWizard>
      )}
    </div>
  );
}
