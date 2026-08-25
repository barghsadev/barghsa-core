import { useState, useEffect, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import {
  MapPinIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  StarIcon,
  Loader2Icon,
  SaveIcon,
  XIcon,
  HomeIcon,
} from 'lucide-react'
import { Button, Card, CardContent } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'
import { useLocale } from '../../../hooks/useLocale.js'

export const Route = createFileRoute('/_app/settings/addresses')({
  component: SettingsAddressesPage,
})

// ─── Types ────────────────────────────────────────────────────────────

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

function SettingsAddressesPage() {
  const locale = useLocale()

  const [addresses, setAddresses] = useState<Address[]>([])
  const [provinces, setProvinces] = useState<Province[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAddress, setEditingAddress] = useState<Address | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state
  const [formProvinceId, setFormProvinceId] = useState('')
  const [formCityId, setFormCityId] = useState('')
  const [formFullAddress, setFormFullAddress] = useState('')
  const [formPostalCode, setFormPostalCode] = useState('')

  // ── Fetch addresses ────────────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    try {
      // First get the active profile
      const profileRes = await fetch('/api/profiles')
      if (!profileRes.ok) {
        throw new Error('Failed to load profiles')
      }
      const profileData: { activeProfileId: string | null } = await profileRes.json()
      if (!profileData.activeProfileId) {
        setLoading(false)
        return
      }

      const res = await fetch(`/api/profiles/${profileData.activeProfileId}/addresses`)
      if (res.ok) {
        const data: { addresses: Address[] } = await res.json()
        setAddresses(data.addresses)
      }
    } catch {
      toast.error(t('settings.addresses.error.load', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  // ── Fetch provinces ────────────────────────────────────────────────

  const fetchProvinces = useCallback(async () => {
    try {
      const res = await fetch('/api/geography/provinces')
      if (res.ok) {
        const data: Province[] = await res.json()
        setProvinces(data)
      }
    } catch {
      // Silently fail — provinces are cosmetic for the form
    }
  }, [])

  // ── Fetch cities for a province ────────────────────────────────────

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

  useEffect(() => {
    fetchAddresses()
    fetchProvinces()
  }, [fetchAddresses, fetchProvinces])

  useEffect(() => {
    if (formProvinceId) {
      fetchCities(formProvinceId)
    } else {
      setCities([])
      setFormCityId('')
    }
  }, [formProvinceId, fetchCities])

  // ── Open form for add ──────────────────────────────────────────────

  const openAddForm = () => {
    setEditingAddress(null)
    setFormProvinceId('')
    setFormCityId('')
    setFormFullAddress('')
    setFormPostalCode('')
    setShowForm(true)
  }

  // ── Open form for edit ─────────────────────────────────────────────

  const openEditForm = (address: Address) => {
    setEditingAddress(address)
    setFormProvinceId(address.provinceId)
    setFormCityId(address.cityId)
    setFormFullAddress(address.fullAddress)
    setFormPostalCode(address.postalCode)
    setShowForm(true)
    // Fetch cities for the province
    if (address.provinceId) {
      fetchCities(address.provinceId)
    }
  }

  // ── Close form ─────────────────────────────────────────────────────

  const closeForm = () => {
    setShowForm(false)
    setEditingAddress(null)
  }

  // ── Save handler (create or update) ────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!formProvinceId || !formCityId || !formFullAddress.trim() || !formPostalCode.trim()) {
      toast.error(t('settings.addresses.error.create', locale))
      return
    }

    setSaving(true)
    try {
      // Get the active profile
      const profileRes = await fetch('/api/profiles')
      if (!profileRes.ok) throw new Error()
      const profileData: { activeProfileId: string | null } = await profileRes.json()
      if (!profileData.activeProfileId) throw new Error()

      const profileId = profileData.activeProfileId
      const body = {
        provinceId: formProvinceId,
        cityId: formCityId,
        fullAddress: formFullAddress.trim(),
        postalCode: formPostalCode.trim(),
      }

      let res: Response
      if (editingAddress) {
        res = await fetch(`/api/profiles/${profileId}/addresses/${editingAddress.id}`, {
          method: 'PUT',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/profiles/${profileId}/addresses`, {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const message = (errBody as { message?: string }).message
        toast.error(message || t(editingAddress ? 'settings.addresses.error.update' : 'settings.addresses.error.create', locale))
        return
      }

      toast.success(t(editingAddress ? 'settings.addresses.success.update' : 'settings.addresses.success.create', locale))
      closeForm()
      fetchAddresses()
    } catch {
      toast.error(t(editingAddress ? 'settings.addresses.error.update' : 'settings.addresses.error.create', locale))
    } finally {
      setSaving(false)
    }
  }, [formProvinceId, formCityId, formFullAddress, formPostalCode, editingAddress, locale, fetchAddresses])

  // ── Set as main address ────────────────────────────────────────────

  const handleSetMain = useCallback(async (addressId: string) => {
    try {
      const profileRes = await fetch('/api/profiles')
      if (!profileRes.ok) throw new Error()
      const profileData: { activeProfileId: string | null } = await profileRes.json()
      if (!profileData.activeProfileId) throw new Error()

      const res = await fetch(`/api/profiles/${profileData.activeProfileId}/addresses/${addressId}/set-main`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
      })

      if (!res.ok) {
        toast.error(t('settings.addresses.error.setMain', locale))
        return
      }

      toast.success(t('settings.addresses.success.setMain', locale))
      fetchAddresses()
    } catch {
      toast.error(t('settings.addresses.error.setMain', locale))
    }
  }, [locale, fetchAddresses])

  // ── Delete address ─────────────────────────────────────────────────

  const handleDelete = useCallback(async (addressId: string) => {
    try {
      const profileRes = await fetch('/api/profiles')
      if (!profileRes.ok) throw new Error()
      const profileData: { activeProfileId: string | null } = await profileRes.json()
      if (!profileData.activeProfileId) throw new Error()

      const res = await fetch(`/api/profiles/${profileData.activeProfileId}/addresses/${addressId}`, {
        method: 'DELETE',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const message = (errBody as { message?: string }).message
        toast.error(message || t('settings.addresses.error.delete', locale))
        return
      }

      toast.success(t('settings.addresses.success.delete', locale))
      setDeleteConfirmId(null)
      fetchAddresses()
    } catch {
      toast.error(t('settings.addresses.error.delete', locale))
    }
  }, [locale, fetchAddresses])

  // ── Helpers ────────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings.addresses.title', locale)}</h1>
        <Button onClick={openAddForm} className="gap-2">
          <PlusIcon className="h-4 w-4" />
          {t('settings.addresses.add', locale)}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        {t('settings.addresses.description', locale)}
      </p>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
          <p className="text-sm">{t('settings.addresses.loading', locale)}</p>
        </div>
      )}

      {/* Address list */}
      {!loading && (
        <div className="space-y-3">
          {addresses.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center">
                <MapPinIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('settings.addresses.noAddresses', locale)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('settings.addresses.noAddressesHint', locale)}
                </p>
              </CardContent>
            </Card>
          )}

          {addresses.map((address) => (
            <Card key={address.id} className={address.mainAddress ? 'border-primary/50' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {address.mainAddress && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                          <StarIcon className="h-3 w-3" />
                          {t('settings.addresses.main', locale)}
                        </span>
                      )}
                      <span className="text-sm font-medium truncate">
                        {getProvinceName(address.provinceId)}، {getCityName(address.cityId)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{address.fullAddress}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.addresses.form.postalCode', locale)}: {address.postalCode}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-4" dir="ltr">
                    {!address.mainAddress && (
                      <button
                        type="button"
                        onClick={() => handleSetMain(address.id)}
                        className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                        title={t('settings.addresses.setMain', locale)}
                        aria-label={t('settings.addresses.setMain', locale)}
                      >
                        <StarIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditForm(address)}
                      className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                      title={t('settings.addresses.edit', locale)}
                      aria-label={t('settings.addresses.edit', locale)}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    {deleteConfirmId === address.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(address.id)}
                          className="rounded p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label="Confirm delete"
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          aria-label="Cancel delete"
                        >
                          <XIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(address.id)}
                        className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                        title={t('settings.addresses.delete', locale)}
                        aria-label={t('settings.addresses.delete', locale)}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeForm}>
          <div
            className="bg-background rounded-lg shadow-lg w-full max-w-md mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editingAddress ? t('settings.addresses.form.editTitle', locale) : t('settings.addresses.form.title', locale)}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editingAddress ? t('settings.addresses.form.editTitle', locale) : t('settings.addresses.form.title', locale)}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Province */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('settings.addresses.form.province', locale)}
                </label>
                <select
                  value={formProvinceId}
                  onChange={(e) => setFormProvinceId(e.target.value)}
                  className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeForm}>
                {t('settings.addresses.form.cancel', locale)}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <SaveIcon className="h-4 w-4" />
                )}
                {saving ? t('settings.addresses.form.saving', locale) : t('settings.addresses.form.save', locale)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}