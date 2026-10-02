import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FormInput, FormStep, useZodForm, type FormStepActions } from './index';

const base = z.object({
  identity: z.string().min(1, 'Identity required'),
  address: z.string().min(1, 'Address required'),
});
let host: HTMLDivElement, root: Root, form: ReturnType<typeof useZodForm<z.input<typeof base>>>;
let actions: FormStepActions;
let navigate: (step: number) => void;
const next = vi.fn();
const submit = vi.fn();
const invalid = vi.fn();
const pending = vi.fn();
function Sample({
  schema = base,
  initialStep = 1,
  disabled = false,
}: {
  schema?: typeof base;
  initialStep?: number;
  disabled?: boolean;
}) {
  form = useZodForm(schema, { defaultValues: { identity: '', address: '' } });
  const [step, setStep] = useState(initialStep);
  navigate = setStep;
  return (
    <FormStep
      form={form}
      fields={step === 1 ? ['identity'] : step === 2 ? ['address'] : []}
      stepKey={step}
      disabled={disabled}
      onNext={async (values) => {
        await next(values);
        setStep(step + 1);
      }}
      onSubmit={submit}
      onInvalid={async (errors, action) => {
        invalid(errors, action);
        if (action === 'submit') setStep(errors.identity ? 1 : 2);
      }}
      onPendingChange={pending}
    >
      {(state) => {
        actions = state;
        return (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void state.submit();
            }}
          >
            <output data-step>{step}</output>
            <fieldset hidden={step !== 1} disabled={state.pending || step !== 1}>
              <FormInput control={form.control} name="identity" label="Identity" id="identity" />
            </fieldset>
            <fieldset hidden={step !== 2} disabled={state.pending || step !== 2}>
              <FormInput control={form.control} name="address" label="Address" id="address" />
            </fieldset>
            <button type="button" disabled={state.pending} onClick={() => void state.next()}>
              Next
            </button>
            <button type="submit" disabled={state.pending}>
              Submit
            </button>
          </form>
        );
      }}
    </FormStep>
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function render(props: Parameters<typeof Sample>[0] = {}) {
  await act(async () => root.render(<Sample {...props} />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  next.mockReset();
  submit.mockReset();
  invalid.mockReset();
  pending.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('validates only current fields on Next and preserves partial data across hidden steps', async () => {
  await render();
  await act(async () => form.setValue('identity', 'Retained identity'));
  await act(async () => actions.next());
  expect(next).toHaveBeenCalledExactlyOnceWith({ identity: 'Retained identity', address: '' });
  expect(host.querySelector('[data-step]')?.textContent).toBe('2');
  expect(form.getFieldState('address').invalid).toBe(false);
  await act(async () => actions.next());
  expect(next).toHaveBeenCalledTimes(1);
  expect(form.getValues('identity')).toBe('Retained identity');
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('#address')));
  expect(invalid).toHaveBeenCalledWith(
    expect.objectContaining({ address: expect.objectContaining({ message: 'Address required' }) }),
    'next'
  );
  await act(async () => navigate(1));
  expect((host.querySelector('#identity') as HTMLInputElement).value).toBe('Retained identity');
});

it('validates every field on final Submit, returns to the invalid stage and focuses enabled input', async () => {
  await render({ initialStep: 3 });
  await act(async () => actions.submit());
  expect(submit).not.toHaveBeenCalled();
  expect(invalid).toHaveBeenCalledWith(
    expect.objectContaining({ identity: expect.any(Object), address: expect.any(Object) }),
    'submit'
  );
  expect(host.querySelector('[data-step]')?.textContent).toBe('1');
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('#identity')));
  await act(async () => {
    form.setValue('identity', 'Saved identity');
    form.setValue('address', 'Saved address');
    navigate(3);
  });
  await act(async () => actions.submit());
  expect(submit.mock.calls[0]?.[0]).toEqual({
    identity: 'Saved identity',
    address: 'Saved address',
  });
});

it('does not interpret an empty instructions/review step as full form validation', async () => {
  await render({ initialStep: 3 });
  const trigger = vi.spyOn(form, 'trigger');
  await act(async () => actions.next());
  expect(trigger).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledOnce();
  expect(form.getFieldState('identity').invalid).toBe(false);
});

it('locks Next and Submit together before an async resolver yields', async () => {
  const gate = deferred();
  let runs = 0;
  const schema = base.superRefine(async () => {
    runs++;
    await gate.promise;
  });
  await render({ schema });
  await act(async () => form.setValue('identity', 'Retained identity'));
  let first!: Promise<void>;
  await act(async () => {
    first = actions.next();
    await actions.next();
    await actions.submit();
  });
  expect(actions.pending).toBe(true);
  expect(runs).toBe(1);
  expect(submit).not.toHaveBeenCalled();
  expect(host.querySelector('#identity')?.matches(':disabled')).toBe(true);
  await act(async () => {
    gate.resolve();
    await first;
  });
  expect(next).toHaveBeenCalledOnce();
  expect(actions.pending).toBe(false);
  expect(pending.mock.calls.map(([value]) => value)).toEqual([true, false]);
});

it.each(['edit', 'reset', 'navigate'] as const)(
  'ignores obsolete Next validation after %s',
  async (change) => {
    const gate = deferred();
    await render({ schema: base.superRefine(async () => gate.promise) });
    await act(async () => form.setValue('identity', 'Old identity'));
    let first!: Promise<void>;
    await act(async () => {
      first = actions.next();
    });
    await act(async () => {
      if (change === 'edit') form.setValue('identity', 'New identity');
      else if (change === 'reset') form.reset({ identity: 'Restored identity', address: '' });
      else navigate(2);
    });
    await act(async () => {
      gate.resolve();
      await first;
    });
    expect(next).not.toHaveBeenCalled();
    expect(invalid).not.toHaveBeenCalled();
    expect(actions.pending).toBe(false);
  }
);

it('ignores obsolete final validation after values change', async () => {
  const gate = deferred();
  await render({ schema: base.superRefine(async () => gate.promise), initialStep: 3 });
  await act(async () => {
    form.setValue('identity', 'Old identity');
    form.setValue('address', 'Saved address');
  });
  let first!: Promise<void>;
  await act(async () => {
    first = actions.submit();
  });
  await act(async () => form.setValue('identity', 'Changed identity'));
  await act(async () => {
    gate.resolve();
    await first;
  });
  expect(submit).not.toHaveBeenCalled();
});

it('releases the transaction lock after a failed save so the same values can retry', async () => {
  await render();
  await act(async () => form.setValue('identity', 'Retained identity'));
  next.mockRejectedValueOnce(new Error('Save unavailable'));
  await act(async () => {
    await expect(actions.next()).rejects.toThrow('Save unavailable');
  });
  expect(actions.pending).toBe(false);
  expect(form.getValues('identity')).toBe('Retained identity');
  await act(async () => actions.next());
  expect(next).toHaveBeenCalledTimes(2);
});

it('blocks disabled commands and cancels pending callbacks on unmount', async () => {
  await render({ disabled: true });
  await act(async () => {
    await actions.next();
    await actions.submit();
  });
  expect(next).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  const gate = deferred();
  await render({ schema: base.superRefine(async () => gate.promise) });
  await act(async () => form.setValue('identity', 'Retained identity'));
  let first!: Promise<void>;
  await act(async () => {
    first = actions.next();
    root.unmount();
  });
  await act(async () => {
    gate.resolve();
    await first;
  });
  expect(next).not.toHaveBeenCalled();
  root = createRoot(host);
});

it('submits transformed schema output while retaining the editable input draft', async () => {
  let inputForm!: ReturnType<typeof useZodForm<{ amount: string }, { amount: number }>>;
  function Transform() {
    inputForm = useZodForm(z.object({ amount: z.string().trim().transform(Number) }), {
      defaultValues: { amount: ' 42 ' },
    });
    return (
      <FormStep form={inputForm} fields={['amount']} stepKey={1} onNext={next} onSubmit={submit}>
        {(state) => {
          actions = state;
          return <FormInput name="amount" label="Amount" />;
        }}
      </FormStep>
    );
  }
  await act(async () => root.render(<Transform />));
  await act(async () => actions.submit());
  expect(submit.mock.calls[0]?.[0]).toEqual({ amount: 42 });
  expect(inputForm.getValues('amount')).toBe(' 42 ');
});
