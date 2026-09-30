import { createContext, useContext, useId, useLayoutEffect } from 'react';

/** Validate every pending field before committing any of the drawer's edits. */
export type PrepareFilter = () => (() => void) | null;
export const FilterApplyContext = createContext<
  ((id: string, prepare: PrepareFilter) => () => void) | null
>(null);

export function useFilterApply(prepare: PrepareFilter): boolean {
  const register = useContext(FilterApplyContext);
  const id = useId();
  useLayoutEffect(() => register?.(id, prepare), [id, register, prepare]);
  return register !== null;
}
