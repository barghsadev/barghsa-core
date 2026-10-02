/** Transaction-local, receipt-bound evidence for the database's state-history trigger. */
export async function receiptActivityActor(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  receiptId: string,
  userId: string | null,
  actorType: 'customer' | 'staff'
) {
  await client.query("SELECT set_config('barghsa.receipt_actor',$1,true)", [
    JSON.stringify({ receiptId, userId, actorType: userId ? actorType : 'unknown' }),
  ]);
}
