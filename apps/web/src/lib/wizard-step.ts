/** Only the step is public; draft fields remain in the server draft. */
export function wizardStepSearch(
  search: Record<string, unknown>,
  stepCount: number
): { step?: number } {
  const value = search.step;
  const step =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : 0;
  return { step: Number.isSafeInteger(step) && step > 0 && step <= stepCount ? step : 1 };
}
