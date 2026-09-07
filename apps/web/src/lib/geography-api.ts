import { withCsrf } from './csrf.js';

export interface Province {
  id: string;
  nameFa: string;
  nameEn: string;
  status: 'active' | 'inactive';
}
export class GeographyRequestError extends Error {
  constructor(readonly code: 'requestFailed' | 'conflict' = 'requestFailed') {
    super(code);
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function isProvince(value: unknown): value is Province {
  const row = record(value);
  return (
    !!row &&
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.nameFa === 'string' &&
    typeof row.nameEn === 'string' &&
    (row.status === 'active' || row.status === 'inactive')
  );
}
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/admin/geography/provinces${path}`, init);
  if (!response.ok)
    throw new GeographyRequestError(response.status === 409 ? 'conflict' : 'requestFailed');
  try {
    return await response.json();
  } catch {
    throw new GeographyRequestError();
  }
}
export async function listProvinces(
  params: { search: string; status: string; page: number },
  signal: AbortSignal
) {
  const query = new URLSearchParams({ page: String(params.page), limit: '20' });
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  const result = record(await request(`?${query}`, { signal }));
  if (
    !result ||
    !Array.isArray(result.provinces) ||
    !result.provinces.every(isProvince) ||
    typeof result.total !== 'number' ||
    !Number.isSafeInteger(result.total) ||
    result.total < 0
  )
    throw new GeographyRequestError();
  return { provinces: result.provinces as Province[], total: result.total };
}
export async function saveProvince(
  province: Province | null,
  data: { nameFa: string; nameEn: string; status: 'active' | 'inactive' }
) {
  const body = province ? data : { nameFa: data.nameFa, nameEn: data.nameEn };
  const result = await request(province ? `/${encodeURIComponent(province.id)}` : '', {
    method: province ? 'PATCH' : 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!isProvince(result) || (province && result.id !== province.id))
    throw new GeographyRequestError();
  return result;
}
export async function deactivateProvince(id: string) {
  const result = record(
    await request(`/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: withCsrf(),
    })
  );
  if (result?.success !== true) throw new GeographyRequestError();
}
