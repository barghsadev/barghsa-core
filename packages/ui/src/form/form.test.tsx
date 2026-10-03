import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as mini from 'zod/mini';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormSubmit,
  useZodForm,
  setServerFieldErrors,
} from './index';

let host: HTMLDivElement, root: Root;
const schema = z.object({ name: z.string().trim().min(1, 'Enter a name'), note: z.string() });
type Values = z.input<typeof schema>;
let form: ReturnType<typeof useZodForm<Values>>;
const save = vi.fn();
function Sample({ description = true }: { description?: boolean }) {
  form = useZodForm(schema, { defaultValues: { name: '', note: 'Retained draft' } });
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(save)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem id="name">
              <FormLabel>Name</FormLabel>
              <FormControl>
                <input
                  {...field}
                  disabled={form.formState.isSubmitting}
                  aria-describedby="external-help"
                />
              </FormControl>
              {description && <FormDescription>Use the contact name</FormDescription>}
              <FormMessage reserveSpace />
            </FormItem>
          )}
        />
        <p id="external-help">Existing help</p>
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note</FormLabel>
              <FormControl>
                <textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root?.server?.message && (
          <p role="alert">{form.formState.errors.root.server.message}</p>
        )}
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
async function typeName(value: string) {
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('validates on touch, clears corrected errors and binds only mounted help/error IDs', async () => {
  await act(async () => root.render(<Sample />));
  const input = host.querySelector('input')!;
  expect(input.labels?.[0]?.textContent).toBe('Name');
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(input.getAttribute('aria-describedby')).toBe('external-help name-description');
  await typeName(' ');
  expect(host.querySelector('[role=alert]')).toBeNull();
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Enter a name');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe(
    'external-help name-description name-message'
  );
  await typeName('Sara');
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(input.getAttribute('aria-invalid')).toBeNull();
  await act(async () => root.render(<Sample description={false} />));
  expect(input.getAttribute('aria-describedby')).toBe('external-help');
  expect(form.getValues()).toEqual({ name: 'Sara', note: 'Retained draft' });
});
it('focuses the first invalid field on submit without clearing valid input', async () => {
  await act(async () => root.render(<Sample />));
  await act(async () => form.handleSubmit(save)());
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('input')));
  expect(save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(host.querySelector('input'));
  expect(form.getValues('note')).toBe('Retained draft');
  expect(form.isSubmissionPending()).toBe(false);
});
it('maps only allowed server fields, focuses in form order and preserves the draft through retry', async () => {
  await act(async () => root.render(<Sample />));
  await typeName('Sara');
  await act(async () =>
    setServerFieldErrors(
      form,
      {
        note: ['Correct the note'],
        name: 'Correct the name',
        unknown: 'Internal detail',
      },
      ['name', 'note'],
      'Could not save'
    )
  );
  expect(document.activeElement).toBe(host.querySelector('input'));
  expect(form.formState.errors.root?.server?.message).toBe('Could not save');
  expect(host.textContent).not.toContain('Internal detail');
  expect(form.getValues()).toEqual({ name: 'Sara', note: 'Retained draft' });
  await act(async () => form.handleSubmit(save)());
  expect(save).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(form.getValues('note')).toBe('Retained draft');
});

it('defers server error focus until the submitting control is enabled again', async () => {
  await act(async () => root.render(<Sample />));
  await typeName('Sara');
  const input = host.querySelector('input')!;
  const nativeFocus = input.focus.bind(input);
  const focused: boolean[] = [];
  vi.spyOn(input, 'focus').mockImplementation(() => {
    focused.push(input.disabled);
    nativeFocus();
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  save.mockImplementation(async () => {
    await waiting;
    setServerFieldErrors(form, { name: 'Correct the name' }, ['name'], 'Could not save');
  });
  let submission!: Promise<unknown>;
  await act(async () => {
    submission = form.handleSubmit(save)();
  });
  expect(host.querySelector('input')!.disabled).toBe(true);
  await act(async () => {
    release();
    await submission;
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  expect(host.querySelector('input')!.disabled).toBe(false);
  expect(focused).toEqual([false]);
  expect(document.activeElement).toBe(host.querySelector('input'));
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Correct the name');
  expect(form.getValues('note')).toBe('Retained draft');
});
it.each([
  null,
  [],
  {},
  { name: '' },
  { name: 123 },
  { name: 'x'.repeat(501) },
  JSON.parse('{"__proto__":"private"}'),
])('keeps malformed server feedback at the form level: %j', async (errors) => {
  await act(async () => root.render(<Sample />));
  await act(async () => setServerFieldErrors(form, errors, ['name'], 'Could not save'));
  expect(form.formState.errors.root?.server?.message).toBe('Could not save');
  expect(form.formState.errors.name).toBeUndefined();
  expect(form.getValues('note')).toBe('Retained draft');
});
it('locks duplicate submits before async validation, returns handler output and releases after failure', async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const asyncSchema = schema.superRefine(async () => waiting);
  function AsyncForm() {
    form = useZodForm(asyncSchema, { defaultValues: { name: 'Sara', note: 'Draft' } });
    return (
      <Form {...form}>
        <FormSubmit>Save</FormSubmit>
      </Form>
    );
  }
  await act(async () => root.render(<AsyncForm />));
  const handler = vi.fn(() => 'saved');
  let first!: Promise<string | undefined>, second!: Promise<string | undefined>;
  await act(async () => {
    first = form.handleSubmit(handler)();
    second = form.handleSubmit(handler)();
  });
  expect(form.isSubmissionPending()).toBe(true);
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(host.querySelector('button')!.getAttribute('aria-busy')).toBe('true');
  expect(handler).not.toHaveBeenCalled();
  await act(async () => release());
  expect(await first).toBe('saved');
  expect(await second).toBeUndefined();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(form.isSubmissionPending()).toBe(false);
  await act(async () => {
    await expect(
      form.handleSubmit(async () => {
        throw new Error('Network failed');
      })()
    ).rejects.toThrow('Network failed');
  });
  expect(form.isSubmissionPending()).toBe(false);
  expect(host.querySelector('button')!.disabled).toBe(false);
  await act(async () => form.handleSubmit(handler)());
  expect(handler).toHaveBeenCalledTimes(2);
});
it('passes transformed schema output to the handler while retaining raw input values', async () => {
  const transformed = z.object({ quantity: z.string().transform(Number) });
  const receive = vi.fn();
  function TransformForm() {
    const transformedForm = useZodForm(transformed, { defaultValues: { quantity: '12' } });
    return (
      <Form {...transformedForm}>
        <FormField
          control={transformedForm.control}
          name="quantity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quantity</FormLabel>
              <FormControl>
                <input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <button
          onClick={() =>
            transformedForm.handleSubmit((value) => {
              receive(value, transformedForm.getValues());
            })()
          }
        >
          Save
        </button>
      </Form>
    );
  }
  await act(async () => root.render(<TransformForm />));
  await act(async () => host.querySelector('button')!.click());
  expect(receive).toHaveBeenCalledWith({ quantity: 12 }, { quantity: '12' });
});

it('focuses a nested array field after invalid submission and invokes the invalid callback once', async () => {
  const nested = z.object({
    contacts: z.array(z.object({ name: z.string().min(1, 'Enter a name') })),
  });
  const invalid = vi.fn();
  function NestedForm() {
    const nestedForm = useZodForm(nested, { defaultValues: { contacts: [{ name: '' }] } });
    return (
      <Form {...nestedForm}>
        <form onSubmit={nestedForm.handleSubmit(save, invalid)}>
          <FormField
            control={nestedForm.control}
            name="contacts.0.name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact name</FormLabel>
                <FormControl>
                  <input {...field} disabled={nestedForm.formState.isSubmitting} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormSubmit>Save</FormSubmit>
        </form>
      </Form>
    );
  }
  await act(async () => root.render(<NestedForm />));
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(save).not.toHaveBeenCalled();
  expect(invalid).toHaveBeenCalledTimes(1);
  expect(host.querySelector('input')!.disabled).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('input')));
  expect(document.activeElement).toBe(host.querySelector('input'));
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Enter a name');
});

it('focuses an already touched invalid field using its current registered ref', async () => {
  await act(async () => root.render(<Sample />));
  await typeName(' ');
  await act(async () =>
    host.querySelector('input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  );
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Enter a name');
  await act(async () => host.querySelector('textarea')!.focus());
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('input')));
  expect(save).not.toHaveBeenCalled();
  expect(form.getValues('note')).toBe('Retained draft');
});

it('supports the tree-shakable Zod schema with the same retained values and focus', async () => {
  function MiniForm() {
    form = useZodForm(
      mini.object({
        name: mini.string().check(mini.minLength(1, 'Enter a name')),
        note: mini.string(),
      }),
      { defaultValues: { name: '', note: 'Retained draft' } }
    );
    return (
      <form noValidate onSubmit={form.handleSubmit(save)}>
        <input {...form.register('name')} />
        <p role="alert">{form.formState.errors.name?.message}</p>
      </form>
    );
  }
  await act(async () => root.render(<MiniForm />));
  await act(async () => form.handleSubmit(save)());
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('input')));
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Enter a name');
  expect(form.getValues('note')).toBe('Retained draft');
  expect(save).not.toHaveBeenCalled();
  await typeName('Sara');
  await act(async () => form.handleSubmit(save)());
  expect(save).toHaveBeenCalledWith({ name: 'Sara', note: 'Retained draft' }, undefined);
});

it('loads a schema only on validation and retains the draft after a failed load', async () => {
  const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(schema);
  function LazyForm() {
    form = useZodForm(loader, {
      defaultValues: { name: '', note: 'Retained draft' },
      validationUnavailableMessage: 'Validation could not load. Try again.',
    });
    return (
      <form noValidate onSubmit={form.handleSubmit(save)}>
        <input {...form.register('name')} />
        <p role="alert">{form.formState.errors.root?.validation?.message}</p>
      </form>
    );
  }
  await act(async () => root.render(<LazyForm />));
  expect(loader).not.toHaveBeenCalled();
  await typeName('Sara');
  await act(async () => form.handleSubmit(save)());
  expect(host.querySelector('[role=alert]')?.textContent).toBe(
    'Validation could not load. Try again.'
  );
  expect(form.formState.isSubmitting).toBe(false);
  expect(form.isSubmissionPending()).toBe(false);
  expect(form.getValues()).toEqual({ name: 'Sara', note: 'Retained draft' });
  expect(save).not.toHaveBeenCalled();
  await act(async () => form.handleSubmit(save)());
  expect(save).toHaveBeenCalledTimes(1);
  expect(form.formState.errors.root).toBeUndefined();
});
