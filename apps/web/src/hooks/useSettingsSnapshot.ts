import { useCallback, useEffect, useRef, useState } from 'react';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';

/** Keep local settings drafts until a verified receipt or an explicit saved-state reset. */
export function useSettingsSnapshot<View>(
  path: string,
  validate: (value: unknown) => value is View,
  basis: (value: View) => string,
  reset: (value: View | null) => void,
  withdraw: () => void
) {
  const accepted = useRef<View | null>(null);
  const [changed, setChanged] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const recoveryLoading = useRef(false);
  const clear = useCallback(() => {
    withdraw();
    accepted.current = null;
    reset(null);
    setChanged(false);
    setUncertain(false);
    setRecovered(false);
    recoveryLoading.current = false;
  }, [reset, withdraw]);
  const scope = useCatalogueScope(clear);
  const resource = useCatalogueResource(scope, path, validate);
  const { data, loading, error } = resource;
  const ready =
    !scope.denied &&
    !loading &&
    !error &&
    data !== null &&
    accepted.current !== null &&
    basis(data) === basis(accepted.current);
  useEffect(() => {
    if (uncertain && loading) recoveryLoading.current = true;
    if (!data || loading || error) return;
    if (!accepted.current) reset(data);
    else if (basis(accepted.current) !== basis(data)) {
      withdraw();
      setChanged(true);
    }
    accepted.current = data;
    if (uncertain && recoveryLoading.current) setRecovered(true);
  }, [data, loading, error, uncertain, basis, reset, withdraw]);
  function resetSaved() {
    if (!ready || !data || (uncertain && !recovered)) return;
    withdraw();
    reset(data);
    setChanged(false);
    setUncertain(false);
    setRecovered(false);
  }
  function unconfirmed() {
    setUncertain(true);
    setRecovered(false);
    recoveryLoading.current = false;
    resource.retry();
  }
  function accept(value: View) {
    if (!resource.accept(value)) return false;
    accepted.current = value;
    reset(value);
    setChanged(false);
    setUncertain(false);
    setRecovered(false);
    return true;
  }
  function refresh() {
    if (scope.denied) scope.recover();
    else resource.retry();
  }
  return {
    scope,
    resource,
    current: data,
    hydrated: accepted.current !== null,
    ready,
    changed,
    uncertain,
    recovered,
    resetSaved,
    unconfirmed,
    accept,
    refresh,
  };
}
