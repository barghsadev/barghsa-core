import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/dist/test/migrated-db.js';
import { durableDelivery } from './send-receipt.js';
import { pollSmsDeliveryReport } from './sms-delivery-report.js';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
let profileId: string;

beforeAll(async () => {
  fixture = await createMigratedTestDb();
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('receipt-owner','receipt@example.test','test-only')"
  );
  profileId = (
    await fixture.pool.query("INSERT INTO profiles(user_id) VALUES ('receipt-owner') RETURNING id")
  ).rows[0].id;
}, 30_000);

afterAll(async () => {
  await fixture?.close();
});

it('polls accepted SMS receipts once per lease and never reopens the send', async () => {
  const { pool } = fixture;
  const sms = { id: randomUUID(), transport: 'smsir' as const };
  const key = 'sms-report-fixture-key';
  await pool.query(
    `INSERT INTO sms_provider_configs(id,transport,label,status,config,created_by,last_test_status,
         last_test_at,delivery_verified_at,delivery_config_hash)
     VALUES ($1,'smsir','SMS report fixture','active',$2,'receipt-owner','passed',NOW(),NOW(),
         encode(sha256(convert_to(jsonb_build_array('smsir'::text,$2::jsonb)::text,'UTF8')),'hex'))`,
    [sms.id, { api_key: key, sender: '3000' }]
  );

  async function accept(messageId: string) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO notification_outbox(id,profile_id,event_key,channels,idempotency_key)
       VALUES ($1::uuid,$2,'invoice.created',ARRAY['sms'],$1::text)`,
      [id, profileId]
    );
    await pool.query(
      `INSERT INTO notification_job(outbox_id,channel,delivery_payload) VALUES ($1,'sms',$2)`,
      [
        id,
        {
          idempotencyKey: id,
          message: { providerId: sms.id, destination: '+989121234567', sender: '3000' },
        },
      ]
    );
    const send = vi.fn(async () => messageId);
    const execute = durableDelivery(pool, id, 'sms', id);
    await expect(execute(sms, send)).resolves.toBe(messageId);
    return { id, execute, send };
  }
  async function reportFields(id: string) {
    return (
      await pool.query(
        `SELECT status,provider_ref,sms_report_state,sms_report_checked_at,sms_report_delivered_at,
                sms_report_due_at FROM notification_send_receipts WHERE outbox_id=$1`,
        [id]
      )
    ).rows[0];
  }
  async function makeDue(id: string) {
    await pool.query(
      "UPDATE notification_send_receipts SET sms_report_due_at=NOW()-INTERVAL '1 second' WHERE outbox_id=$1",
      [id]
    );
  }
  const accepted = await accept('9087');
  expect(await reportFields(accepted.id)).toMatchObject({
    status: 'accepted',
    provider_ref: '9087',
    sms_report_state: null,
    sms_report_delivered_at: null,
    sms_report_due_at: expect.any(Date),
  });
  await makeDue(accepted.id);
  const now = Math.floor(Date.now() / 1000);
  function providerReport(state: number, mobile = 9121234567, messageId = 9087) {
    return Response.json({
      status: 1,
      data: {
        messageId,
        mobile,
        lineNumber: 3000,
        sendDateTime: now,
        deliveryState: state,
        deliveryDateTime: state === 1 ? now : null,
        messageText: 'provider returns private content',
      },
    });
  }

  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(providerReport(3));
  await pollSmsDeliveryReport(pool, request);
  expect(await reportFields(accepted.id)).toMatchObject({
    status: 'accepted',
    sms_report_state: 3,
    sms_report_checked_at: expect.any(Date),
    sms_report_delivered_at: null,
    sms_report_due_at: expect.any(Date),
  });
  await pollSmsDeliveryReport(pool, request);
  expect(request).toHaveBeenCalledOnce();
  request.mockClear();
  await makeDue(accepted.id);

  let complete!: (value: Response) => void;
  request.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  const delayed = pollSmsDeliveryReport(pool, request);
  try {
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0]?.[0]).toMatch(/\/v1\/send\/9087$/);
    expect(request.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe(key);
    await pollSmsDeliveryReport(pool, request);
    expect(request).toHaveBeenCalledOnce();

    await makeDue(accepted.id);
    request.mockResolvedValueOnce(providerReport(1, 9121234568));
    await expect(pollSmsDeliveryReport(pool, request)).rejects.toThrow(
      'SMS.ir delivery report check failed'
    );
    expect(await reportFields(accepted.id)).toMatchObject({
      status: 'accepted',
      sms_report_state: 3,
      sms_report_checked_at: expect.any(Date),
    });

    await makeDue(accepted.id);
    request.mockResolvedValueOnce(providerReport(1));
    await pollSmsDeliveryReport(pool, request);
  } finally {
    complete?.(providerReport(3));
    await delayed;
  }
  expect(await reportFields(accepted.id)).toMatchObject({
    status: 'accepted',
    provider_ref: '9087',
    sms_report_state: 1,
    sms_report_checked_at: expect.any(Date),
    sms_report_delivered_at: new Date(now * 1000),
    sms_report_due_at: null,
  });
  await pollSmsDeliveryReport(pool, request);
  expect(request).toHaveBeenCalledTimes(3);
  await expect(accepted.execute(sms, accepted.send)).resolves.toBe('9087');
  expect(accepted.send).toHaveBeenCalledOnce();
  request.mockClear();

  const failed = await accept('9090');
  await makeDue(failed.id);
  request.mockResolvedValueOnce(providerReport(2, undefined, 9090));
  await pollSmsDeliveryReport(pool, request);
  expect(await reportFields(failed.id)).toMatchObject({
    status: 'accepted',
    provider_ref: '9090',
    sms_report_state: 2,
    sms_report_checked_at: expect.any(Date),
    sms_report_delivered_at: null,
    sms_report_due_at: null,
  });
  await expect(failed.execute(sms, failed.send)).resolves.toBe('9090');
  expect(failed.send).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  request.mockClear();

  const expired = await accept('9089');
  await pool.query(
    "UPDATE notification_send_receipts SET accepted_at=NOW()-INTERVAL '25 hours' WHERE outbox_id=$1",
    [expired.id]
  );
  await makeDue(expired.id);
  await pollSmsDeliveryReport(pool, request);
  expect(request).not.toHaveBeenCalled();
  expect(await reportFields(expired.id)).toMatchObject({
    status: 'accepted',
    sms_report_checked_at: null,
    sms_report_due_at: null,
  });

  const retired = await accept('9088');
  await makeDue(retired.id);
  await pool.query("UPDATE sms_provider_configs SET status='superseded' WHERE id=$1", [sms.id]);
  await pollSmsDeliveryReport(pool, request);
  expect(request).not.toHaveBeenCalled();
  expect(await reportFields(retired.id)).toMatchObject({
    status: 'accepted',
    provider_ref: '9088',
    sms_report_state: null,
    sms_report_due_at: null,
  });
});
