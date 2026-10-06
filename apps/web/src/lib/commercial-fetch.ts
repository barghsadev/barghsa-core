/** Preserve the response body and signal only an explicit same-origin terms denial. */
export async function commercialFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  if (response.status !== 403 || typeof window === 'undefined') return response;
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return response;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'code' in body.error &&
    body.error.code === 'AUTHZ:TOS_ACCEPTANCE_REQUIRED'
  ) {
    window.dispatchEvent(new Event('barghsa:tos-required'));
  }
  return response;
}
