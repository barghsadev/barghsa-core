import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  Form,
  FormInput,
  FormTextarea,
  FormPhoneInput,
  FormSelect,
  FormCheckbox,
  FormSwitch,
  FormRadioGroup,
  FormCombobox,
  FormSlider,
  FormDatePicker,
  FormDateRangePicker,
  FormSubmit,
  useZodForm,
  setServerFieldErrors,
} from './index';

const schema = z.object({
  text: z.string().min(1, 'Required'),
  note: z.string().min(1, 'Required'),
  phone: z.string().min(1, 'Required'),
  select: z.string().min(1, 'Required'),
  checkbox: z.boolean().refine(Boolean, 'Required'),
  switch: z.boolean().refine(Boolean, 'Required'),
  radio: z.string().min(1, 'Required'),
  combo: z.string().min(1, 'Required'),
  multi: z.array(z.string()).min(1, 'Required'),
  slider: z.number().min(1, 'Required'),
  sliders: z.array(z.number()).min(1, 'Required'),
  date: z.date().nullable().refine(Boolean, 'Required'),
  range: z.object({ from: z.date(), to: z.date() }).nullable().refine(Boolean, 'Required'),
});
type Values = z.input<typeof schema>;
const defaults: Values = {
  text: 'Retained text',
  note: 'Retained note',
  phone: '+98 912 123 4567',
  select: 'alpha',
  checkbox: true,
  switch: true,
  radio: 'alpha',
  combo: 'alpha',
  multi: ['alpha', 'beta'],
  slider: 10,
  sliders: [10, 20],
  date: new Date('2026-03-22T00:00:00Z'),
  range: { from: new Date('2026-03-21T00:00:00Z'), to: new Date('2026-03-23T00:00:00Z') },
};
const invalid: Values = {
  text: '',
  note: '',
  phone: '',
  select: '',
  checkbox: false,
  switch: false,
  radio: '',
  combo: '',
  multi: [],
  slider: 0,
  sliders: [],
  date: null,
  range: null,
};
const options = [
  { value: 'inactive', label: 'Inactive', disabled: true },
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
];
let host: HTMLDivElement, root: Root, form: ReturnType<typeof useZodForm<Values>>;
const save = vi.fn();
function Sample({
  invalidField,
  disabled = false,
}: {
  invalidField?: keyof Values;
  disabled?: boolean;
}) {
  form = useZodForm(schema, {
    defaultValues: {
      ...defaults,
      ...(invalidField ? { [invalidField]: invalid[invalidField] } : {}),
    },
  });
  const common = { control: form.control, disabled, description: 'Field guidance' };
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(save)}>
        <FormInput
          {...common}
          id="text"
          name="text"
          label="Text"
          inputProps={{ 'aria-describedby': 'external-help' }}
        />
        <p id="external-help">Existing help</p>
        <FormTextarea {...common} id="note" name="note" label="Note" />
        <FormPhoneInput {...common} id="phone" name="phone" label="Phone" />
        <FormSelect
          {...common}
          id="select"
          name="select"
          label="Select"
          options={options}
          placeholder="Choose"
        />
        <FormCheckbox {...common} id="checkbox" name="checkbox" label="Checkbox" />
        <FormSwitch {...common} id="switch" name="switch" label="Switch" />
        <FormRadioGroup {...common} id="radio" name="radio" label="Radio" options={options} />
        <FormCombobox
          {...common}
          id="combo"
          name="combo"
          label="Combo"
          options={options}
          emptyMessage="No options"
        />
        <FormCombobox
          {...common}
          id="multi"
          name="multi"
          label="Multi"
          options={options}
          emptyMessage="No options"
          multiple
          removeLabel={(label) => `Remove ${label}`}
        />
        <FormSlider {...common} id="slider" name="slider" label="Slider" />
        <FormSlider
          {...common}
          id="sliders"
          name="sliders"
          label="Range slider"
          inputProps={{ thumbLabels: ['Minimum', 'Maximum'] }}
        />
        <FormDatePicker
          {...common}
          id="date"
          name="date"
          label="Date"
          inputProps={{ locale: 'en', timezone: 'UTC' }}
        />
        <FormDateRangePicker
          {...common}
          id="range"
          name="range"
          label="Range"
          inputProps={{ locale: 'en', timezone: 'UTC' }}
        />
        <FormSubmit>Save</FormSubmit>
      </form>
    </Form>
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  save.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const focusTargets: [keyof Values, string][] = [
  ['text', '#text'],
  ['note', '#note'],
  ['phone', '#phone'],
  ['select', '#select'],
  ['checkbox', '[role=checkbox]'],
  ['switch', '[role=switch]'],
  ['radio', '#radio [role=radio]:not([data-disabled])'],
  ['combo', '#combo'],
  ['multi', '#multi'],
  ['slider', '#slider input[type=range]'],
  ['sliders', '#sliders input[type=range]'],
  ['date', '#date'],
  ['range', '#range'],
];
for (const [name, selector] of focusTargets) {
  it(`${name} binds its error and focuses the interactive control after invalid submission`, async () => {
    await act(async () => root.render(<Sample invalidField={name} />));
    await act(async () => form.handleSubmit(save)());
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector(selector)));
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector(`#${name}-message`)?.textContent).toBe('Required');
    const feedback = host.querySelector(
      name === 'checkbox' || name === 'switch' ? selector : `#${name}`
    );
    expect(feedback?.getAttribute('aria-invalid')).toBe('true');
    expect(feedback?.getAttribute('aria-describedby')).toContain(`${name}-message`);
    expect(form.getValues('phone')).toBe(name === 'phone' ? '' : defaults.phone);
  });
}
it('preserves raw text and phone characters, tracks touch and resets all controls', async () => {
  await act(async () => root.render(<Sample />));
  for (const [name, value] of [
    ['text', '  New name  '],
    ['note', 'New note'],
    ['phone', '+98 ۹۱۲ 1234567'],
  ] as const) {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${name}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        name === 'note' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(form.getValues(name)).toBe(value);
    expect(form.getFieldState(name).isTouched).toBe(true);
  }
  const phone = host.querySelector<HTMLInputElement>('#phone')!;
  expect(phone.type).toBe('tel');
  expect(phone.dir).toBe('ltr');
  expect(phone.inputMode).toBe('tel');
  expect(host.querySelector('#text')?.getAttribute('aria-describedby')).toBe(
    'external-help text-description'
  );
  await act(async () => host.querySelector<HTMLElement>('[role=checkbox]')!.click());
  await act(async () => host.querySelector<HTMLElement>('[role=switch]')!.click());
  expect(form.getValues('checkbox')).toBe(false);
  expect(form.getValues('switch')).toBe(false);
  await act(async () => form.reset(defaults));
  expect(form.getValues()).toEqual(defaults);
  expect(host.querySelector<HTMLInputElement>('#text')!.value).toBe(defaults.text);
  expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  expect(host.querySelector('#select')?.textContent).toContain('Alpha');
  expect(host.querySelector<HTMLInputElement>('#combo')!.value).toBe('Alpha');
});
it('binds a nested field through FormProvider without an explicit control', async () => {
  type Nested = { rows: { name: string }[] };
  let nested!: ReturnType<typeof useZodForm<Nested>>;
  function NestedForm() {
    nested = useZodForm(
      z.object({ rows: z.array(z.object({ name: z.string().min(1, 'Required') })) }),
      { defaultValues: { rows: [{ name: 'Saved row' }] } }
    );
    return (
      <Form {...nested}>
        <FormInput<Nested, 'rows.0.name'> id="nested" name="rows.0.name" label="Row name" />
      </Form>
    );
  }
  await act(async () => root.render(<NestedForm />));
  const input = host.querySelector<HTMLInputElement>('#nested')!;
  expect(input.value).toBe('Saved row');
  await act(async () => nested.setValue('rows.0.name', '', { shouldValidate: true }));
  expect(host.querySelector('#nested-message')?.textContent).toBe('Required');
  expect(input.getAttribute('aria-describedby')).toBe('nested-message');
});
it('touches a range slider after leaving the group, preserving editing between its thumbs', async () => {
  await act(async () => root.render(<Sample />));
  const inputs = host.querySelectorAll<HTMLInputElement>('#sliders input[type=range]');
  await act(async () =>
    inputs[0]!.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: inputs[1]! })
    )
  );
  expect(form.getFieldState('sliders').isTouched).toBe(false);
  await act(async () =>
    inputs[1]!.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: host.querySelector('#text') })
    )
  );
  expect(form.getFieldState('sliders').isTouched).toBe(true);
  expect(form.getValues('sliders')).toEqual(defaults.sliders);
});
it('shows nested range validation and focuses the registered picker when its end is missing', async () => {
  const rangeSchema = z.object({
    period: z.object({ from: z.date(), to: z.date({ error: 'Choose an end' }) }),
    note: z.string(),
  });
  type RangeValues = z.input<typeof rangeSchema>;
  let rangeForm!: ReturnType<typeof useZodForm<RangeValues>>;
  function IncompleteRange() {
    rangeForm = useZodForm(rangeSchema, {
      defaultValues: { period: { from: defaults.date! }, note: 'Keep this note' },
    });
    return (
      <Form {...rangeForm}>
        <FormDateRangePicker
          control={rangeForm.control}
          id="period"
          name="period"
          label="Period"
          inputProps={{ locale: 'en', timezone: 'UTC' }}
        />
      </Form>
    );
  }
  await act(async () => root.render(<IncompleteRange />));
  await act(async () => rangeForm.handleSubmit(save)());
  expect(host.querySelector('#period-message')?.textContent).toBe('Choose an end');
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('#period')));
  expect(save).not.toHaveBeenCalled();
  expect(rangeForm.getValues('note')).toBe('Keep this note');
});
it('keeps every value and error association on server rejection and clears feedback on reset', async () => {
  await act(async () => root.render(<Sample />));
  for (const [name, selector] of focusTargets) {
    await act(async () => {
      form.clearErrors();
      setServerFieldErrors(form, { [name]: 'Correct this value' }, [name], 'Retry');
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector(selector)));
    expect(form.getValues()).toEqual(defaults);
    expect(host.querySelector(`#${name}-message`)?.textContent).toBe('Correct this value');
  }
  await act(async () => form.reset(defaults));
  expect(host.querySelectorAll('[role=alert]')).toHaveLength(0);
  expect(host.querySelector('#date')?.getAttribute('aria-describedby')).toBe('date-description');
  expect(host.querySelector('#sliders input[type=range]')?.getAttribute('aria-describedby')).toBe(
    'sliders-description'
  );
});
it('disables every adapter and chip during submission without omitting values, then restores retry', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  save.mockImplementationOnce(async () => {
    await gate;
  });
  await act(async () => root.render(<Sample />));
  let pending!: Promise<void | undefined>;
  await act(async () => {
    pending = form.handleSubmit(save)();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[0]).toEqual(defaults);
  for (const input of host.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
  >('input:not([type=hidden]):not([aria-hidden=true]),textarea,button'))
    expect(input.disabled || input.getAttribute('aria-disabled') === 'true', input.outerHTML).toBe(
      true
    );
  for (const input of host.querySelectorAll('[role=checkbox],[role=switch],[role=radio]'))
    expect(input.getAttribute('aria-disabled')).toBe('true');
  expect(form.getValues()).toEqual(defaults);
  await act(async () => {
    await form.handleSubmit(save)();
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Remove Alpha"]')!.click()
  );
  expect(form.getValues('multi')).toEqual(defaults.multi);
  await act(async () => {
    release();
    await pending;
  });
  expect(host.querySelector<HTMLInputElement>('#phone')!.disabled).toBe(false);
});
