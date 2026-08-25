import { useState, useEffect, useCallback } from 'react'
import { createFileRoute, useRouter, useParams, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import { validateNationalId, validatePostalCode } from '@barghsa/shared/validation'
import { ErrorCodes } from '@barghsa/shared/errors'
import { Loader2Icon, ChevronRightIcon } from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'

export const Route = createFileRoute('/onboarding/individual/$profileId')({
  component: IndividualProfileFormPage,
})

interface Province {
  id: string
  nameFa: string
  nameEn: string
}

interface City {
  id: string
  provinceId: string
  nameFa: string
  nameEn: string
}

interface FormErrors {
  title?: string | undefined
  firstName?: string | undefined
  lastName?: string | undefined
  nationalId?: string | undefined
  provinceId?: string | undefined
  cityId?: string | undefined
  fullAddress?: string | undefined
  postalCode?: string | undefined
}

function IndividualProfileFormPage() {
  const { profileId } = useParams({ from: '/onboarding/individual/$profileId' })
  const router = useRouter()
  const locale: Locale = 'fa'
  const isRtl = locale === 'fa'

  // Form state
  const [title, setTitle] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [selectedProvinceId, setSelectedProvinceId] = useState('')
  const [selectedCityId, setSelectedCityId] = useState('')
  const [fullAddress, setFullAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Data loading
  const [provinces, setProvinces] = useState<Province[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [loadingProvinces, setLoadingProvinces] = useState(true)
  const [loadingCities, setLoadingCities] = useState(false)

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Fetch provinces on mount
  useEffect(() => {
    let cancelled = false
    setLoadingProvinces(true)
    fetch('/api/geography/provinces', { credentials: 'include' })
      .then((res) => res.json())
      .then((data: Province[]) => {
        if (!cancelled) {
          setProvinces(data)
          setLoadingProvinces(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingProvinces(false)
          toast.error(t('onboarding.individual.error.loadProvinces', locale))
        }
      })
    return () => { cancelled = true }
  }, [])

  // Fetch cities when province changes
  useEffect(() => {
    if (!selectedProvinceId) {
      setCities([])
      setSelectedCityId('')
      return
    }
    let cancelled = false
    setLoadingCities(true)
    setSelectedCityId('')
    fetch(`/api/geography/provinces/${selectedProvinceId}/cities`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data: City[]) => {
        if (!cancelled) {
          setCities(data)
          setLoadingCities(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingCities(false)
          toast.error(t('onboarding.individual.error.loadCities', locale))
        }
      })
    return () => { cancelled = true }
  }, [selectedProvinceId])

  // Field-level validation
  const validateField = useCallback(
    (field: string, value: string): string | undefined => {
      switch (field) {
        case 'title':
          if (value.length > 50) return t('onboarding.individual.error.maxChars', locale).replace('{count}', '50')
          return undefined
        case 'firstName':
          if (!value.trim()) return t('onboarding.individual.error.required', locale)
          if (value.length > 100) return t('onboarding.individual.error.maxChars', locale).replace('{count}', '100')
          return undefined
        case 'lastName':
          if (!value.trim()) return t('onboarding.individual.error.required', locale)
          if (value.length > 100) return t('onboarding.individual.error.maxChars', locale).replace('{count}', '100')
          return undefined
        case 'nationalId':
          if (!value.trim()) return t('onboarding.individual.error.required', locale)
          if (!validateNationalId(value.trim())) return t('onboarding.individual.error.invalidNationalId', locale)
          return undefined
        case 'provinceId':
          if (!value) return t('onboarding.individual.error.required', locale)
          return undefined
        case 'cityId':
          if (!value) return t('onboarding.individual.error.required', locale)
          return undefined
        case 'fullAddress':
          if (!value.trim()) return t('onboarding.individual.error.required', locale)
          if (value.length > 500) return t('onboarding.individual.error.maxChars', locale).replace('{count}', '500')
          return undefined
        case 'postalCode':
          if (!value.trim()) return t('onboarding.individual.error.required', locale)
          if (!validatePostalCode(value.trim())) return t('onboarding.individual.error.invalidPostalCode', locale)
          return undefined
        default:
          return undefined
      }
    },
    [locale],
  )

  const handleBlur = useCallback(
    (field: string) => {
      setTouched((prev) => ({ ...prev, [field]: true }))
      const values: Record<string, string> = {
        title,
        firstName,
        lastName,
        nationalId,
        provinceId: selectedProvinceId,
        cityId: selectedCityId,
        fullAddress,
        postalCode,
      }
      const value = values[field] ?? ''
      const error = validateField(field, value)
      setErrors((prev) => ({ ...prev, [field]: error }))
    },
    [title, firstName, lastName, nationalId, selectedProvinceId, selectedCityId, fullAddress, postalCode, validateField],
  )

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {
      firstName: validateField('firstName', firstName),
      lastName: validateField('lastName', lastName),
      nationalId: validateField('nationalId', nationalId),
      provinceId: validateField('provinceId', selectedProvinceId),
      cityId: validateField('cityId', selectedCityId),
      fullAddress: validateField('fullAddress', fullAddress),
      postalCode: validateField('postalCode', postalCode),
    }
    setErrors(newErrors)
    setTouched({
      firstName: true,
      lastName: true,
      nationalId: true,
      provinceId: true,
      cityId: true,
      fullAddress: true,
      postalCode: true,
    })
    return !Object.values(newErrors).some(Boolean)
  }, [firstName, lastName, nationalId, selectedProvinceId, selectedCityId, fullAddress, postalCode, validateField])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setSubmitError(null)

      if (!validateForm()) return

      setSubmitting(true)

      try {
        const response = await fetch(`/api/onboarding/individual/${profileId}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || undefined,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            nationalId: nationalId.trim(),
            provinceId: selectedProvinceId,
            cityId: selectedCityId,
            fullAddress: fullAddress.trim(),
            postalCode: postalCode.trim(),
          }),
        })

        const body: Record<string, unknown> = await response.json().catch(() => ({}))

        if (!response.ok) {
          const errorCode =
            typeof body?.error === 'string'
              ? body.error
              : (body?.error as Record<string, unknown>)?.code as string | undefined

          if (errorCode === ErrorCodes.CONFLICT_DUPLICATE.code) {
            setSubmitError(t('onboarding.individual.error.duplicateNationalId', locale))
          } else {
            setSubmitError(t('onboarding.individual.error.submit', locale))
          }
          return
        }

        toast.success(t('onboarding.individual.saved', locale))
                  router.navigate({
                    to: '/onboarding/complete',
                    search: { profileId },
                    replace: true,
                  })
      } catch {
        setSubmitError(t('onboarding.individual.error.submit', locale))
      } finally {
        setSubmitting(false)
      }
    },
    [profileId, title, firstName, lastName, nationalId, selectedProvinceId, selectedCityId, fullAddress, postalCode, validateForm, locale, router],
  )

  return (
    <div
      className="container mx-auto flex min-h-screen items-start justify-center p-4 pt-12"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-2xl">
        {/* Back link */}
        <Link
          to="/onboarding"
          className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronRightIcon className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
          {t('onboarding.individual.back', locale)}
        </Link>

        <h1 className="mb-1 text-2xl font-bold">
          {t('onboarding.individual.title', locale)}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('onboarding.individual.subtitle', locale)}
        </p>

        {/* Submit error alert */}
        {submitError && (
          <Alert variant="destructive" className="mb-6" role="alert">
            <AlertTitle className="sr-only">Error</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {/* Title (optional) */}
          <div className="space-y-2">
            <Label htmlFor="title">
              {t('onboarding.individual.title.label', locale)}
              <span className="text-muted-foreground ml-1 text-xs">({t('onboarding.individual.title.placeholder', locale)})</span>
            </Label>
            <Input
              id="title"
              type="text"
              maxLength={50}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => handleBlur('title')}
              disabled={submitting}
              placeholder={t('onboarding.individual.title.placeholder', locale)}
            />
          </div>

          {/* Two-column layout for desktop */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* First Name */}
            <div className="space-y-2">
              <Label htmlFor="firstName">
                {t('onboarding.individual.firstName', locale)}
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="firstName"
                type="text"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={() => handleBlur('firstName')}
                disabled={submitting}
                placeholder={t('onboarding.individual.firstName.placeholder', locale)}
                aria-invalid={touched.firstName && !!errors.firstName}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
              />
              {touched.firstName && errors.firstName && (
                <p id="firstName-error" className="text-sm text-destructive" role="alert">
                  {errors.firstName}
                </p>
              )}
            </div>

            {/* Last Name */}
            <div className="space-y-2">
              <Label htmlFor="lastName">
                {t('onboarding.individual.lastName', locale)}
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="lastName"
                type="text"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onBlur={() => handleBlur('lastName')}
                disabled={submitting}
                placeholder={t('onboarding.individual.lastName.placeholder', locale)}
                aria-invalid={touched.lastName && !!errors.lastName}
                aria-describedby={errors.lastName ? 'lastName-error' : undefined}
              />
              {touched.lastName && errors.lastName && (
                <p id="lastName-error" className="text-sm text-destructive" role="alert">
                  {errors.lastName}
                </p>
              )}
            </div>
          </div>

          {/* National ID */}
          <div className="space-y-2">
            <Label htmlFor="nationalId">
              {t('onboarding.individual.nationalId', locale)}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="nationalId"
              type="text"
              inputMode="numeric"
              required
              maxLength={10}
              value={nationalId}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 10)
                setNationalId(val)
              }}
              onBlur={() => handleBlur('nationalId')}
              disabled={submitting}
              placeholder={t('onboarding.individual.nationalId.placeholder', locale)}
              aria-invalid={touched.nationalId && !!errors.nationalId}
              aria-describedby={errors.nationalId ? 'nationalId-error' : undefined}
            />
            {touched.nationalId && errors.nationalId && (
              <p id="nationalId-error" className="text-sm text-destructive" role="alert">
                {errors.nationalId}
              </p>
            )}
          </div>

          {/* Province / City */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Province */}
            <div className="space-y-2">
              <Label htmlFor="provinceId">
                {t('onboarding.individual.province', locale)}
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              {loadingProvinces ? (
                <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {t('onboarding.individual.loading', locale)}
                </div>
              ) : (
                <select
                  id="provinceId"
                  value={selectedProvinceId}
                  onChange={(e) => setSelectedProvinceId(e.target.value)}
                  onBlur={() => handleBlur('provinceId')}
                  disabled={submitting}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-invalid={touched.provinceId && !!errors.provinceId}
                  aria-describedby={errors.provinceId ? 'provinceId-error' : undefined}
                >
                  <option value="">
                    {t('onboarding.individual.province.placeholder', locale)}
                  </option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {isRtl ? p.nameFa : p.nameEn}
                    </option>
                  ))}
                </select>
              )}
              {touched.provinceId && errors.provinceId && (
                <p id="provinceId-error" className="text-sm text-destructive" role="alert">
                  {errors.provinceId}
                </p>
              )}
            </div>

            {/* City */}
            <div className="space-y-2">
              <Label htmlFor="cityId">
                {t('onboarding.individual.city', locale)}
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              {loadingCities ? (
                <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {t('onboarding.individual.loading', locale)}
                </div>
              ) : (
                <select
                  id="cityId"
                  value={selectedCityId}
                  onChange={(e) => setSelectedCityId(e.target.value)}
                  onBlur={() => handleBlur('cityId')}
                  disabled={submitting || !selectedProvinceId}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-invalid={touched.cityId && !!errors.cityId}
                  aria-describedby={errors.cityId ? 'cityId-error' : undefined}
                >
                  <option value="">
                    {t('onboarding.individual.city.placeholder', locale)}
                  </option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {isRtl ? c.nameFa : c.nameEn}
                    </option>
                  ))}
                </select>
              )}
              {touched.cityId && errors.cityId && (
                <p id="cityId-error" className="text-sm text-destructive" role="alert">
                  {errors.cityId}
                </p>
              )}
            </div>
          </div>

          {/* Full Address */}
          <div className="space-y-2">
            <Label htmlFor="fullAddress">
              {t('onboarding.individual.address', locale)}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <textarea
              id="fullAddress"
              required
              maxLength={500}
              rows={3}
              value={fullAddress}
              onChange={(e) => setFullAddress(e.target.value)}
              onBlur={() => handleBlur('fullAddress')}
              disabled={submitting}
              placeholder={t('onboarding.individual.address.placeholder', locale)}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-invalid={touched.fullAddress && !!errors.fullAddress}
              aria-describedby={errors.fullAddress ? 'fullAddress-error' : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {fullAddress.length}/500
            </p>
            {touched.fullAddress && errors.fullAddress && (
              <p id="fullAddress-error" className="text-sm text-destructive" role="alert">
                {errors.fullAddress}
              </p>
            )}
          </div>

          {/* Postal Code */}
          <div className="space-y-2">
            <Label htmlFor="postalCode">
              {t('onboarding.individual.postalCode', locale)}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="postalCode"
              type="text"
              inputMode="numeric"
              required
              maxLength={10}
              value={postalCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 10)
                setPostalCode(val)
              }}
              onBlur={() => handleBlur('postalCode')}
              disabled={submitting}
              placeholder={t('onboarding.individual.postalCode.placeholder', locale)}
              aria-invalid={touched.postalCode && !!errors.postalCode}
              aria-describedby={errors.postalCode ? 'postalCode-error' : undefined}
            />
            {touched.postalCode && errors.postalCode && (
              <p id="postalCode-error" className="text-sm text-destructive" role="alert">
                {errors.postalCode}
              </p>
            )}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t('onboarding.individual.saving', locale)}
              </>
            ) : (
              t('onboarding.individual.save', locale)
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}