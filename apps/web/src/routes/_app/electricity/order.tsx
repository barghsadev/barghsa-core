import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { t } from '@barghsa/i18n';
import { MapPinIcon, PlusIcon, Loader2Icon, CheckIcon, HomeIcon, PackageIcon } from 'lucide-react';
import { Button, Card, CardContent } from '@barghsa/ui';
import { withCsrf } from '../../../lib/csrf.js';
import { useLocale } from '../../../hooks/useLocale.js';

export const Route = createFileRoute('/_app/electricity/order')({
  component: ElectricityOrderPage,
});

// ─── Types ────────────────────────────────────────────────────────────

interface Product {
  id: string;
  type: string;
  title: Record<string, string>;
  price: string | null;
  status: string;
}

interface Address {
  id: string;
  profileId: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Province {
  id: string;
  nameFa: string;
  nameEn: string;
}

interface City {
  id: string;
  provinceId: string;
  nameFa: string;
  nameEn: string;
}

// ─── Page Component ────────────────────────────────────────────────────

function ElectricityOrderPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);

  // Profile & verification
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const verificationGeneration = useRef(0);
  const [verificationError, setVerificationError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState(false);
  const productGeneration = useRef(0);

  // Addresses
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addressError, setAddressError] = useState(false);
  const addressGeneration = useRef(0);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [provinceError, setProvinceError] = useState(false);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const provinceGeneration = useRef(0);
  const [cityError, setCityError] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const cityGeneration = useRef(0);
  /** City name lookup map: cityId -> { nameFa, nameEn } */
  const [cityMap, setCityMap] = useState<Record<string, { nameFa: string; nameEn: string }>>({});

  // New address form
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [formProvinceId, setFormProvinceId] = useState('');
  const [formCityId, setFormCityId] = useState('');
  const [formFullAddress, setFormFullAddress] = useState('');
  const [formPostalCode, setFormPostalCode] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const addressSaveInFlight = useRef(false);

  // Order submission
  const [submitting, setSubmitting] = useState(false);
  const orderSaveInFlight = useRef(false);
  const [orderCreated, setOrderCreated] = useState(false);

  // ── Fetch verification status ───────────────────────────────────────

  const checkVerification = useCallback(async () => {
    const current = ++verificationGeneration.current;
    setChecking(true);
    setBlocked(null);
    setActiveProfileId(null);
    setVerificationError(false);
    try {
      const response = await fetch('/api/profiles/verification-status', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Verification unavailable');
      const data = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        !(
          data.activeProfileId === null ||
          (typeof data.activeProfileId === 'string' && data.activeProfileId.length > 0)
        ) ||
        typeof data.verificationRequired !== 'boolean' ||
        typeof data.isVerified !== 'boolean'
      ) {
        throw new Error('Invalid verification status');
      }
      if (current !== verificationGeneration.current) return;
      setActiveProfileId(data.activeProfileId);
      setBlocked(data.verificationRequired && !data.isVerified);
    } catch {
      if (current === verificationGeneration.current) setVerificationError(true);
    } finally {
      if (current === verificationGeneration.current) setChecking(false);
    }
  }, []);

  // ── Fetch products ──────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    const current = ++productGeneration.current;
    setLoadingProducts(true);
    setProductError(false);
    setProducts([]);
    setSelectedProductId('');
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('Products unavailable');
      const data: unknown = await res.json();
      if (
        !Array.isArray(data) ||
        data.some(
          (product) =>
            !product ||
            typeof product !== 'object' ||
            typeof product.id !== 'string' ||
            typeof product.type !== 'string' ||
            typeof product.status !== 'string' ||
            !product.title ||
            typeof product.title !== 'object' ||
            Array.isArray(product.title) ||
            Object.values(product.title).some((title) => typeof title !== 'string') ||
            !(
              product.price === null ||
              (typeof product.price === 'string' && /^\d+$/.test(product.price))
            )
        )
      )
        throw new Error('Invalid products');
      if (current !== productGeneration.current) return;
      const items: Product[] = data.filter(
        (product) => product.type === 'electricity' && product.status === 'active'
      );
      setProducts(items);
      setSelectedProductId(items[0]?.id ?? '');
    } catch {
      if (current === productGeneration.current) setProductError(true);
    } finally {
      if (current === productGeneration.current) setLoadingProducts(false);
    }
  }, []);

  // ── Fetch addresses ─────────────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    const current = ++addressGeneration.current;
    setLoadingAddresses(true);
    setAddressError(false);
    setAddresses([]);
    setSelectedAddressId('');
    if (!activeProfileId) {
      setLoadingAddresses(false);
      return;
    }
    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Addresses unavailable');
      const data = await res.json();
      if (
        !Array.isArray(data?.addresses) ||
        data.addresses.some(
          (address: unknown) =>
            !address ||
            typeof address !== 'object' ||
            ['id', 'provinceId', 'cityId', 'fullAddress', 'postalCode'].some(
              (key) => typeof (address as Record<string, unknown>)[key] !== 'string'
            )
        )
      )
        throw new Error('Invalid addresses');
      if (current !== addressGeneration.current) return;
      const items: Address[] = data.addresses;
      setAddresses(items);
      setSelectedAddressId((items.find((address) => address.mainAddress) ?? items[0])?.id ?? '');
    } catch {
      if (current === addressGeneration.current) setAddressError(true);
    } finally {
      if (current === addressGeneration.current) setLoadingAddresses(false);
    }
  }, [activeProfileId]);

  // ── Fetch provinces ─────────────────────────────────────────────────

  const fetchProvinces = useCallback(async () => {
    const current = ++provinceGeneration.current;
    setLoadingProvinces(true);
    setProvinceError(false);
    setProvinces([]);
    try {
      const res = await fetch('/api/geography/provinces');
      if (!res.ok) throw new Error('Provinces unavailable');
      const data: unknown = await res.json();
      if (
        !Array.isArray(data) ||
        data.some(
          (place) =>
            !place || ['id', 'nameFa', 'nameEn'].some((key) => typeof place[key] !== 'string')
        )
      )
        throw new Error('Invalid provinces');
      if (current === provinceGeneration.current) setProvinces(data);
    } catch {
      if (current === provinceGeneration.current) setProvinceError(true);
    } finally {
      if (current === provinceGeneration.current) setLoadingProvinces(false);
    }
  }, []);

  // ── Fetch cities for a province ─────────────────────────────────────

  const fetchCities = useCallback(async (provinceId: string, updateForm = true) => {
    const current = updateForm ? ++cityGeneration.current : null;
    if (updateForm) {
      setCities([]);
      setFormCityId('');
      setCityError(false);
      setLoadingCities(true);
    }
    try {
      const res = await fetch(`/api/geography/provinces/${provinceId}/cities`);
      if (!res.ok) throw new Error('Cities unavailable');
      const data: unknown = await res.json();
      if (
        !Array.isArray(data) ||
        data.some(
          (place) =>
            !place ||
            place.provinceId !== provinceId ||
            ['id', 'nameFa', 'nameEn'].some((key) => typeof place[key] !== 'string')
        )
      )
        throw new Error('Invalid cities');
      if (current !== null && current === cityGeneration.current) setCities(data);
      setCityMap((prev) => {
        const next = { ...prev };
        for (const city of data) next[city.id] = { nameFa: city.nameFa, nameEn: city.nameEn };
        return next;
      });
    } catch {
      if (current !== null && current === cityGeneration.current) setCityError(true);
    } finally {
      if (current !== null && current === cityGeneration.current) setLoadingCities(false);
    }
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────

  useEffect(() => {
    checkVerification();
    fetchProducts();
    fetchProvinces();
    return () => {
      ++verificationGeneration.current;
      ++productGeneration.current;
      ++provinceGeneration.current;
    };
  }, [checkVerification, fetchProducts, fetchProvinces]);

  useEffect(() => {
    void fetchAddresses();
    return () => {
      ++addressGeneration.current;
    };
  }, [fetchAddresses]);

  useEffect(() => {
    if (formProvinceId) {
      fetchCities(formProvinceId);
    } else {
      ++cityGeneration.current;
      setCityError(false);
      setLoadingCities(false);
      setCities([]);
      setFormCityId('');
    }
    return () => {
      ++cityGeneration.current;
    };
  }, [formProvinceId, fetchCities]);

  // Fetch cities for each unique province referenced by existing addresses
  useEffect(() => {
    const uniqueProvinceIds = [...new Set(addresses.map((a) => a.provinceId))];
    for (const pid of uniqueProvinceIds) {
      fetchCities(pid, false);
    }
  }, [addresses, fetchCities]);

  // ── Helpers ─────────────────────────────────────────────────────────

  const getProvinceName = (provinceId: string): string => {
    const province = provinces.find((p) => p.id === provinceId);
    if (!province) return provinceId;
    return locale === 'fa' ? province.nameFa : province.nameEn;
  };

  const getCityName = (cityId: string): string => {
    // First try the current form cities list
    const city = cities.find((c) => c.id === cityId);
    if (city) return locale === 'fa' ? city.nameFa : city.nameEn;
    // Fall back to the accumulated city map
    const mapped = cityMap[cityId];
    if (mapped) return locale === 'fa' ? mapped.nameFa : mapped.nameEn;
    return cityId;
  };

  const productTitle = (product?: Product) =>
    product ? product.title[locale] || product.title.en || product.title.fa || product.id : '';

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);

  // ── Save new address ─────────────────────────────────────────────────

  const handleSaveNewAddress = useCallback(async () => {
    if (addressSaveInFlight.current) return;
    if (checking || blocked !== false || verificationError || loadingAddresses || addressError)
      return;
    if (
      loadingProvinces ||
      provinceError ||
      loadingCities ||
      cityError ||
      !provinces.some((province) => province.id === formProvinceId) ||
      !cities.some((city) => city.id === formCityId && city.provinceId === formProvinceId)
    )
      return;
    if (!formProvinceId || !formCityId || !formFullAddress.trim() || !formPostalCode.trim()) {
      toast.error(t('settings.addresses.error.create', locale));
      return;
    }

    if (!activeProfileId) return;

    addressSaveInFlight.current = true;
    const generation = addressGeneration.current;
    const input = {
      provinceId: formProvinceId,
      cityId: formCityId,
      fullAddress: formFullAddress.trim(),
      postalCode: formPostalCode.trim(),
    };
    setSavingAddress(true);
    try {
      const res = await fetch(`/api/profiles/${activeProfileId}/addresses`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        toast.error(t('settings.addresses.error.create', locale));
        return;
      }

      const newAddress: Address = await res.json();
      if (
        !newAddress ||
        typeof newAddress.id !== 'string' ||
        !newAddress.id.trim() ||
        newAddress.profileId !== activeProfileId ||
        typeof newAddress.mainAddress !== 'boolean' ||
        (Object.keys(input) as Array<keyof typeof input>).some(
          (key) => newAddress[key] !== input[key]
        )
      )
        throw new Error('Invalid saved address');
      if (generation !== addressGeneration.current) return;
      toast.success(t('settings.addresses.success.create', locale));

      // Add to list and select it
      setAddresses((prev) => [...prev, newAddress]);
      setSelectedAddressId(newAddress.id);
      setShowNewAddressForm(false);

      // Reset form
      setFormProvinceId('');
      setFormCityId('');
      setFormFullAddress('');
      setFormPostalCode('');
    } catch {
      toast.error(t('settings.addresses.error.create', locale));
    } finally {
      addressSaveInFlight.current = false;
      setSavingAddress(false);
    }
  }, [
    formProvinceId,
    loadingProvinces,
    provinceError,
    loadingCities,
    cityError,
    provinces,
    cities,
    formCityId,
    formFullAddress,
    formPostalCode,
    activeProfileId,
    locale,
    checking,
    blocked,
    verificationError,
    loadingAddresses,
    addressError,
  ]);

  // ── Submit order ────────────────────────────────────────────────────

  const handleSubmitOrder = useCallback(async () => {
    if (orderSaveInFlight.current || addressSaveInFlight.current || showNewAddressForm) return;
    if (
      loadingProducts ||
      productError ||
      !products.some((product) => product.id === selectedProductId)
    )
      return;
    if (checking || blocked !== false || verificationError || loadingAddresses || addressError)
      return;
    if (!selectedProductId) {
      toast.error(t('electricity.order.error.noProduct', locale));
      return;
    }
    if (!selectedAddressId || !selectedAddress) {
      toast.error(t('electricity.order.error.noAddress', locale));
      return;
    }
    if (!activeProfileId) {
      toast.error(t('electricity.order.error.noProfile', locale));
      return;
    }

    orderSaveInFlight.current = true;
    setSubmitting(true);
    const generation = verificationGeneration.current;
    const input = {
      profileId: activeProfileId,
      productId: selectedProductId,
      orderType: 'electricity',
      address: {
        provinceId: selectedAddress.provinceId,
        cityId: selectedAddress.cityId,
        fullAddress: selectedAddress.fullAddress,
        postalCode: selectedAddress.postalCode,
      },
    };
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const message = (errBody as { message?: string }).message;
        toast.error(message || t('electricity.order.error.create', locale));
        return;
      }

      const result: unknown = await res.json();
      if (generation !== verificationGeneration.current) return;
      if (
        !result ||
        typeof result !== 'object' ||
        !('id' in result) ||
        typeof result.id !== 'string' ||
        !result.id.trim() ||
        !('profileId' in result) ||
        result.profileId !== input.profileId ||
        !('productId' in result) ||
        result.productId !== input.productId ||
        !('orderType' in result) ||
        result.orderType !== input.orderType ||
        !('status' in result) ||
        result.status !== 'DRAFT' ||
        !('snapshotProvinceId' in result) ||
        result.snapshotProvinceId !== input.address.provinceId ||
        !('snapshotCityId' in result) ||
        result.snapshotCityId !== input.address.cityId ||
        !('snapshotFullAddress' in result) ||
        result.snapshotFullAddress !== input.address.fullAddress ||
        !('snapshotPostalCode' in result) ||
        result.snapshotPostalCode !== input.address.postalCode
      )
        throw new Error('Invalid saved order');
      setOrderCreated(true);
      toast.success(t('electricity.order.success.create', locale));
    } catch {
      toast.error(t('electricity.order.error.create', locale));
    } finally {
      orderSaveInFlight.current = false;
      setSubmitting(false);
    }
  }, [
    selectedProductId,
    showNewAddressForm,
    products,
    loadingProducts,
    productError,
    selectedAddressId,
    selectedAddress,
    activeProfileId,
    locale,
    checking,
    blocked,
    verificationError,
    loadingAddresses,
    addressError,
  ]);

  // ── Render: Loading ─────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p role="status" className="text-muted-foreground">
          {t('electricity.order.checking', locale)}
        </p>
      </div>
    );
  }

  if (verificationError || (blocked === false && !activeProfileId)) {
    return (
      <div
        className="container mx-auto max-w-md space-y-4 p-6"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <p role="alert">
          {t(
            verificationError
              ? 'electricity.order.checkFailed'
              : 'electricity.order.error.noProfile',
            locale
          )}
        </p>
        <Button onClick={() => void checkVerification()}>
          {t('electricity.order.retry', locale)}
        </Button>
      </div>
    );
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
    );
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
          <h1 className="mb-4 text-2xl font-bold">
            {t('electricity.order.success.title', locale)}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {t('electricity.order.success.description', locale)}
          </p>
        </div>
      </div>
    );
  }

  // ── Render: Main order form ─────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="mb-2 text-2xl font-bold">{t('electricity.order.title', locale)}</h1>
      <p className="mb-6 text-muted-foreground">{t('electricity.order.description', locale)}</p>

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
          ) : productError ? (
            <div className="space-y-3" role="alert">
              <p>{t('electricity.order.productLoadFailed', locale)}</p>
              <Button onClick={() => void fetchProducts()}>
                {t('electricity.order.retry', locale)}
              </Button>
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
                    disabled={submitting}
                    onChange={() => setSelectedProductId(product.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{productTitle(product)}</p>
                    {product.price && (
                      <p className="text-xs text-muted-foreground">
                        {numbers.money(product.price)}
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
          ) : addressError ? (
            <div className="space-y-3" role="alert">
              <p>{t('electricity.order.addressLoadFailed', locale)}</p>
              <Button onClick={() => void fetchAddresses()}>
                {t('electricity.order.retry', locale)}
              </Button>
            </div>
          ) : addresses.length === 0 && !showNewAddressForm ? (
            <div className="text-center py-4">
              <MapPinIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-4">
                {t('electricity.order.noAddresses', locale)}
              </p>
              <Button
                disabled={submitting}
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
                      htmlFor={`order-address-${address.id}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        selectedAddressId === address.id
                          ? 'border-primary bg-primary/5'
                          : 'border-input hover:bg-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        id={`order-address-${address.id}`}
                        name="address"
                        value={address.id}
                        checked={selectedAddressId === address.id}
                        disabled={submitting}
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
                    disabled={submitting}
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

                  {provinceError && (
                    <div role="alert" className="space-y-2">
                      <p>{t('electricity.order.provinceLoadFailed', locale)}</p>
                      <Button onClick={() => void fetchProvinces()}>
                        {t('electricity.order.retry', locale)}
                      </Button>
                    </div>
                  )}
                  {cityError && (
                    <div role="alert" className="space-y-2">
                      <p>{t('electricity.order.cityLoadFailed', locale)}</p>
                      <Button onClick={() => void fetchCities(formProvinceId)}>
                        {t('electricity.order.retry', locale)}
                      </Button>
                    </div>
                  )}
                  {/* Province */}
                  <div>
                    <label
                      htmlFor="order-address-province"
                      className="block text-sm font-medium mb-1"
                    >
                      {t('settings.addresses.form.province', locale)}
                    </label>
                    <select
                      id="order-address-province"
                      disabled={loadingProvinces || provinceError || savingAddress}
                      value={formProvinceId}
                      onChange={(e) => {
                        setFormProvinceId(e.target.value);
                        setFormCityId('');
                        setCities([]);
                      }}
                      className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      dir={locale === 'fa' ? 'rtl' : 'ltr'}
                    >
                      <option value="">
                        {t('settings.addresses.form.provincePlaceholder', locale)}
                      </option>
                      {provinces.map((p) => (
                        <option key={p.id} value={p.id}>
                          {locale === 'fa' ? p.nameFa : p.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* City */}
                  <div>
                    <label htmlFor="order-address-city" className="block text-sm font-medium mb-1">
                      {t('settings.addresses.form.city', locale)}
                    </label>
                    <select
                      id="order-address-city"
                      value={formCityId}
                      onChange={(e) => setFormCityId(e.target.value)}
                      disabled={!formProvinceId || loadingCities || cityError || savingAddress}
                      className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      dir={locale === 'fa' ? 'rtl' : 'ltr'}
                    >
                      <option value="">
                        {t('settings.addresses.form.cityPlaceholder', locale)}
                      </option>
                      {cities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {locale === 'fa' ? c.nameFa : c.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Full Address */}
                  <div>
                    <label
                      htmlFor="order-address-fullAddress"
                      className="block text-sm font-medium mb-1"
                    >
                      {t('settings.addresses.form.fullAddress', locale)}
                    </label>
                    <textarea
                      id="order-address-fullAddress"
                      disabled={savingAddress}
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
                    <label
                      htmlFor="order-address-postalCode"
                      className="block text-sm font-medium mb-1"
                    >
                      {t('settings.addresses.form.postalCode', locale)}
                    </label>
                    <input
                      type="text"
                      id="order-address-postalCode"
                      disabled={savingAddress}
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
                      disabled={savingAddress}
                      onClick={() => {
                        setShowNewAddressForm(false);
                        setFormProvinceId('');
                        setFormCityId('');
                        setFormFullAddress('');
                        setFormPostalCode('');
                      }}
                    >
                      {t('electricity.order.cancel', locale)}
                    </Button>
                    <Button
                      onClick={handleSaveNewAddress}
                      disabled={
                        savingAddress ||
                        loadingProvinces ||
                        provinceError ||
                        loadingCities ||
                        cityError
                      }
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
          <h2 className="mb-4 text-lg font-semibold">{t('electricity.order.review', locale)}</h2>

          <div className="space-y-3 text-sm">
            {/* Selected product */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t('electricity.order.product', locale)}:
              </span>
              <span className="font-medium">
                {productTitle(products.find((p) => p.id === selectedProductId)) || '—'}
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
        disabled={
          submitting ||
          savingAddress ||
          showNewAddressForm ||
          loadingAddresses ||
          addressError ||
          !selectedProductId ||
          !selectedAddressId
        }
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
  );
}
