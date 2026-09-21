import { describe, expect, it } from 'vitest';
import { ReviewSnapshotService } from './review-snapshot.service.js';

const service = new ReviewSnapshotService();
const scope = {
  action: 'invoice.wallet-payment',
  profileId: '01900000-0000-7000-8000-000000000001',
  resourceId: '01900000-0000-7000-8000-000000000002',
};
const data = () => ({
  total: '9007199254740993',
  remaining: '9007199254740990',
  lines: [{ title: 'Electricity', unitPrice: '3002399751580331', quantity: 3 }],
  rules: { revision: 1, refundable: true },
});

describe('financial review confirmation', () => {
  it('preserves exact monetary strings and survives JSONB object-key reordering', () => {
    const original = data();
    const snapshot = service.create(scope, original);
    const reordered = service.create(
      { resourceId: scope.resourceId, profileId: scope.profileId, action: scope.action },
      {
        rules: original.rules,
        lines: original.lines,
        remaining: original.remaining,
        total: original.total,
      }
    );
    expect(reordered.hash).toBe(snapshot.hash);
    expect(reordered.data.total).toBe('9007199254740993');
    service.assertConfirmed(JSON.parse(JSON.stringify(reordered)), snapshot.hash);
  });

  it('captures a detached value so later adapter mutations cannot change the review', () => {
    const original = data();
    const snapshot = service.create(scope, original);
    original.lines[0]!.unitPrice = '1';
    original.rules.refundable = false;
    expect(snapshot.data.lines[0]!.unitPrice).toBe('3002399751580331');
    expect(snapshot.data.rules.refundable).toBe(true);
    service.assertConfirmed(snapshot, snapshot.hash);
  });

  it.each(['price', 'rule', 'amount', 'action', 'profile', 'resource'])(
    'rejects a stale confirmation after changing %s',
    (field) => {
      const original = service.create(scope, data());
      const next = data();
      const nextScope = { ...scope };
      if (field === 'price') next.lines[0]!.unitPrice = '3002399751580332';
      if (field === 'rule') next.rules.revision = 2;
      if (field === 'amount') next.remaining = '1';
      if (field === 'action') nextScope.action = 'invoice.adjust';
      if (field === 'profile') nextScope.profileId = scope.resourceId;
      if (field === 'resource') nextScope.resourceId = scope.profileId;
      const changed = service.create(nextScope, next);
      expect(() => service.assertConfirmed(changed, original.hash)).toThrow();
    }
  );

  it('verifies the stored pre-payment snapshot for cached and durable-ledger retries', () => {
    const snapshot = service.create(scope, data());
    const metadata = JSON.parse(JSON.stringify({ financialReview: snapshot }));
    expect(service.assertStored(metadata, snapshot.hash, scope)).toEqual(snapshot);
    metadata.financialReview.data.remaining = '0';
    expect(() => service.assertStored(metadata, snapshot.hash, scope)).toThrow();
    expect(() => service.assertStored({}, snapshot.hash, scope)).toThrow();
    expect(() => service.assertStored(null, snapshot.hash, scope)).toThrow();
    expect(() => service.assertStored({ financialReview: {} }, snapshot.hash, scope)).toThrow();
    expect(() =>
      service.assertStored({ financialReview: snapshot }, snapshot.hash, {
        ...scope,
        action: 'other',
      })
    ).toThrow();
  });

  it('binds the schema version and rejects malformed confirmation hashes', () => {
    const snapshot = service.create(scope, data());
    expect(() => service.assertConfirmed(snapshot, 'not-a-hash')).toThrow();
    expect(() =>
      service.assertConfirmed({ ...snapshot, schemaVersion: 2 } as never, snapshot.hash)
    ).toThrow();
    expect(() => service.create({ ...scope, action: '' }, data())).toThrow();
  });

  it.each([undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n, new Date(), () => 1])(
    'rejects values that cannot round-trip exactly through JSON: %s',
    (value) => expect(() => service.create(scope, { value })).toThrow()
  );

  it('rejects cycles but permits repeated independent references and preserves array order', () => {
    const nested: Record<string, unknown> = { value: null };
    nested.self = nested;
    expect(() => service.create(scope, nested)).toThrow();
    const shared = { value: null };
    const snapshot = service.create(scope, { lines: [shared, shared], discount: 0 });
    expect(snapshot.data.lines).toEqual([{ value: null }, { value: null }]);
    expect(service.create(scope, { lines: ['a', 'b'] }).hash).not.toBe(
      service.create(scope, { lines: ['b', 'a'] }).hash
    );
  });
});
