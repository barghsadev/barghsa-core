import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { startHttpFixture } from "../test/http-fixture.js";
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("PostgreSQL setup did not run");
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const [user, role] of [
    ["initiator", "role-finance"],
    ["reviewer", "role-finance"],
    ["support", "role-customer-support"],
  ]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)",
      [user, `${user}@example.test`, "test-only"],
    );
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)",
      [user, role],
    );
    const id = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [id, user, csrf, randomUUID()],
    );
    headers[user!] = {
      Cookie: `barghsa_session=${id}`,
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function seed() {
  return (
    await http.pool
      .query(`INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason)
  VALUES ('bank_payment_confirmation',100000,'initiator','Verified bank deposit') RETURNING id`)
  ).rows[0].id as string;
}
async function decide(user: string, id: string, action = "approve") {
  return fetch(`${http.base}/api/admin/approval-requests/${id}/${action}`, {
    method: "POST",
    headers: headers[user]!,
    body: JSON.stringify({ reason: "Rejected after review" }),
  });
}
it("requires recent step-up for financial approval and rejection, preserving pending requests", async () => {
  for (const action of ["approve", "reject"]) {
    const id = await seed();
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='reviewer'",
    );
    const response = await decide("reviewer", id, action);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHZ:STEP_UP_REQUIRED" },
    });
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='reviewer'",
    );
    expect((await decide("reviewer", id, action)).status).toBe(403);
    expect(
      (
        await http.pool.query(
          "SELECT status FROM approval_requests WHERE id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("pending");
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'",
    );
    expect((await decide("reviewer", id, action)).status).toBe(200);
    expect(
      (
        await http.pool.query(
          "SELECT status,reviewer_id FROM approval_requests WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({
      status: action === "approve" ? "approved" : "rejected",
      reviewer_id: "reviewer",
    });
    expect((await decide("reviewer", id, action)).status).toBe(409);
  }
});
it("requires a different currently eligible reviewer even after step-up", async () => {
  const id = await seed();
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW()");
  expect((await decide("initiator", id)).status).toBe(403);
  expect((await decide("support", id)).status).toBe(403);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'");
  expect((await decide("reviewer", id)).status).toBe(403);
  expect(
    (
      await http.pool.query(
        "SELECT status FROM approval_requests WHERE id=$1",
        [id],
      )
    ).rows[0].status,
  ).toBe("pending");
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance')",
  );
});
it("requires step-up to initiate and permits queue reads without it", async () => {
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='initiator'",
  );
  expect(
    (
      await fetch(`${http.base}/api/admin/approval-requests`, {
        headers: headers.initiator!,
      })
    ).status,
  ).toBe(200);
  const response = await fetch(`${http.base}/api/admin/approval-requests`, {
    method: "POST",
    headers: headers.initiator!,
    body: "{}",
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "AUTHZ:STEP_UP_REQUIRED" },
  });
});

async function walletReceipt(amount = 100000n) {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,status) VALUES ('initiator','ACTIVE') RETURNING id",
    )
  ).rows[0].id;
  await http.pool.query("INSERT INTO wallets(profile_id) VALUES ($1)", [
    profile,
  ]);
  const id = randomUUID(),
    attachment = `uploads/document/${randomUUID()}.pdf`;
  await http.pool.query(
    `INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata,receipt_attachment_key)
    VALUES ($1::uuid,$2,'topup',$3,'Pending',$1::text,$4::jsonb,$5)`,
    [
      id,
      profile,
      amount.toString(),
      JSON.stringify({
        channel: "bank_receipt",
        receipt: {
          paymentDate: "2026-09-01",
          payerReference: "verified-slip",
          attachmentKey: attachment,
          customerNote: null,
        },
      }),
      attachment,
    ],
  );
  return { id, profile };
}
async function confirmWallet(user: string, id: string, body: unknown = {}) {
  return fetch(
    `${http.base}/api/admin/wallet/bank-receipt-top-ups/${id}/confirm`,
    { method: "POST", headers: headers[user]!, body: JSON.stringify(body) },
  );
}
it("parks threshold wallet receipts and settles once after a distinct finance confirmation", async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW()");
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('finance.dual_approval_threshold','{"threshold_irr":100000}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
  );
  const receipt = await walletReceipt();
  const first = await confirmWallet("initiator", receipt.id);
  expect(first.status, await first.clone().text()).toBe(200);
  const pending = (await first.json()) as {
    dualApproval: { requestId: string };
    state: string;
  };
  expect(pending.state).toBe("Pending");
  expect(pending.dualApproval.requestId).toBeTruthy();
  expect(
    (
      await http.pool.query(
        "SELECT posted_balance FROM wallets WHERE profile_id=$1",
        [receipt.profile],
      )
    ).rows[0].posted_balance,
  ).toBe("0");
  expect((await confirmWallet("initiator", receipt.id)).status).toBe(200);
  expect((await confirmWallet("support", receipt.id)).status).toBe(403);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => confirmWallet("reviewer", receipt.id)),
  );
  for (const result of results)
    expect(result.status, await result.text()).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT posted_balance FROM wallets WHERE profile_id=$1",
        [receipt.profile],
      )
    ).rows[0].posted_balance,
  ).toBe("100000");
  expect(
    (
      await http.pool.query(
        "SELECT status,reviewer_id FROM approval_requests WHERE id=$1",
        [pending.dualApproval.requestId],
      )
    ).rows[0],
  ).toEqual({ status: "approved", reviewer_id: "reviewer" });
});
it("refuses changed receipt evidence or destination after approval initiation", async () => {
  const receipt = await walletReceipt();
  expect((await confirmWallet("initiator", receipt.id)).status).toBe(200);
  expect(
    (await confirmWallet("reviewer", receipt.id, { invoiceId: randomUUID() }))
      .status,
  ).toBe(409);
  await http.pool.query(
    "UPDATE wallet_transactions SET amount=amount+1 WHERE id=$1",
    [receipt.id],
  );
  expect((await confirmWallet("reviewer", receipt.id)).status).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT posted_balance FROM wallets WHERE profile_id=$1",
        [receipt.profile],
      )
    ).rows[0].posted_balance,
  ).toBe("0");
});
it("respects generic rejection and revoked reviewer permissions before wallet settlement", async () => {
  for (const action of ["reject", "approve"]) {
    const receipt = await walletReceipt();
    const pending = (await (
      await confirmWallet("initiator", receipt.id)
    ).json()) as { dualApproval: { requestId: string } };
    expect(
      (await decide("reviewer", pending.dualApproval.requestId, action)).status,
    ).toBe(200);
    if (action === "approve")
      await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'");
    expect((await confirmWallet("initiator", receipt.id)).status).toBe(
      action === "reject" ? 409 : 403,
    );
    expect(
      (
        await http.pool.query(
          "SELECT posted_balance FROM wallets WHERE profile_id=$1",
          [receipt.profile],
        )
      ).rows[0].posted_balance,
    ).toBe("0");
  }
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance')",
  );
});

it("applies below-threshold, disabled and corrupt configuration without bypassing saved requests", async () => {
  const below = await walletReceipt(99999n);
  expect((await confirmWallet("initiator", below.id)).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT posted_balance FROM wallets WHERE profile_id=$1",
        [below.profile],
      )
    ).rows[0].posted_balance,
  ).toBe("99999");
  const pending = await walletReceipt();
  expect((await confirmWallet("initiator", pending.id)).status).toBe(200);
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":0}' WHERE key='finance.dual_approval_threshold'`,
  );
  expect((await confirmWallet("initiator", pending.id)).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT posted_balance FROM wallets WHERE profile_id=$1",
        [pending.profile],
      )
    ).rows[0].posted_balance,
  ).toBe("0");
  const disabled = await walletReceipt();
  expect((await confirmWallet("initiator", disabled.id)).status).toBe(200);
  const corrupt = await walletReceipt();
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":"broken"}' WHERE key='finance.dual_approval_threshold'`,
  );
  expect((await confirmWallet("initiator", corrupt.id)).status).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT posted_balance FROM wallets WHERE profile_id=$1",
        [corrupt.profile],
      )
    ).rows[0].posted_balance,
  ).toBe("0");
});

it('returns and audits large IRR approval amounts without numeric rounding', async () => {
  const amount='10000000000000001'
  const id=await seed()
  await http.pool.query('UPDATE approval_requests SET amount_irr=$2 WHERE id=$1',[id,amount])
  const response=await decide('reviewer',id)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({amountIrR:amount})
  const audit=(await http.pool.query("SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='approval_request_approved' AND metadata::jsonb->>'requestId'=$1",[id])).rows[0]
  expect(audit.metadata.amountIrR).toBe(amount)
})

async function invoiceReceipt() {
  const profile=(await http.pool.query("INSERT INTO profiles(user_id,status) VALUES ('initiator','ACTIVE') RETURNING id")).rows[0].id
  const invoice=(await http.pool.query(`INSERT INTO invoices(profile_id,order_id,replaces_invoice_id,adjustment_for_invoice_id,state,total_amount)
    VALUES ($1,NULL,NULL,NULL,'Overdue',100000) RETURNING id`,[profile])).rows[0].id
  const id=(await http.pool.query(`INSERT INTO bank_receipts(invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key)
    VALUES ($1,$2,100000,'2026-09-01','verified-slip',$3) RETURNING id`,[invoice,profile,`sealed/${randomUUID()}.pdf`])).rows[0].id as string
  return {id,invoice,profile}
}
async function confirmInvoice(user:string,id:string) {return fetch(`${http.base}/api/admin/invoices/bank-receipts/${id}/confirm`,{method:'POST',headers:headers[user]!,body:'{}'})}
it('requires invoice-owned approval evidence and rejects changed receipt evidence',async()=>{
  await http.pool.query(`UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`)
  for(const changed of [false,true]) {
    const receipt=await invoiceReceipt()
    const first=await confirmInvoice('initiator',receipt.id)
    expect(first.status,await first.clone().text()).toBe(200)
    expect(await first.json()).toMatchObject({state:'UnderReview',dualApprovalPending:true})
    if(changed)await http.pool.query("UPDATE bank_receipts SET payer_reference='different-slip' WHERE id=$1",[receipt.id])
    const second=await confirmInvoice('reviewer',receipt.id)
    expect(second.status,await second.text()).toBe(changed?409:200)
    const invoice=(await http.pool.query('SELECT paid_amount,state FROM invoices WHERE id=$1',[receipt.invoice])).rows[0]
    expect(invoice).toEqual(changed?{paid_amount:'0',state:'Overdue'}:{paid_amount:'100000',state:'Paid'})
  }
})
it('cannot use a generic approval for an invoice receipt or an approval from a revoked reviewer',async()=>{
  const forged=await invoiceReceipt()
  const fake=await seed()
  await http.pool.query(`UPDATE approval_requests SET details=$2::jsonb WHERE id=$1`,[fake,JSON.stringify({receiptId:forged.id,invoiceId:forged.invoice,profileId:forged.profile,entityType:'invoice_bank_receipt'})])
  expect((await decide('reviewer',fake)).status).toBe(200)
  expect((await confirmInvoice('initiator',forged.id)).status).toBe(409)
  const receipt=await invoiceReceipt()
  const pending=await (await confirmInvoice('initiator',receipt.id)).json() as {dualApprovalRequestId:string}
  expect((await decide('reviewer',pending.dualApprovalRequestId)).status).toBe(200)
  await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'")
  expect((await confirmInvoice('initiator',receipt.id)).status).toBe(403)
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance')")
  expect((await http.pool.query('SELECT paid_amount FROM invoices WHERE id=$1',[receipt.invoice])).rows[0].paid_amount).toBe('0')
})
