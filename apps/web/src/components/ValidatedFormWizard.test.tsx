import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { ValidatedFormWizard } from './ValidatedFormWizard.js';

const schema = z.object({
  name: z.string().min(1, 'Required name'),
  quantities: z.object({ thermal: z.string().min(1, 'Required quantity') }),
  accepted: z.boolean().refine(Boolean, 'Accept terms'),
});
let host: HTMLDivElement, root: Root;
let fields: ReturnType<typeof useWizardForm<z.infer<typeof schema>>>;
let submit: Mock<() => Promise<void>>;
function Sample({ quantity = '10', disabled = false }: { quantity?: string; disabled?: boolean }) {
  const [step, setStep] = useState(1);
  fields = useWizardForm(
    schema.extend({
      quantities: z.object({
        thermal: z.string().refine((value) => value === quantity, 'Unavailable quantity'),
      }),
    }),
    { name: '', quantities: { thermal: '' }, accepted: false }
  );
  const [name, setName] = fields.field('name');
  const [thermal, setThermal] = fields.field('quantities.thermal');
  const [accepted, setAccepted] = fields.field('accepted');
  return (
    <ValidatedFormWizard
      form={fields.form}
      fields={[
        [{ name: 'name', label: 'Name' }],
        [
          { name: 'quantities.thermal', label: 'Quantity' },
          { name: 'accepted', label: 'Terms' },
        ],
      ]}
      errorId={fields.errorId}
      onPendingChange={fields.setValidationPending}
      disabled={disabled}
      onInvalidStep={async (target) => setStep(target)}
      step={step}
      steps={['Details', 'Review']}
      ariaLabel="Order"
      backLabel="Back"
      saveLabel="Save"
      nextLabel="Next"
      submitLabel="Submit"
      savingLabel="Saving"
      submittingLabel="Submitting"
      saving={false}
      submitting={false}
      saveDisabled={false}
      nextDisabled={disabled}
      submitDisabled={disabled}
      onBack={() => setStep(1)}
      onSave={() => {}}
      onNext={async () => setStep(2)}
      onSubmit={async () => {
        await submit();
      }}
    >
      {(pending) => (
        <fieldset disabled={pending}>
          {step === 1 ? (
            <input
              aria-label="Name"
              {...fields.bind('name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          ) : (
            <>
              <input
                aria-label="Quantity"
                {...fields.bind('quantities.thermal')}
                value={thermal}
                onChange={(event) => setThermal(event.target.value)}
              />
              <input
                aria-label="Terms"
                type="checkbox"
                {...fields.bind('accepted')}
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
            </>
          )}
        </fieldset>
      )}
    </ValidatedFormWizard>
  );
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((node) => node.textContent === label)!;
const settleFocus = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  submit = vi.fn(async () => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('validates the current step, retains partial data and returns a final invalid draft to its first field', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => button('Next').click());
  await act(settleFocus);
  const name = host.querySelector<HTMLInputElement>('[name="name"]')!;
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(name);
  expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Name: Required name'
  );
  expect(fields.form.getFieldState('quantities.thermal').invalid).toBe(false);
  await act(async () => fields.field('name')[1]('Buyer'));
  await act(async () => button('Next').click());
  expect(host.querySelector('[name="quantities.thermal"]')).not.toBeNull();
  expect(fields.form.getValues('name')).toBe('Buyer');
  await act(async () => {
    fields.field('quantities.thermal')[1]('10');
    fields.field('accepted')[1](true);
    fields.field('name')[1]('');
  });
  await act(async () => button('Submit').click());
  await act(settleFocus);
  expect(submit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(host.querySelector('[name="name"]'));
  expect(fields.form.getValues()).toEqual({
    name: '',
    quantities: { thermal: '10' },
    accepted: true,
  });
  await act(async () => fields.field('name')[1]('Buyer'));
  await act(async () => button('Next').click());
  await act(async () => button('Submit').click());
  expect(submit).toHaveBeenCalledOnce();
});

it('composes typed functional updates, revalidates blurred fields with current rules and resets a draft', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => {
    fields.field('name')[1]('Buyer');
    fields.field('name')[1]((value) => value + ' one');
    fields.field('name')[1]((value) => value + ' two');
  });
  expect(fields.values.name).toBe('Buyer one two');
  await act(async () => button('Next').click());
  await act(async () => fields.bind('quantities.thermal').onBlur());
  expect(fields.form.getFieldState('quantities.thermal').error?.message).toBe(
    'Unavailable quantity'
  );
  await act(async () => fields.field('quantities.thermal')[1]('10'));
  expect(fields.form.getFieldState('quantities.thermal').invalid).toBe(false);
  await act(async () => root.render(<Sample quantity="20" />));
  await act(async () => fields.bind('quantities.thermal').onBlur());
  expect(fields.form.getFieldState('quantities.thermal').invalid).toBe(true);
  await act(async () =>
    fields.form.reset({ name: 'Saved buyer', quantities: { thermal: '20' }, accepted: true })
  );
  expect(fields.values).toEqual({
    name: 'Saved buyer',
    quantities: { thermal: '20' },
    accepted: true,
  });
  expect(fields.errors).toEqual({});
});

it('keeps one submission pending and respects disabled navigation', async () => {
  await act(async () => root.render(<Sample disabled />));
  await act(async () => fields.field('name')[1]('Buyer'));
  expect(button('Next').disabled).toBe(true);
  await act(async () => button('Next').click());
  expect(host.querySelector('[name="name"]')).not.toBeNull();
  await act(async () => root.render(<Sample />));
  await act(async () => button('Next').click());
  await act(async () => {
    fields.field('quantities.thermal')[1]('10');
    fields.field('accepted')[1]((value) => !value);
  });
  let resolve!: () => void;
  submit.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  await act(async () => {
    button('Submit').click();
    button('Submit').click();
  });
  expect(submit).toHaveBeenCalledOnce();
  expect(fields.pending).toBe(true);
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
  await act(async () => resolve());
  expect(fields.pending).toBe(false);
  expect(host.querySelector('fieldset')!.disabled).toBe(false);
});
