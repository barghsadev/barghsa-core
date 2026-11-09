import { useCallback, useEffect, useRef, useState } from 'react';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';

/** Keep local settings drafts until a verified receipt or an explicit saved-state reset. */
export function useSettingsSnapshot<View>(
  path: string,
  validate: (value: unknown) => value is View,
  basis: (value: View) => string,
  reset: (value: View | null) => void,
  withdraw: () => void,
  onReadDenied?: () => void
) {
  const accepted = useRef<View | null>(null);
  const [changed, setChanged] = useState(false);
  const [requiredRead, setRequiredRead] = useState<number | null>(null);
  const clear = useCallback(() => {
    withdraw();
    accepted.current = null;
    reset(null);
    setChanged(false);
    setRequiredRead(null);
  }, [reset, withdraw]);
  const scope = useCatalogueScope(clear);
  const { deny } = scope;
  const denyRead = useCallback(() => {
    deny();
    onReadDenied?.();
  }, [deny, onReadDenied]);
  const resource = useCatalogueResource({ ...scope, deny: denyRead }, path, validate);
  const denyCommand = useCallback(
    (status?: 401 | 403) => {
      if (status === 401) denyRead();
      else deny();
    },
    [deny, denyRead]
  );
  const { data, loading, error, readAttempt } = resource;
  const uncertain = requiredRead !== null;
  const recovered = requiredRead !== null && readAttempt !== null && readAttempt >= requiredRead;
  const ready =
    !scope.denied &&
    !loading &&
    !error &&
    data !== null &&
    accepted.current !== null &&
    basis(data) === basis(accepted.current);
  useEffect(() => {
    if (!data || loading || error) return;
    if (!accepted.current) reset(data);
    else if (basis(accepted.current) !== basis(data)) {
      withdraw();
      setChanged(true);
    }
    accepted.current = data;
  }, [data, loading, error, basis, reset, withdraw]);
  function resetSaved() {
    if (!ready || !data || (uncertain && !recovered)) return;
    withdraw();
    reset(data);
    setChanged(false);
    setRequiredRead(null);
  }
  function unconfirmed() {
    setRequiredRead(resource.retry());
  }
  function accept(value: View) {
    if (!resource.accept(value)) return false;
    accepted.current = value;
    reset(value);
    setChanged(false);
    setRequiredRead(null);
    return true;
  }
  function refresh() {
    if (scope.denied) scope.recover();
    else resource.retry();
  }
  return {
    scope,
    denyCommand,
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
