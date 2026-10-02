import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ContractStatusTimeline } from './ContractStatusTimeline.js';
import { contractText } from '@barghsa/i18n/contracts';
import type { ContractHistoryEvent } from '../lib/contracts.js';

const history: ContractHistoryEvent[] = [
  {
    id: 'one',
    event: 'contract.published',
    at: '2026-10-01T00:00:00Z',
    actorType: 'staff',
    reason: null,
  },
  {
    id: 'two',
    event: 'contract.accepted',
    at: '2026-10-02T00:00:00Z',
    actorType: 'customer',
    reason: '<img src=x onerror=alert(1)>',
  },
  {
    id: 'three',
    event: 'contract.completed',
    at: '2026-10-03T00:00:00Z',
    actorType: 'system',
    reason: null,
  },
  {
    id: 'four',
    event: 'private_future_event',
    at: '2026-10-04T00:00:00Z',
    actorType: 'future_actor' as 'staff',
    reason: null,
  },
];
it.each(['en', 'fa'] as const)(
  'keeps contract history localized, literal and bounded in %s',
  (locale) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <ContractStatusTimeline
        history={history}
        truncated
        locale={locale}
        formatTimestamp={(date) => `localized ${date}`}
      />
    );
    expect(host.querySelectorAll('ol > li')).toHaveLength(4);
    expect(
      [...host.querySelectorAll('[data-tone]')].map((node) => node.getAttribute('data-tone'))
    ).toEqual(['warning', 'success', 'default', 'default']);
    expect(host.textContent).toContain(contractText('statusHistoryTruncated', locale));
    expect(host.querySelector('time')?.textContent).toBe('localized 2026-10-01T00:00:00Z');
    expect(host.textContent).toContain(contractText('staff', locale));
    expect(host.textContent).toContain(contractText('customer', locale));
    expect(host.textContent).toContain(contractText('system', locale));
    expect(host.textContent).toContain(contractText('statusHistoryUnknown', locale));
    expect(host.textContent).not.toContain('private_future_event');
    expect(host.textContent).not.toContain('future_actor');
    expect(host.querySelectorAll('bdi')).toHaveLength(3);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  }
);
it.each(['en', 'fa'] as const)('describes missing recorded events in %s', (locale) => {
  const html = renderToStaticMarkup(
    <ContractStatusTimeline history={[]} locale={locale} formatTimestamp={(date) => date} />
  );
  expect(html).toContain(contractText('statusHistoryEmpty', locale));
  expect(html).not.toContain('status-timeline');
});
