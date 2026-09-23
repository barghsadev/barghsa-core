import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AcceptedSavingAgreement } from './AcceptedSavingAgreement.js';

it.each(['en', 'fa'] as const)(
  'keeps accepted terms and shows a visible %s update notice',
  (locale) => {
    const markup = renderToStaticMarkup(
      <AcceptedSavingAgreement snapshot={'Accepted title\nAccepted body'} updated locale={locale} />
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Accepted title\nAccepted body');
    expect(markup.indexOf('role="status"')).toBeLessThan(markup.indexOf('<details'));
  }
);

it('does not announce an agreement change when the accepted version is current', () => {
  const markup = renderToStaticMarkup(
    <AcceptedSavingAgreement snapshot="Accepted body" updated={false} locale="en" />
  );
  expect(markup).not.toContain('role="status"');
  expect(markup).toContain('Accepted body');
});
