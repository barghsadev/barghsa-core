import { historyContextText } from '../lib/history-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tSaving } from '@barghsa/i18n/saving';
import { SavingFulfillmentProgress } from './SavingFulfillmentProgress.js';
import type { SavingFulfillmentEvent, SavingFulfillmentStage } from '../lib/saving-fulfillment.js';

let host: HTMLDivElement, root: Root;
const at = '2026-10-02T23:30:00.000Z';
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
const stages = (): SavingFulfillmentStage[] => [
  {
    stage: 'request_confirmation',
    status: 'completed',
    completed_at: null,
    explanation: null,
    handover_description: null,
  },
  {
    stage: 'product_delivery',
    status: 'completed',
    completed_at: at,
    explanation: 'Delivered',
    handover_description: null,
  },
  {
    stage: 'installation_and_document_upload',
    status: 'completed',
    completed_at: at,
    explanation: 'Installed',
    handover_description: null,
  },
  {
    stage: 'equipment_handover',
    status: 'skipped',
    completed_at: at,
    explanation: 'Customer retained equipment',
    handover_description: null,
  },
  {
    stage: 'process_completion',
    status: 'in_progress',
    started_at: at,
    completed_at: null,
    explanation: null,
    handover_description: null,
  },
];
const events = (): SavingFulfillmentEvent[] => [
  {
    id: '1',
    stage: 'request_confirmation',
    from_status: 'pending',
    to_status: 'completed',
    explanation: 'Staff approved request',
    created_at: at,
    actorName: null,
    actor_context: 'staff',
    noteKind: 'confirmed',
  },
  {
    id: '2',
    stage: 'equipment_handover',
    from_status: 'in_progress',
    to_status: 'skipped',
    explanation: 'Literal <script> note',
    created_at: at,
    actorName: 'کارشناس <img src=x>',
    actor_context: 'staff',
    handover_description: 'تجهیز ABC <b>literal</b>',
    noteKind: 'recorded',
  },
];
for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: retains dated evidence and neutral optional skips, with literal chosen identities and notes`, async () => {
    await act(async () =>
      root.render(
        <SavingFulfillmentProgress
          stages={stages()}
          events={events()}
          status="in_progress"
          locale={locale}
          formatTimestamp={() => 'Account-localized date'}
          truncated
        />
      )
    );
    const steps = [...host.querySelectorAll('[data-slot=progress-stepper]>li')];
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual([
      'complete',
      'complete',
      'complete',
      'skipped',
      'current',
    ]);
    expect(steps[3]!.querySelector('.lucide-minus')).not.toBeNull();
    expect(steps[3]!.querySelector('.lucide-check')).toBeNull();
    expect(steps[3]!.textContent).toContain(tSaving('skipped', locale));
    expect(host.querySelectorAll('[aria-current=step]')).toHaveLength(1);
    expect(steps[0]!.querySelector('time')).toBeNull();
    expect(steps[0]!.textContent).toContain(tSaving('stageNoDate', locale));
    expect(steps[4]!.querySelector('time')?.getAttribute('datetime')).toBe(at);
    expect(host.textContent).toContain(tSaving('stageHistoryTruncated', locale));
    expect(host.textContent).toContain(tSaving('stageConfirmedNote', locale));
    expect(host.textContent).not.toContain('Staff approved request');
    expect(host.textContent).toContain('Literal <script> note');
    expect(host.textContent).not.toContain('in_progress');
    expect(host.querySelector('script,img')).toBeNull();
    expect(host.querySelector('[data-slot=status-timeline] bdi')?.textContent).toContain(
      historyContextText('staff', locale)
    );
    expect(
      [...host.querySelectorAll('bdi')].some((b) => b.textContent?.includes('کارشناس <img src=x>'))
    ).toBe(true);
  });
  it(`${locale}: preserves literal identities while missing context stays unknown`, async () => {
    const legacy = events().map(({ actor_context: _context, ...event }) => event);
    await act(async () =>
      root.render(
        <SavingFulfillmentProgress
          stages={stages()}
          events={legacy}
          status="in_progress"
          locale={locale}
          formatTimestamp={() => 'Account-localized date'}
        />
      )
    );
    expect(host.querySelector('[data-slot=status-timeline] bdi')?.textContent).toBe(
      historyContextText(null, locale)
    );
    expect(host.textContent).toContain('کارشناس <img src=x>');
    expect(host.querySelector('script,img')).toBeNull();
  });
  it(`${locale}: keeps stopped evidence without activating or inventing a future milestone`, async () => {
    for (const status of ['cancelled', 'rejected', 'completed']) {
      await act(async () =>
        root.render(
          <SavingFulfillmentProgress
            stages={stages()}
            events={[]}
            status={status}
            locale={locale}
            formatTimestamp={() => 'Local date'}
          />
        )
      );
      expect(host.querySelector('[aria-current=step]')).toBeNull();
      expect(host.textContent).toContain(tSaving('staffNoHistory', locale));
      if (status !== 'completed')
        expect(host.textContent).toContain(tSaving('stageStopped', locale));
    }
  });
}
