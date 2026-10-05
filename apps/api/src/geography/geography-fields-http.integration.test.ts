import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { ErrorCodes } from '@barghsa/shared/errors';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let province: string;
interface ErrorResponse {
  error: { code: string; fields?: string[] };
}
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  province = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('استان نمونه','Sample Province') RETURNING id"
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => http?.close(), 15000);

async function actor(admin = true) {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',$3)",
    [userId, `${userId}@example.test`, admin]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,$2,$3,clock_timestamp()+INTERVAL '1 day',clock_timestamp()+INTERVAL '30 minutes')",
    [sessionId, userId, csrf]
  );
  return {
    userId,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}
async function counts(userId: string) {
  return (
    await http.pool.query(
      `SELECT (SELECT COUNT(*) FROM provinces) AS provinces,
    (SELECT COUNT(*) FROM cities) AS cities,
    (SELECT COUNT(*) FROM audit_log WHERE user_id=$1) AS audits`,
      [userId]
    )
  ).rows[0];
}
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  fetch(`${http.base}/api/admin/geography/provinces${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

it('returns safe field feedback without writing rejected province input', async () => {
  const current = await actor(),
    before = await counts(current.userId);
  const response = await post('', current.headers, {
    nameFa: '<private-name>',
    nameEn: 'private 123',
  });
  expect(response.status).toBe(400);
  const body = (await response.json()) as ErrorResponse;
  expect(body.error).toMatchObject({
    code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    fields: ['nameFa', 'nameEn'],
  });
  expect(JSON.stringify(body)).not.toContain('private-name');
  expect(JSON.stringify(body)).not.toContain('private 123');
  expect(await counts(current.userId)).toEqual(before);
});
it('rejects an invalid import row as cities feedback with no partial rows or mutation audit', async () => {
  const current = await actor(),
    before = await counts(current.userId);
  const response = await post(`/${province}/cities/import`, current.headers, {
    cities: [
      { nameFa: 'شهر', nameEn: 'Good City' },
      { nameFa: 'شهر دیگر', nameEn: 'private 123' },
    ],
  });
  expect(response.status).toBe(400);
  const body = (await response.json()) as ErrorResponse;
  expect(body.error).toMatchObject({
    code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    fields: ['cities'],
  });
  expect(JSON.stringify(body)).not.toContain('private 123');
  expect(await counts(current.userId)).toEqual(before);
});
it('enforces the two-hundred-row import limit before any mutation', async () => {
  const current = await actor(),
    before = await counts(current.userId);
  const response = await post(`/${province}/cities/import`, current.headers, {
    cities: Array.from({ length: 201 }, () => ({ nameFa: 'شهر', nameEn: 'City' })),
  });
  expect(response.status).toBe(400);
  expect(((await response.json()) as ErrorResponse).error.fields).toEqual(['cities']);
  expect(await counts(current.userId)).toEqual(before);
});
it('keeps authorization ahead of field feedback', async () => {
  const current = await actor(false),
    before = await counts(current.userId);
  const response = await post('', current.headers, { nameFa: '<private-name>', nameEn: '123' });
  expect(response.status).toBe(403);
  expect(((await response.json()) as ErrorResponse).error.fields).toBeUndefined();
  expect(await counts(current.userId)).toEqual(before);
});
it('acknowledges the complete successful import in the selected province', async () => {
  const current = await actor();
  const cities = [
    { nameFa: 'شهر نخست', nameEn: 'First City' },
    { nameFa: 'شهر دوم', nameEn: 'Second City' },
  ];
  const response = await post(`/${province}/cities/import`, current.headers, { cities });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    imported: 2,
    cities: cities.map((city) => ({ ...city, provinceId: province, status: 'active' })),
  });
  expect(
    (
      await http.pool.query(
        'SELECT name_fa, name_en FROM cities WHERE province_id=$1 ORDER BY name_en',
        [province]
      )
    ).rows
  ).toEqual(cities.map((city) => ({ name_fa: city.nameFa, name_en: city.nameEn })));
});
