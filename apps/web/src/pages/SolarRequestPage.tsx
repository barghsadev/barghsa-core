import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';

interface Address {
  id: string;
  fullAddress: string;
  postalCode: string;
}
type BuildingType = 'building_apartment' | 'non_household';
type GridType = 'on_grid' | 'off_grid';

export function SolarRequestPage() {
  const navigate = useNavigate();
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const [profileId, setProfileId] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [buildingType, setBuildingType] = useState<BuildingType>('building_apartment');
  const [propertyForm, setPropertyForm] = useState<'apartment' | 'villa'>('apartment');
  const [structuralFrame, setStructuralFrame] = useState<'concrete' | 'steel' | 'other'>(
    'concrete'
  );
  const [buildingCompletionDate, setBuildingCompletionDate] = useState('');
  const [totalUnits, setTotalUnits] = useState('');
  const [siteCategory, setSiteCategory] = useState<'agricultural' | 'industrial'>('agricultural');
  const [installationSurface, setInstallationSurface] = useState<'land' | 'rooftop' | 'both'>(
    'land'
  );
  const [usableAreaSqm, setUsableAreaSqm] = useState('');
  const [siteAddressId, setSiteAddressId] = useState('');
  const [siteRelationship, setSiteRelationship] = useState<
    'owner' | 'tenant' | 'authorized_operator'
  >('owner');
  const [siteDescription, setSiteDescription] = useState('');
  const [gridType, setGridType] = useState<GridType>('on_grid');
  const [billIdentifier, setBillIdentifier] = useState('');
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const submissionKey = useRef<string | null>(null);

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
            setSiteAddressId(result.addresses[0]?.id ?? '');
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || !agreementAccepted || submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    const base = {
      profileId,
      submissionKey: (submissionKey.current ??= crypto.randomUUID()),
      gridType,
      ...(gridType === 'on_grid' ? { billIdentifier: normalizeProfileDigits(billIdentifier) } : {}),
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
    try {
      const response = await fetch('/api/solar/requests', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...base, ...details }),
      });
      if (!response.ok) throw new Error('submit');
      const result = (await response.json()) as { requestId: string };
      void navigate({
        to: '/solar/requests/$requestId',
        params: { requestId: result.requestId },
      });
    } catch {
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  const age = buildingCompletionDate
    ? Math.max(0, new Date().getFullYear() - Number(buildingCompletionDate.slice(0, 4)))
    : null;
  const stages = ['requestStage', 'uploadStage', 'verifyStage', 'postalStage', 'finalStage'];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">{copy('title')}</h1>
        <p className="text-muted-foreground">{copy('instruction')}</p>
      </div>
      {loading && <p role="status">{copy('loading')}</p>}
      {loadError && <p role="alert">{copy('loadError')}</p>}
      {!loading && !profileId && <p role="alert">{copy('profileRequired')}</p>}
      {!loading && profileId && (
        <form onSubmit={submit} className="space-y-6">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-3 font-semibold">{copy('instruction')}</legend>
            {(['building_apartment', 'non_household'] as const).map((type) => (
              <label
                key={type}
                className={`cursor-pointer rounded-xl border p-4 ${buildingType === type ? 'border-primary bg-primary/5' : ''}`}
              >
                <input
                  type="radio"
                  name="buildingType"
                  value={type}
                  checked={buildingType === type}
                  onChange={() => setBuildingType(type)}
                  className="me-2"
                />
                <span className="font-medium">
                  {copy(type === 'building_apartment' ? 'building' : 'nonHousehold')}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {copy(type === 'building_apartment' ? 'buildingHelp' : 'nonHouseholdHelp')}
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
                      value={propertyForm}
                      onChange={(e) => setPropertyForm(e.target.value as typeof propertyForm)}
                    >
                      <option value="apartment">{copy('apartment')}</option>
                      <option value="villa">{copy('villa')}</option>
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span>{copy('structuralFrame')}</span>
                    <select
                      className="w-full rounded-md border bg-background p-2"
                      value={structuralFrame}
                      onChange={(e) => setStructuralFrame(e.target.value as typeof structuralFrame)}
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
                      value={siteCategory}
                      onChange={(e) => setSiteCategory(e.target.value as typeof siteCategory)}
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
                      value={usableAreaSqm}
                      onChange={(e) => setUsableAreaSqm(e.target.value)}
                      required
                    />
                  </div>
                  <label className="block space-y-1">
                    <span>{copy('address')}</span>
                    <select
                      className="w-full rounded-md border bg-background p-2"
                      value={siteAddressId}
                      onChange={(e) => setSiteAddressId(e.target.value)}
                      required
                    >
                      {addresses.map((address) => (
                        <option key={address.id} value={address.id}>
                          {address.fullAddress}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!addresses.length && (
                    <Link className="text-sm underline" to="/settings/addresses">
                      {copy('noAddresses')}
                    </Link>
                  )}
                  <label className="block space-y-1">
                    <span>{copy('relationship')}</span>
                    <select
                      className="w-full rounded-md border bg-background p-2"
                      value={siteRelationship}
                      onChange={(e) =>
                        setSiteRelationship(e.target.value as typeof siteRelationship)
                      }
                    >
                      {(['owner', 'tenant', 'authorized_operator'] as const).map((item) => (
                        <option key={item} value={item}>
                          {copy(item === 'authorized_operator' ? 'authorizedOperator' : item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span>{copy('description')}</span>
                    <textarea
                      className="min-h-24 w-full rounded-md border bg-background p-2"
                      maxLength={2000}
                      value={siteDescription}
                      onChange={(e) => setSiteDescription(e.target.value)}
                    />
                  </label>
                </>
              )}
            </CardContent>
          </Card>
          <fieldset className="space-y-3">
            <legend className="font-semibold">{copy('gridType')}</legend>
            {(['on_grid', 'off_grid'] as const).map((type) => (
              <label key={type} className="block rounded-xl border p-4">
                <input
                  type="radio"
                  name="gridType"
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
                value={billIdentifier}
                onChange={(e) => setBillIdentifier(e.target.value)}
                required
              />
            </div>
          )}
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
              checked={agreementAccepted}
              onChange={(e) => setAgreementAccepted(e.target.checked)}
              required
            />
            {copy('agreement')}
          </label>
          {submitError && <p role="alert">{copy('submitError')}</p>}
          <Button
            type="submit"
            disabled={
              !agreementAccepted ||
              submitting ||
              (buildingType === 'non_household' && !siteAddressId)
            }
          >
            {copy(submitting ? 'submitting' : 'submit')}
          </Button>
        </form>
      )}
    </main>
  );
}
