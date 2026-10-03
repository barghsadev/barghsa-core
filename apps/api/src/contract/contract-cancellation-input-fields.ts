/** Only editable fields are public. Protected/mixed errors retain the generic response. */
export function cancellationInputFields(
  issues: readonly { path: readonly PropertyKey[] }[],
  mode: 'request' | 'reject' | 'decision'
): string[] | null {
  const fields = issues.map(({ path }) => {
    if (path.length === 1 && path[0] === 'reason') return 'reason';
    if (mode === 'request' && path.length === 1 && path[0] === 'preferredDestination')
      return 'preferredDestination';
    if (
      mode === 'decision' &&
      path.length === 4 &&
      path[0] === 'refundDecision' &&
      path[1] === 'refunds' &&
      typeof path[2] === 'number' &&
      Number.isInteger(path[2]) &&
      path[2] >= 0 &&
      path[2] < 500 &&
      (path[3] === 'amount' || path[3] === 'destination')
    )
      return `refund${path[3] === 'amount' ? 'Amount' : 'Destination'}${path[2]}`;
    return null;
  });
  return fields.length && fields.every((field): field is string => field !== null)
    ? [...new Set(fields)]
    : null;
}
