import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useOnboardingForm } from './useOnboardingForm.js';

let root: Root, host: HTMLDivElement, fields: ReturnType<typeof useOnboardingForm>;
function Sample({
  allowedCity = 'tehran',
  required = 'Required',
}: {
  allowedCity?: string;
  required?: string;
}) {
  fields = useOnboardingForm({ name: '', city: '' }, (name, value) =>
    !value.trim()
      ? required
      : name === 'city' && value !== allowedCity
        ? 'Unavailable city'
        : undefined
  );
  return (
    <output>
      {JSON.stringify({ values: fields.values, errors: fields.errors, touched: fields.touched })}
    </output>
  );
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('uses RHF as the single draft store and composes rapid functional field updates', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => {
    fields.field('name')[1]('Draft');
    fields.field('name')[1]((value) => value + ' one');
    fields.field('name')[1]((value) => value + ' two');
  });
  expect(fields.values.name).toBe('Draft one two');
  expect(fields.form.getValues('name')).toBe('Draft one two');
  expect(fields.form.getFieldState('name').isDirty).toBe(true);
  expect(fields.errors).toEqual({});
});

it('touches on blur, clears feedback after an edit and revalidates touched fields', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => fields.blur('name'));
  expect(fields.touched.name).toBe(true);
  expect(fields.errors.name).toBe('Required');
  await act(async () => fields.setField('name', 'Retained name'));
  expect(fields.errors.name).toBeUndefined();
  await act(async () => fields.setField('name', ''));
  expect(fields.errors.name).toBe('Required');
});

it('shows scoped Next errors without validating future empty fields', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => {
    expect(await fields.form.trigger(['name'])).toBe(false);
  });
  expect(fields.errors.name).toBe('Required');
  expect(fields.touched.name).toBe(true);
  expect(fields.errors.city).toBeUndefined();
  await act(async () => fields.setField('name', 'Retained name'));
  expect(fields.errors.name).toBeUndefined();
  await act(async () => {
    expect(await fields.form.trigger(['name'])).toBe(true);
  });
});

it('restores or clears a server draft and resets feedback without a second local data store', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => fields.blur('name'));
  await act(async () => fields.form.reset({ name: 'Saved name', city: 'tehran' }));
  expect(fields.values).toEqual({ name: 'Saved name', city: 'tehran' });
  expect(fields.errors).toEqual({});
  expect(fields.touched.name).toBe(false);
  expect(fields.form.getFieldState('name').isDirty).toBe(false);
  await act(async () => fields.form.reset({ name: '', city: '' }));
  expect(fields.values).toEqual({ name: '', city: '' });
});

it('uses current localized rules and current city membership on later validation', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => {
    fields.setField('name', 'Retained name');
    fields.setField('city', 'tehran');
  });
  await act(async () => {
    expect(await fields.form.trigger()).toBe(true);
  });
  await act(async () => root.render(<Sample allowedCity="shiraz" required="الزامی" />));
  await act(async () => {
    expect(await fields.form.trigger()).toBe(false);
  });
  expect(fields.errors.city).toBe('Unavailable city');
  expect(fields.values.name).toBe('Retained name');
  await act(async () => fields.setField('name', ''));
  await act(async () => fields.blur('name'));
  expect(fields.errors.name).toBe('الزامی');
});
