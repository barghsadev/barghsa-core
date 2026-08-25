import { useState, useEffect, useCallback } from 'react'
import { createFileRoute, useRouter, useParams, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import { validateLegalNationalIdentifier, validatePostalCode } from '@barghsa/shared/validation'
import { ErrorCodes } from '@barghsa/shared/errors'
import { Loader2Icon, ChevronRightIcon, UploadIcon } from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'

export const Route = createFileRoute('/onboarding/legal/$profileId')({
  component: LegalProfileFormPage,
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

interface CompanyType {
  id: string
  nameEn: string
  nameFa: string
}

interface FormErrors {
  legalName?: string | undefined
  nationalIdentifier?: string | undefined
  registrationNumber?: string | undefined
  companyTypeId?: string | undefined
  registrationDate?: string | undefined
  economicCode?: string | undefined
  officialPhone?: string | undefined
  officialEmail?: string | undefined
  officialProvinceId?: string | undefined
  officialCityId?: string | undefined
  officialFullAddress?: string | undefined
  officialPostalCode?: string | undefined
  representativeTitle?: string | undefined
  representativeRelationship?: string | undefined
}

function LegalProfileFormPage() {
  const { profileId } = useParams({ from: '/onboarding/legal/$profileId' })
  const router = useRouter()
  const locale: Locale = 'fa'
  const isRtl = locale === 'fa'

  // ── Form state ──────────────────────────────────────────
  // Representative section
  const [representativeTitle, setRepresentativeTitle] = useState('')
  const [representativeRelationship, setRepresentativeRelationship] = useState('')
  // Legal entity section
  const [legalName, setLegalName] = useState('')
  const [nationalIdentifier, setNationalIdentifier] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [companyTypeId, setCompanyTypeId] = useState('')
  const [registrationDate, setRegistrationDate] = useState('')
  const [economicCode, setEconomicCode] = useState('')
  const [officialPhone, setOfficialPhone] = useState('')
  const [officialEmail, setOfficialEmail] = useState('')
  // Official address section
  const [officialProvinceId, setOfficialProvinceId] = useState('')
  const [officialCityId, setOfficialCityId] = useState('')
  const [officialFullAddress, setOfficialFullAddress] = useState('')
  const [officialPostalCode, setOfficialPostalCode] = useState('')

  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // ── Data loading ────────────────────────────────────────
  const [provinces, setProvinces] = useState<Province[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [companyTypes, setCompanyTypes] = useState<CompanyType[]>([])
  const [loadingProvinces, setLoadingProvinces] = useState(true)
  const [loadingCities, setLoadingCities] = useState(false)
  const [loadingCompanyTypes, setLoadingCompanyTypes] = useState(true)
  const [companyTypesError, setCompanyTypesError] = useState(false)

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Document upload (simplified: placeholder for drag & drop) ──
  const [documents, setDocuments] = useState<File[]>([])

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
          toast.error(
            isRtl
              ? 'بارگذاری استان‌ها با خطا مواجه شد'
              : 'Failed to load provinces',
          )
        }
      })
    return () => { cancelled = true }
  }, [])

  // Fetch company types on mount
  const fetchCompanyTypes = useCallback(() => {
    let cancelled = false
    setLoadingCompanyTypes(true)
    setCompanyTypesError(false)
    fetch('/api/geography/company-types', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP error')
        return res.json()
      })
      .then((data: CompanyType[]) => {
        if (!cancelled) {
          setCompanyTypes(data)
          setLoadingCompanyTypes(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingCompanyTypes(false)
          setCompanyTypesError(true)
          toast.error(
            isRtl
              ? 'بارگذاری انواع شرکت با خطا مواجه شد'
              : 'Failed to load company types',
          )
        }
      })
    return () => { cancelled = true }
  }, [isRtl])

  useEffect(() => {
    return fetchCompanyTypes()
  }, [fetchCompanyTypes])

  // Fetch cities when province changes
  useEffect(() => {
    if (!officialProvinceId) {
      setCities([])
      setOfficialCityId('')
      return
    }
    let cancelled = false
    setLoadingCities(true)
    setOfficialCityId('')
    fetch(`/api/geography/provinces/${officialProvinceId}/cities`, { credentials: 'include' })
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
          toast.error(
            isRtl
              ? 'بارگذاری شهرها با خطا مواجه شد'
              : 'Failed to load cities',
          )
        }
      })
    return () => { cancelled = true }
  }, [officialProvinceId])

  // ── Field-level validation ──────────────────────────────
  const validateField = useCallback(
    (field: string, value: string): string | undefined => {
      switch (field) {
        case 'legalName':
          if (!value.trim()) return isRtl ? 'نام شخص حقوقی الزامی است' : 'Legal name is required'
          if (value.length > 200) return isRtl ? 'حداکثر ۲۰۰ کاراکتر' : 'Max 200 characters'
          return undefined
        case 'nationalIdentifier':
          if (!value.trim()) return isRtl ? 'شناسه ملی الزامی است' : 'National identifier is required'
          if (!validateLegalNationalIdentifier(value.trim())) return isRtl ? 'شناسه ملی معتبر نیست (۱۱ رقم)' : 'Invalid national identifier (11 digits)'
          return undefined
        case 'registrationNumber':
          if (!value.trim()) return isRtl ? 'شماره ثبت الزامی است' : 'Registration number is required'
          if (value.length > 50) return isRtl ? 'حداکثر ۵۰ کاراکتر' : 'Max 50 characters'
          return undefined
        case 'companyTypeId':
          if (!value) return isRtl ? 'نوع شرکت الزامی است' : 'Company type is required'
          return undefined
        case 'registrationDate':
          return undefined // optional
        case 'economicCode':
          return undefined // optional
        case 'officialPhone':
          return undefined // optional
        case 'officialEmail':
          if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return isRtl ? 'ایمیل معتبر نیست' : 'Invalid email format'
          return undefined
        case 'officialProvinceId':
          return undefined // optional
        case 'officialCityId':
          return undefined // optional
        case 'officialFullAddress':
          if (value && value.length > 500) return isRtl ? 'حداکثر ۵۰۰ کاراکتر' : 'Max 500 characters'
          return undefined
        case 'officialPostalCode':
          if (value && !validatePostalCode(value.trim())) return isRtl ? 'کد پستی معتبر نیست' : 'Invalid postal code'
          return undefined
        case 'representativeTitle':
          if (!value.trim()) return isRtl ? 'عنوان نماینده الزامی است' : 'Representative title is required'
          if (value.length > 100) return isRtl ? 'حداکثر ۱۰۰ کاراکتر' : 'Max 100 characters'
          return undefined
        case 'representativeRelationship':
          if (!value.trim()) return isRtl ? 'نسبت نماینده الزامی است' : 'Representative relationship is required'
          if (value.length > 100) return isRtl ? 'حداکثر ۱۰۰ کاراکتر' : 'Max 100 characters'
          return undefined
        default:
          return undefined
      }
    },
    [isRtl],
  )

  const handleBlur = useCallback(
    (field: string) => {
      setTouched((prev) => ({ ...prev, [field]: true }))
      const values: Record<string, string> = {
        legalName,
        nationalIdentifier,
        registrationNumber,
        companyTypeId,
        registrationDate,
        economicCode,
        officialPhone,
        officialEmail,
        officialProvinceId: officialProvinceId,
        officialCityId: officialCityId,
        officialFullAddress,
        officialPostalCode,
        representativeTitle,
        representativeRelationship,
      }
      const value = values[field] ?? ''
      const error = validateField(field, value)
      setErrors((prev) => ({ ...prev, [field]: error }))
    },
    [
      legalName, nationalIdentifier, registrationNumber, companyTypeId,
      registrationDate, economicCode, officialPhone, officialEmail,
      officialProvinceId, officialCityId, officialFullAddress, officialPostalCode,
      representativeTitle, representativeRelationship, validateField,
    ],
  )

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {
      legalName: validateField('legalName', legalName),
      nationalIdentifier: validateField('nationalIdentifier', nationalIdentifier),
      registrationNumber: validateField('registrationNumber', registrationNumber),
      companyTypeId: validateField('companyTypeId', companyTypeId),
      officialPostalCode: validateField('officialPostalCode', officialPostalCode),
      representativeTitle: validateField('representativeTitle', representativeTitle),
      representativeRelationship: validateField('representativeRelationship', representativeRelationship),
    }
    setErrors(newErrors)
    setTouched({
      legalName: true,
      nationalIdentifier: true,
      registrationNumber: true,
      companyTypeId: true,
      officialPostalCode: true,
      representativeTitle: true,
      representativeRelationship: true,
    })
    return !Object.values(newErrors).some(Boolean)
  }, [legalName, nationalIdentifier, registrationNumber, companyTypeId, officialPostalCode, representativeTitle, representativeRelationship, validateField])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setSubmitError(null)

      if (!validateForm()) return

      setSubmitting(true)

      try {
        const response = await fetch(`/api/onboarding/legal/${profileId}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legalName: legalName.trim(),
            nationalIdentifier: nationalIdentifier.trim(),
            registrationNumber: registrationNumber.trim(),
            companyTypeId: companyTypeId || undefined,
            registrationDate: registrationDate || undefined,
            economicCode: economicCode.trim() || undefined,
            officialPhone: officialPhone.trim() || undefined,
            officialEmail: officialEmail.trim() || undefined,
            officialProvinceId: officialProvinceId || undefined,
            officialCityId: officialCityId || undefined,
            officialFullAddress: officialFullAddress.trim() || undefined,
            officialPostalCode: officialPostalCode.trim() || undefined,
            representativeTitle: representativeTitle.trim(),
            representativeRelationship: representativeRelationship.trim(),
          }),
        })

        const body: Record<string, unknown> = await response.json().catch(() => ({}))

        if (!response.ok) {
          const errorCode =
            typeof body?.error === 'string'
              ? body.error
              : (body?.error as Record<string, unknown>)?.code as string | undefined

          if (errorCode === ErrorCodes.CONFLICT_DUPLICATE.code) {
            setSubmitError(
              isRtl
                ? 'این شناسه ملی قبلاً ثبت شده است'
                : 'This national identifier is already registered',
            )
          } else {
            setSubmitError(
              isRtl
                ? 'ذخیره‌سازی با خطا مواجه شد. لطفاً دوباره تلاش کنید'
                : 'Failed to save. Please try again',
            )
          }
          return
        }

        toast.success(
          isRtl
            ? 'پروفایل حقوقی با موفقیت ذخیره شد'
            : 'Legal profile saved successfully',
        )
        router.navigate({
          to: '/onboarding/complete',
          search: { profileId },
          replace: true,
        })
      } catch {
        setSubmitError(
          isRtl
            ? 'ذخیره‌سازی با خطا مواجه شد. لطفاً دوباره تلاش کنید'
            : 'Failed to save. Please try again',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      profileId, legalName, nationalIdentifier, registrationNumber, companyTypeId,
      registrationDate, economicCode, officialPhone, officialEmail,
      officialProvinceId, officialCityId, officialFullAddress, officialPostalCode,
      representativeTitle, representativeRelationship, validateForm, isRtl, router,
    ],
  )

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files) {
      setDocuments((prev) => [...prev, ...Array.from(files)])
    }
  }

  function removeDocument(index: number) {
    setDocuments((prev) => prev.filter((_, i) => i !== index))
  }

  // ── Render helpers ──────────────────────────────────────
  function renderField(
    field: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options?: {
      type?: string
      required?: boolean
      maxLength?: number
      placeholder?: string
      inputMode?: 'text' | 'numeric' | 'email' | 'tel'
    },
  ) {
    const isTouched = touched[field]
    const error = errors[field as keyof FormErrors]

    return (
      <div className="space-y-2">
        <Label htmlFor={field}>
          {label}
          {options?.required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <Input
          id={field}
          type={options?.type ?? 'text'}
          inputMode={options?.inputMode}
          required={options?.required}
          maxLength={options?.maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => handleBlur(field)}
          disabled={submitting}
          placeholder={options?.placeholder}
          aria-invalid={isTouched && !!error}
          aria-describedby={error ? `${field}-error` : undefined}
        />
        {isTouched && error && (
          <p id={`${field}-error`} className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="container mx-auto flex min-h-screen items-start justify-center p-4 pt-12"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-3xl">
        {/* Back link */}
        <Link
          to="/onboarding"
          className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronRightIcon className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
          {isRtl ? 'بازگشت' : 'Back'}
        </Link>

        <h1 className="mb-1 text-2xl font-bold">
          {isRtl ? 'پروفایل حقوقی' : 'Legal Profile'}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {isRtl
            ? 'لطفاً اطلاعات شخص حقوقی را وارد کنید'
            : 'Please enter the legal entity information'}
        </p>

        {/* Submit error alert */}
        {submitError && (
          <Alert variant="destructive" className="mb-6" role="alert">
            <AlertTitle className="sr-only">Error</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-8" noValidate>
          {/* ── Section 1: Authorized Representative ────────── */}
          <fieldset>
            <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
              {isRtl ? 'اطلاعات نماینده' : 'Authorized Representative'}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {renderField(
                'representativeTitle',
                isRtl ? 'عنوان/سمت نماینده' : 'Representative Title',
                representativeTitle,
                setRepresentativeTitle,
                {
                  required: true,
                  maxLength: 100,
                  placeholder: isRtl ? 'مدیرعامل، رئیس هیئت مدیره، ...' : 'CEO, Board Chair, ...',
                },
              )}
              {renderField(
                'representativeRelationship',
                isRtl ? 'نسبت/ارتباط نماینده' : 'Representative Relationship',
                representativeRelationship,
                setRepresentativeRelationship,
                {
                  required: true,
                  maxLength: 100,
                  placeholder: isRtl ? 'رابطه با شخص حقوقی' : 'Relationship to the entity',
                },
              )}
            </div>
          </fieldset>

          {/* ── Section 2: Legal Entity ─────────────────────── */}
          <fieldset>
            <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
              {isRtl ? 'اطلاعات شخص حقوقی' : 'Legal Entity'}
            </legend>
            <div className="space-y-4">
              {renderField(
                'legalName',
                isRtl ? 'نام شخص حقوقی' : 'Legal Name',
                legalName,
                setLegalName,
                {
                  required: true,
                  maxLength: 200,
                  placeholder: isRtl ? 'نام شرکت را وارد کنید' : 'Enter company name',
                },
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {renderField(
                  'nationalIdentifier',
                  isRtl ? 'شناسه ملی' : 'National Identifier',
                  nationalIdentifier,
                  (v) => setNationalIdentifier(v.replace(/\D/g, '').slice(0, 11)),
                  {
                    required: true,
                    inputMode: 'numeric',
                    maxLength: 11,
                    placeholder: isRtl ? 'شناسه ملی ۱۱ رقمی' : '11-digit national identifier',
                  },
                )}
                {renderField(
                  'registrationNumber',
                  isRtl ? 'شماره ثبت' : 'Registration Number',
                  registrationNumber,
                  setRegistrationNumber,
                  {
                    required: true,
                    maxLength: 50,
                    placeholder: isRtl ? 'شماره ثبت شرکت' : 'Company registration number',
                  },
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Company type (select) */}
                <div className="space-y-2">
                  <Label htmlFor="companyTypeId">
                    {isRtl ? 'نوع شرکت' : 'Company Type'}
                    <span className="text-destructive ml-0.5">*</span>
                  </Label>
                  {loadingCompanyTypes ? (
                    <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                    </div>
                  ) : companyTypesError ? (
                    <div className="flex h-10 items-center gap-2 text-sm text-destructive">
                      <span>
                        {isRtl ? 'خطا در بارگذاری' : 'Failed to load'}
                      </span>
                      <button
                        type="button"
                        onClick={fetchCompanyTypes}
                        disabled={loadingCompanyTypes}
                        className="rounded border border-input px-2 py-1 text-xs hover:bg-muted"
                      >
                        {isRtl ? 'تلاش مجدد' : 'Retry'}
                      </button>
                    </div>
                  ) : (
                    <select
                      id="companyTypeId"
                      value={companyTypeId}
                      onChange={(e) => setCompanyTypeId(e.target.value)}
                      onBlur={() => handleBlur('companyTypeId')}
                      disabled={submitting}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-invalid={touched.companyTypeId && !!errors.companyTypeId}
                      aria-describedby={errors.companyTypeId ? 'companyTypeId-error' : undefined}
                    >
                      <option value="">
                        {isRtl ? 'نوع شرکت را انتخاب کنید' : 'Select company type'}
                      </option>
                      {companyTypes.map((ct) => (
                        <option key={ct.id} value={ct.id}>
                          {isRtl ? ct.nameFa : ct.nameEn}
                        </option>
                      ))}
                    </select>
                  )}
                  {touched.companyTypeId && errors.companyTypeId && (
                    <p id="companyTypeId-error" className="text-sm text-destructive" role="alert">
                      {errors.companyTypeId}
                    </p>
                  )}
                </div>

                {renderField(
                  'registrationDate',
                  isRtl ? 'تاریخ ثبت' : 'Registration Date',
                  registrationDate,
                  setRegistrationDate,
                  {
                    type: 'date',
                    placeholder: isRtl ? 'تاریخ ثبت شرکت' : 'Registration date',
                  },
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {renderField(
                  'economicCode',
                  isRtl ? 'کد اقتصادی' : 'Economic Code',
                  economicCode,
                  setEconomicCode,
                  {
                    placeholder: isRtl ? 'کد اقتصادی (اختیاری)' : 'Economic code (optional)',
                  },
                )}
                {renderField(
                  'officialPhone',
                  isRtl ? 'تلفن رسمی' : 'Official Phone',
                  officialPhone,
                  setOfficialPhone,
                  {
                    type: 'tel',
                    inputMode: 'tel',
                    placeholder: isRtl ? 'تلفن رسمی (اختیاری)' : 'Official phone (optional)',
                  },
                )}
              </div>

              {renderField(
                'officialEmail',
                isRtl ? 'ایمیل رسمی' : 'Official Email',
                officialEmail,
                setOfficialEmail,
                {
                  type: 'email',
                  inputMode: 'email',
                  placeholder: isRtl ? 'ایمیل رسمی (اختیاری)' : 'Official email (optional)',
                },
              )}
            </div>
          </fieldset>

          {/* ── Section 3: Official Address ────────────────── */}
          <fieldset>
            <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
              {isRtl ? 'آدرس رسمی' : 'Official Address'}
            </legend>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Province */}
              <div className="space-y-2">
                <Label htmlFor="officialProvinceId">
                  {isRtl ? 'استان' : 'Province'}
                </Label>
                {loadingProvinces ? (
                  <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                  </div>
                ) : (
                  <select
                    id="officialProvinceId"
                    value={officialProvinceId}
                    onChange={(e) => setOfficialProvinceId(e.target.value)}
                    onBlur={() => handleBlur('officialProvinceId')}
                    disabled={submitting}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {isRtl ? 'استان را انتخاب کنید' : 'Select province'}
                    </option>
                    {provinces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {isRtl ? p.nameFa : p.nameEn}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* City */}
              <div className="space-y-2">
                <Label htmlFor="officialCityId">
                  {isRtl ? 'شهر' : 'City'}
                </Label>
                {loadingCities ? (
                  <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                  </div>
                ) : (
                  <select
                    id="officialCityId"
                    value={officialCityId}
                    onChange={(e) => setOfficialCityId(e.target.value)}
                    onBlur={() => handleBlur('officialCityId')}
                    disabled={submitting || !officialProvinceId}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {isRtl ? 'شهر را انتخاب کنید' : 'Select city'}
                    </option>
                    {cities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isRtl ? c.nameFa : c.nameEn}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Full Address */}
            <div className="mt-4 space-y-2">
              <Label htmlFor="officialFullAddress">
                {isRtl ? 'آدرس کامل' : 'Full Address'}
              </Label>
              <textarea
                id="officialFullAddress"
                maxLength={500}
                rows={3}
                value={officialFullAddress}
                onChange={(e) => setOfficialFullAddress(e.target.value)}
                onBlur={() => handleBlur('officialFullAddress')}
                disabled={submitting}
                placeholder={isRtl ? 'آدرس کامل محل شرکت' : 'Full company address'}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                aria-invalid={touched.officialFullAddress && !!errors.officialFullAddress}
                aria-describedby={errors.officialFullAddress ? 'officialFullAddress-error' : undefined}
              />
              <p className="text-xs text-muted-foreground">
                {officialFullAddress.length}/500
              </p>
              {touched.officialFullAddress && errors.officialFullAddress && (
                <p id="officialFullAddress-error" className="text-sm text-destructive" role="alert">
                  {errors.officialFullAddress}
                </p>
              )}
            </div>

            {/* Postal Code */}
            <div className="mt-4 space-y-2">
              <Label htmlFor="officialPostalCode">
                {isRtl ? 'کد پستی' : 'Postal Code'}
              </Label>
              <Input
                id="officialPostalCode"
                type="text"
                inputMode="numeric"
                maxLength={10}
                value={officialPostalCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 10)
                  setOfficialPostalCode(val)
                }}
                onBlur={() => handleBlur('officialPostalCode')}
                disabled={submitting}
                placeholder={isRtl ? 'کد پستی ۱۰ رقمی' : '10-digit postal code'}
                aria-invalid={touched.officialPostalCode && !!errors.officialPostalCode}
                aria-describedby={errors.officialPostalCode ? 'officialPostalCode-error' : undefined}
              />
              {touched.officialPostalCode && errors.officialPostalCode && (
                <p id="officialPostalCode-error" className="text-sm text-destructive" role="alert">
                  {errors.officialPostalCode}
                </p>
              )}
            </div>
          </fieldset>

          {/* ── Section 4: Document Upload ─────────────────── */}
          <fieldset>
            <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
              {isRtl ? 'بارگذاری مدارک' : 'Document Upload'}
            </legend>
            <p className="mb-3 text-sm text-muted-foreground">
              {isRtl
                ? 'روزنامه رسمی یا مدارک ثبت شرکت (اختیاری)'
                : 'Official gazette or registration documents (optional)'}
            </p>

            <div className="flex items-center justify-center w-full">
              <label
                htmlFor="document-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-background hover:bg-muted/50 transition-colors"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <UploadIcon className="w-8 h-8 mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isRtl
                      ? 'برای آپلود کلیک کنید یا فایل را بکشید و رها کنید'
                      : 'Click or drag and drop to upload'}
                  </p>
                </div>
                <input
                  id="document-upload"
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={submitting}
                />
              </label>
            </div>

            {documents.length > 0 && (
              <ul className="mt-3 space-y-1">
                {documents.map((doc, idx) => (
                  <li
                    key={`${doc.name}-${idx}`}
                    className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{doc.name}</span>
                    <button
                      type="button"
                      onClick={() => removeDocument(idx)}
                      className="text-destructive hover:text-destructive/80 text-xs ml-2"
                      aria-label={
                        isRtl
                          ? `حذف ${doc.name}`
                          : `Remove ${doc.name}`
                      }
                    >
                      {isRtl ? 'حذف' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {/* ── Submit ──────────────────────────────────────── */}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {isRtl ? 'در حال ذخیره...' : 'Saving...'}
              </>
            ) : (
              isRtl ? 'ذخیره و ادامه' : 'Save & Continue'
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}