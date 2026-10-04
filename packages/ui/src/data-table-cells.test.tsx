import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  AvatarCell,
  CurrencyCell,
  DateCell,
  LinkCell,
  NumberCell,
  StatusCell,
  TextCell,
} from './components/base-ui/data-table-cells';

it('escapes literal text, isolates direction and formats finite numbers with the explicit numeral preference', () => {
  expect(renderToStaticMarkup(<TextCell value="<script>text</script>" />)).toContain(
    '&lt;script&gt;text&lt;/script&gt;'
  );
  expect(renderToStaticMarkup(<NumberCell value={12345} locale="fa" numerals="latn" />)).toContain(
    '12,345'
  );
  expect(
    renderToStaticMarkup(<NumberCell value={12345n} locale="en" numerals="arabext" />)
  ).toContain('۱۲٬۳۴۵');
  for (const value of [null, undefined, Infinity, NaN])
    expect(renderToStaticMarkup(<NumberCell value={value} />)).toContain('—');
});

it('preserves exact monetary input and delegates absolute/relative date rendering to the owner', () => {
  const money = vi.fn((amount: string | number | bigint) => `IRR ${amount}`);
  expect(
    renderToStaticMarkup(<CurrencyCell amount="9007199254740993123" format={money} />)
  ).toContain('9007199254740993123');
  expect(money).toHaveBeenCalledExactlyOnceWith('9007199254740993123');
  const format = vi.fn(() => 'Account-local date');
  const markup = renderToStaticMarkup(
    <DateCell value="2026-10-04T00:00:00Z" format={format} mode="relative" />
  );
  expect(markup).toContain('dateTime="2026-10-04T00:00:00.000Z"');
  expect(format).toHaveBeenCalledExactlyOnceWith('2026-10-04T00:00:00Z', 'relative');
  format.mockClear();
  expect(renderToStaticMarkup(<DateCell value="invalid" format={format} />)).toContain('—');
  expect(renderToStaticMarkup(<DateCell value={null} format={format} />)).toContain('—');
  expect(format).not.toHaveBeenCalled();
});

it('allows ordinary references while executable, credentialed and ambiguous links remain plain text', () => {
  for (const href of ['/invoices/123?view=detail', '#detail', 'https://example.test/invoice'])
    expect(renderToStaticMarkup(<LinkCell href={href}>Invoice</LinkCell>)).toContain('<a ');
  for (const href of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//evil.test',
    '/\\evil.test',
    'https://user:pass@example.test',
    ' /invoices',
    '\nhttps://example.test',
  ])
    expect(renderToStaticMarkup(<LinkCell href={href}>Invoice</LinkCell>)).not.toContain('<a ');
});

it('reuses descriptive state badges and keeps identity text literal without loading an unsafe avatar', () => {
  expect(renderToStaticMarkup(<StatusCell state="paid" label="Paid" />)).toContain('title="Paid"');
  const markup = renderToStaticMarkup(<AvatarCell name="<b>Staff</b>" src="javascript:alert(1)" />);
  expect(markup).toContain('&lt;b&gt;Staff&lt;/b&gt;');
  expect(markup).not.toContain('javascript:');
});
