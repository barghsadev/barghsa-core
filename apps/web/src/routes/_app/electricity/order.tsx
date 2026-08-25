import { useState, useEffect, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import {
  MapPinIcon,
  PlusIcon,
  Loader2Icon,
  CheckIcon,
  HomeIcon,
  PackageIcon,
} from 'lucide-react'
import { Button, Card, CardContent } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'
import { useLocale } from '../../../hooks/useLocale.js'

export const Route = createFileRoute('/_app/electricity/order')({
  component: ElectricityOrderPage,
})

// ─── Types ────────────────────────────────────────────────────────────

interface Product {
  id: string
  productType: string
  systemType: string | null
  titleFa: string
  price: string | null
  isActive: boolean
  minKwh: string
  maxKwh: string
}

interface Address {
  id: string
  profileId: string
  provinceId: string
  cityId: string
  fullAddress: string
  postalCode: string
  mainAddress: boolean
  createdAt: string
  updatedAt: string
}

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

// ─── Page Component ────────────────────────────────────────────────────

function ElectricityOrderPage() {
  const locale = useLocale()

  // Profile & verification
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState(false)
  const [checking, setChecking] = useState(true)
  const [blocked, setBlocked] = useState<boolean | null>(null)

  // Products
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [loadingProducts, setLoadingProducts] = useState(true)

  // Addresses
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string>('')
  const [loadingAddresses, setLoadingAddresses] = useState(true)
  const [provinces, setProvinces] = useState<Province[]>([])
  const [cities, setCities] = useState<City[]>([])

  // New address form
  const [showNewAddressForm, setShowNewAddressForm] = useState(false)
  const [formProvinceId, setFormProvinceId] = useState('')
  const [formCityId, setFormCityId] = useState('')
  const [formFullAddress, setFormFullAddress] = useState('')
  const [formPostalCode, setFormPostalCode] = useState('')
  const [savingAddress, setSavingAddress] = useState(false)

  // Order submission
  const [submitting, setSubmitting] = useState(false)
  const [orderCreated, setOrderCreated] = useState(false)

  // ── Fetch verification status ───────────────────────────────────────

  const checkVerification = useCallback(async () => {
    try {
      const response = await fetch('/api/profiles/verification-status', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })

      if (response.status === 401) {
        setBlocked(false)
        return
      }

      if (!response.ok) {
        setBlocked(false)
        return
      }

      const data = await response.json()
      setActiveProfileId(data.activeProfileId)

      if (data.verificationRequired && !data.isVerified) {
        setBlocked(true)
      } else {
        setBlocked(false)
        setIsVerified(data.isVerified)
      }
    } catch {
      setBlocked(false)
    } finally {
      setChecking(false)
    }
  }, [])

  // ── Fetch products ──────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/products')
      if (res.ok) {
        const data: Product[] = await res.json()
        setProducts(data)
        if (data.length > 0) {
          setSelectedProductId(data[0].id)
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  // ── Fetch addresses ─────────────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    if (!activeProfileId) {
      setLoadingAddresses(false)
      return
    }

    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`)
      if (res.ok) {
        const data: { addresses: Address[] } = await res.json()
        setAddresses(data.addresses)

        // Auto-select main address or first address
        const main = data.addresses.find((a) => a.mainAddress)
        if (main) {
          setSelectedAddressId(main.id)
        } else if (data.addresses.length > 0) {
          setSelectedAddressId(data.addresses[0].id)
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingAddresses(false)
    }
  }, [activeProfileId])

  // ── Fetch provinces ─────────────────────────────────────────────────

  const fetchProvinces = useCallback(async () => {
    try {
      const res = await fetch('/api/geography/provinces')
      if (res.ok) {
        const data: Province[] = await res.json()
        setProvinces(data)
      }
    } catch {
      // Silently fail
    }
  }, [])

  // ── Fetch cities for a province ─────────────────────────────────────

  const fetchCities = useCallback(async (provinceId: string) => {
    try {
      const res = await fetch(`/api/geography/provinces/${provinceId}/cities`)
      if (res.ok) {
        const data: City[] = await res.json()
        setCities(data)
      }
    } catch {
      // Silently fail
    }
  }, [])

  // ── Effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    checkVerification()
    fetchProducts()
    fetchProvinces()
  }, [checkVerification, fetchProducts, fetchProvinces])

  useEffect(() => {
    if (activeProfileId) {
      fetchAddresses()
    }
  }, [activeProfileId, fetchAddresses])

  useEffect(() => {
    if (formProvinceId) {
      fetchCities(formProvinceId)
    } else {
      setCities([])
      setFormCityId('')
    }
  }, [formProvinceId, fetchCities])

  // ── Helpers ─────────────────────────────────────────────────────────

  const getProvinceName = (provinceId: string): string => {
    const province = provinces.find((p) => p.id === provinceId)
    if (!province) return provinceId
    return locale === 'fa' ? province.nameFa : province.nameEn
  }

  const getCityName = (cityId: string): string => {
    const city = cities.find((c) => c.id === cityId)
    if (!city) return cityId
    return locale === 'fa' ? city.nameFa : city.nameEn
  }

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId)

  // ── Save new address ─────────────────────────────────────────────────

  const handleSaveNewAddress = useCallback(async () => {
    if (!formProvinceId || !formCityId || !formFullAddress.trim() || !formPostalCode.trim()) {
      toast.error(t('settings.addresses.error.create', locale))
      return
    }

    if (!activeProfileId) return

    setSavingAddress(true)
    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          provinceId: formProvinceId,
          cityId: formCityId,
          fullAddress: formFullAddress.trim(),
          postalCode: formPostalCode.trim(),
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const message = (errBody as { message?: string }).message
        toast.error(message || t('settings.addresses.error.create', locale))
        return
      }

      const newAddress: Address = await res.json()
      toast.success(t('settings.addresses.success.create', locale))

      // Add to list and select it
      setAddresses((prev) => [...prev, newAddress])
      setSelectedAddressId(newAddress.id)
      setShowNewAddressForm(false)

      // Reset form
      setFormProvinceId('')
      setFormCityId('')
      setFormFullAddress('')
      setFormPostalCode('')
    } catch {
      toast.error(t('settings.addresses.error.create', locale))
    } finally {
      setSavingAddress(false)
    }
  }, [formProvinceId, formCityId, formFullAddress, formPostalCode, activeProfileId, locale])

  // ── Submit order ────────────────────────────────────────────────────

  const handleSubmitOrder = useCallback(async () => {
    if (!selectedProductId) {
      toast.error('Please select a product', locale)
      return
    }
    if (!selectedAddressId || !selectedAddress) {
      toast.error('Please select an address', locale)
      return
    }
    if (!activeProfileId) {
      toast.error('No active profile', locale)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          profileId: activeProfileId,
          productId: selectedProductId,
          orderType: 'electricity',
          address: {
            provinceId: selectedAddress.provinceId,
            cityId: selectedAddress.cityId,
            fullAddress: selectedAddress.fullAddress,
            postalCode: selectedAddress.postalCode,
          },
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const message = (errBody as { message?: string }).message
        toast.error(message || 'Failed to create order')
        return
      }

      setOrderCreated(true)
      toast.success('Order created successfully!')
    } catch {
      toast.error('Failed to create order')
    } finally {
      setSubmitting(false)
    }
  }, [selectedProductId, selectedAddressId, selectedAddress, activeProfileId, locale])

  // ── Render: Loading ─────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  // ── Render: Blocked (unverified profile) ────────────────────────────

  if (blocked) {
    return (
      <div
        className="container mx-auto flex min-h-[50vh] items-center justify-center p-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="max-w-md text-center">
          <div className="mb-4 text-4xl">⚠️</div>
          <h1 className="mb-4 text-2xl font-bold">
            {t('verification.order.blocked.title', locale)}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {t('verification.order.blocked.description', locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('verification.order.blocked.support', locale)}
          </p>
        </div>
      </div>
    )
  }

  // ── Render: Order created success ───────────────────────────────────

  if (orderCreated) {
    return (
      <div
        className="container mx-auto flex min-h-[50vh] items-center justify-center p-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="max-w-md text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
            <CheckIcon className="h-8 w-8" />
          </div>
          <h1 className="mb-4 text-2xl font-bold">Order Submitted</h1>
          <p className="mb-6 text-muted-foreground">
            Your electricity order has been successfully created. You can track
            its status from your orders page.
          </p>
        </div>
      </div>
    )
  }

  // ── Render: Main order form ─────────────────────────────────────────

  return (
    <div
      className="container mx-auto max-w-2xl py-8 px-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="mb-2 text-2xl font-bold">
        {t('electricity.order.title', locale)}
      </h1>
      <p className="mb-6 text-muted-foreground">
        {t('electricity.order.description', locale)}
      </p>

      {/* Step 1: Select Product */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <PackageIcon className="h-5 w-5" />
            {t('electricity.order.selectProduct', locale)}
          </h2>

          {loadingProducts ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              {t('electricity.order.loadingProducts', locale)}
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('electricity.order.noProducts', locale)}
            </p>
          ) : (
            <div className="space-y-2">
              {products.map((product) => (
                <label
                  key={product.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedProductId === product.id
                      ? 'border-primary bg-primary/5'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="product"
                    value={product.id}
                    checked={selectedProductId === product.id}
                    onChange={() => setSelectedProductId(product.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{product.titleFa}</p>
                    {product.price && (
                      <p className="text-xs text-muted-foreground">
                        {product.price} IRR
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Address */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
            <MapPinIcon className="h-5 w-5" />
            {t('electricity.order.selectAddress', locale)}
          </h2>

          {loadingAddresses ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              {t('electricity.order.loadingAddresses', locale)}
            </div>
          ) : addresses.length === 0 && !showNewAddressForm ? (
            <div className="text-center py-4">
              <MapPinIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-4">
                {t('electricity.order.noAddresses', locale)}
              </p>
              <Button
                onClick={() => setShowNewAddressForm(true)}
                className="gap-2"
              >
                <PlusIcon className="h-4 w-4" />
                {t('electricity.order.addAddress', locale)}
              </Button>
            </div>
          ) : (
            <>
              {/* Existing addresses */}
              {addresses.length > 0 && !showNewAddressForm && (
                <div className="space-y-2 mb-4">
                  {addresses.map((address) => (
                    <label
                      key={address.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        selectedAddressId === address.id
                          ? 'border-primary bg-primary/5'
                          : 'border-input hover:bg-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        value={address.id}
                        checked={selectedAddressId === address.id}
                        onChange={() => setSelectedAddressId(address.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">
                            {getProvinceName(address.provinceId)}، {getCityName(address.cityId)}
                          </span>
                          {address.mainAddress && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                              <HomeIcon className="h-3 w-3" />
                              {t('electricity.order.mainAddress', locale)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {address.fullAddress}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('electricity.order.postalCode', locale)}: {address.postalCode}
                        </p>
                      </div>
                    </label>
                  ))}

                  <Button
                    variant="outline"
                    onClick={() => setShowNewAddressForm(true)}
                    className="w-full gap-2 mt-2"
                  >
                    <PlusIcon className="h-4 w-4" />
                    {t('electricity.order.addNewAddress', locale)}
                  </Button>
                </div>
              )}

              {/* New address form */}
              {showNewAddressForm && (
                <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
                  <h3 className="text-sm font-medium">
                    {t('electricity.order.newAddressTitle', locale)}
                  </h3>

                  {/* Province */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.addresses.form.province', locale)}
                    </label>
                    <select
                      value={formProvinceId}
                      onChange={(e) => setFormProvinceId(e.target.value)}
                      className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      dir={locale === 'fa' ? 'rtl' : 'ltr'}
                    >
                      <option value="">{t('settings.addresses.form.provincePlaceholder', locale)}</option>
                      {provinces.map((p) => (
                        <option key={p.id} value={p.id}>
                          {locale === 'fa' ? p.nameFa : p.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* City */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.addresses.form.city', locale)}
                    </label>
                    <select
                      value={formCityId}
                      onChange={(e) => setFormCityId(e.target.value)}
                      disabled={!formProvinceId}
                      className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      dir={locale === 'fa' ? 'rtl' : 'ltr'}
                    >
                      <option value="">{t('settings.addresses.form.cityPlaceholder', locale)}</option>
                      {cities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {locale === 'fa' ? c.nameFa : c.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Full Address */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.addresses.form.fullAddress', locale)}
                    </label>
                    <textarea
                      value={formFullAddress}
                      onChange={(e) => setFormFullAddress(e.target.value)}
                      placeholder={t('settings.addresses.form.fullAddressPlaceholder', locale)}
                      className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                      dir={locale === 'fa' ? 'rtl' : 'ltr'}
                      maxLength={500}
                    />
                  </div>

                  {/* Postal Code */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.addresses.form.postalCode', locale)}
                    </label>
                    <input
                      type="text"
                      value={formPostalCode}
                      onChange={(e) => setFormPostalCode(e.target.value)}
                      placeholder={t('settings.addresses.form.postalCodePlaceholder', locale)}
                      className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      dir={locale === 'fa' ? 'rtl' : 'ltr'}
                      maxLength={10}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowNewAddressForm(false)
                        setFormProvinceId('')
                        setFormCityId('')
                        setFormFullAddress('')
                        setFormPostalCode('')
                      }}
                    >
                      {t('electricity.order.cancel', locale)}
                    </Button>
                    <Button
                      onClick={handleSaveNewAddress}
                      disabled={savingAddress}
                      className="gap-2"
                    >
                      {savingAddress ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckIcon className="h-4 w-4" />
                      )}
                      {savingAddress
                        ? t('settings.addresses.form.saving', locale)
                        : t('electricity.order.saveAndUse', locale)}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Review & Submit */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold">
            {t('electricity.order.review', locale)}
          </h2>

          <div className="space-y-3 text-sm">
            {/* Selected product */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t('electricity.order.product', locale)}:
              </span>
              <span className="font-medium">
                {products.find((p) => p.id === selectedProductId)?.titleFa ?? '—'}
              </span>
            </div>

            {/* Selected address */}
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">
                {t('electricity.order.deliveryAddress', locale)}:
              </span>
              <span className="font-medium text-right max-w-[60%]">
                {selectedAddress
                  ? `${getProvinceName(selectedAddress.provinceId)}، ${getCityName(selectedAddress.cityId)} — ${selectedAddress.fullAddress}`
                  : '—'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submit button */}
      <Button
        onClick={handleSubmitOrder}
        disabled={submitting || !selectedProductId || !selectedAddressId}
        className="w-full gap-2"
        size="lg"
      >
        {submitting ? (
          <Loader2Icon className="h-5 w-5 animate-spin" />
        ) : (
          <CheckIcon className="h-5 w-5" />
        )}
        {submitting
          ? t('electricity.order.submitting', locale)
          : t('electricity.order.submit', locale)}
      </Button>
    </div>
  )
}