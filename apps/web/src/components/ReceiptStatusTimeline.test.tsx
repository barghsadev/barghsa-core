import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { ReceiptStatusTimeline } from './ReceiptStatusTimeline.js';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: distinguishes recorded roles from legacy unknown actors and renders chosen names/notes as text`, async () => {
    const stamp = '2026-10-01T12:00:00Z';
    const history: ComponentProps<typeof ReceiptStatusTimeline>['history'] = [
      {
        state: 'Submitted',
        occurredAt: stamp,
        backfilled: false,
        actorType: 'customer' as const,
        actorName: 'آرش <img src=x>',
        reason: 'Customer note <script>',
      },
      {
        state: 'Confirmed',
        occurredAt: stamp,
        backfilled: false,
        actorType: 'staff' as const,
        actorName: null,
        reason: null,
      },
      { state: 'Rejected', occurredAt: stamp, backfilled: true },
      {
        state: 'FutureState' as ComponentProps<
          typeof ReceiptStatusTimeline
        >['history'][number]['state'],
        occurredAt: stamp,
        backfilled: false,
        actorType: 'unknown' as const,
        actorName: 'Unproven name',
        reason: null,
      },
    ];
    await act(async () =>
      root.render(
        <ReceiptStatusTimeline
          history={history}
          label="Receipt activity"
          locale={locale}
          formatTimestamp={() => 'Account time'}
        />
      )
    );
    const rows = host.querySelectorAll('li');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.querySelector('bdi')?.textContent).toBe(
      `آرش <img src=x> · ${t('invoices.activity.actor.customer', locale)}`
    );
    expect(rows[0]!.textContent).toContain('Customer note <script>');
    expect(host.querySelector('img,script')).toBeNull();
    expect(rows[1]!.querySelector('bdi')?.textContent).toBe(
      t('invoices.activity.actor.staff', locale)
    );
    expect(rows[1]!.querySelector('[data-tone=success]')).not.toBeNull();
    expect(rows[2]!.textContent).toContain(t('invoices.activity.historicalTime', locale));
    expect(rows[2]!.querySelector('bdi')?.textContent).toBe(
      t('invoices.activity.actor.unknown', locale)
    );
    expect(rows[3]!.textContent).toContain(t('invoices.activity.state.Unknown', locale));
    expect(host.textContent).not.toContain('Unproven name');
    expect(rows[0]!.querySelector('time')?.getAttribute('datetime')).toBe(stamp);
  });
}
