import { historyContextText } from '../lib/history-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tSolar } from '@barghsa/i18n/solar';
import { SolarStageProgress } from './SolarStageProgress.js';
import { constructionProgress } from '../test/solar-progress-fixtures.js';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fa' }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => state.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: () => 'Account date', notice: null }),
}));
let host: HTMLDivElement, root: Root;
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
  it(`${locale}: shows six stages in domain order with recorded dates and literal chosen names/notes`, async () => {
    state.locale = locale;
    const captured = constructionProgress(2);
    captured.events = captured.events.map((event) => ({ ...event, actorContext: 'staff' }));
    await act(async () => root.render(<SolarStageProgress progress={captured} />));
    const rows = host.querySelectorAll('[data-slot=progress-stepper]>li');
    expect(rows).toHaveLength(6);
    expect(rows[1]!.textContent).toContain(tSolar('construction_postal_submission', locale));
    expect(rows[2]!.textContent).toContain(tSolar('construction_contract_signing', locale));
    expect([...rows].map((row) => row.getAttribute('data-state'))).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
      'complete',
      'current',
    ]);
    expect(host.querySelectorAll('[aria-current=step]')).toHaveLength(1);
    expect(rows[3]!.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-09-26T23:00:00.000Z'
    );
    expect(rows[5]!.querySelector('time')).toBeNull();
    expect(host.textContent).toContain('کارشناس <img src=x>');
    expect(host.textContent).toContain('Verified <script> work');
    expect(host.querySelector('img,script')).toBeNull();
    expect(host.querySelector('[data-slot=status-timeline] bdi')?.textContent).toBe(
      'کارشناس <img src=x> · ' + historyContextText('staff', locale)
    );
  });
  it(`${locale}: retains recorded identity without inventing missing context`, async () => {
    state.locale = locale;
    await act(async () =>
      root.render(
        <SolarStageProgress
          progress={{
            ...constructionProgress(1),
            events: constructionProgress(1).events.map((event) => {
              const legacy = { ...event };
              delete legacy.actorContext;
              return legacy;
            }),
          }}
        />
      )
    );
    expect(host.querySelector('[data-slot=status-timeline] bdi')?.textContent).toBe(
      'کارشناس <img src=x> · ' + historyContextText(null, locale)
    );
    expect(host.querySelector('img,script')).toBeNull();
  });
  it(`${locale}: distinguishes completed legacy paperwork with no date and closed work with no fabricated current step`, async () => {
    state.locale = locale;
    const progress = constructionProgress();
    progress.stopped = true;
    progress.steps.forEach((s) => {
      s.state = s.completed ? 'complete' : 'pending';
      s.recordedAt = null;
    });
    await act(async () => root.render(<SolarStageProgress progress={progress} />));
    expect(host.textContent).toContain(tSolar('constructionNoDate', locale));
    expect(host.textContent).toContain(tSolar('constructionStopped', locale));
    expect(host.querySelector('[aria-current=step]')).toBeNull();
    expect(host.querySelector('time')).toBeNull();
  });
}
