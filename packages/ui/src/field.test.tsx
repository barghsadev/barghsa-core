import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from './components/ui/field';

let host: HTMLDivElement;
let root: Root;
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

it('retains native labels, legends and description associations in grouped fields', async () => {
  await act(async () =>
    root.render(
      <FieldSet disabled>
        <FieldLegend>Billing contact</FieldLegend>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="contact">Contact name</FieldLabel>
            <FieldContent>
              <input id="contact" aria-describedby="contact-help" />
              <FieldDescription id="contact-help">Use the legal contact.</FieldDescription>
            </FieldContent>
          </Field>
          <FieldSeparator>Alternative</FieldSeparator>
          <Field>
            <FieldTitle>Office</FieldTitle>
            <FieldLegend variant="label">Office contact</FieldLegend>
          </Field>
          <FieldSeparator />
        </FieldGroup>
      </FieldSet>
    )
  );
  const input = host.querySelector('input')!;
  expect(input.labels?.[0]?.textContent).toBe('Contact name');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Use the legal contact.'
  );
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(host.querySelector('legend')?.textContent).toBe('Billing contact');
  expect(host.querySelectorAll('[data-slot=field-separator-content]')).toHaveLength(1);
});

it('deduplicates validation messages, ignores absent entries and prioritizes explicit feedback', async () => {
  await act(async () =>
    root.render(
      <FieldError
        errors={[
          { message: 'Required' },
          { message: 'Required' },
          undefined,
          { message: 'Invalid' },
        ]}
      />
    )
  );
  expect(
    Array.from(host.querySelectorAll('[role=alert] li'), (element) => element.textContent)
  ).toEqual(['Required', 'Invalid']);
  await act(async () => root.render(<FieldError errors={[{ message: 'Required' }]} />));
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Required');
  expect(host.querySelector('ul')).toBeNull();
  await act(async () =>
    root.render(
      <FieldError errors={[{ message: 'Old error' }]}>Server rejected the change</FieldError>
    )
  );
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Server rejected the change');
  for (const errors of [undefined, [], [undefined], [{}]]) {
    await act(async () =>
      root.render(<FieldError {...(errors === undefined ? {} : { errors })} />)
    );
    expect(host.querySelector('[role=alert]')).toBeNull();
  }
});
