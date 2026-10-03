/** Metadata is untrusted. Owning forms still whitelist names and supply their own copy. */
export function inputErrorFields(payload: unknown, status: number): { fields?: unknown[] } {
  if (status !== 400 || !payload || typeof payload !== 'object' || !('error' in payload)) return {};
  const error = payload.error;
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    error.code !== 'VALIDATION:INPUT:INVALID' ||
    !('fields' in error) ||
    !Array.isArray(error.fields)
  )
    return {};
  return { fields: error.fields };
}
