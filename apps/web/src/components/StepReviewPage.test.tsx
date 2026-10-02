import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StepReviewPage } from './StepReviewPage.js';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: gives each section a unique heading and edit action without exposing editable values`, async () => {
    const edit = vi.fn();
    const labels =
      locale === 'fa'
        ? ['بررسی', 'ویرایش', 'هویت', 'قیمت']
        : ['Review', 'Edit', 'Identity', 'Price'];
    await act(async () =>
      root.render(
        <StepReviewPage
          title={labels[0]!}
          editLabel={labels[1]!}
          onEdit={edit}
          sections={[
            {
              id: 'identity',
              title: labels[2]!,
              step: 1,
              rows: [{ label: 'Name', value: '<img src=x onerror=alert(1)>' }],
            },
            {
              id: 'price',
              title: labels[3]!,
              rows: [{ label: 'Total', value: '90071992547409930001 IRR' }],
            },
          ]}
        />
      )
    );
    expect(container.querySelectorAll('input,textarea,select,img')).toHaveLength(0);
    expect(container.querySelectorAll('h3')).toHaveLength(2);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('90071992547409930001 IRR');
    const button = container.querySelector('button')!;
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(`${labels[1]} ${labels[2]}`);
    await act(async () => button.click());
    expect(edit).toHaveBeenCalledExactlyOnceWith(1);
  });
}
it('keeps edit actions disabled while the form is saving or submitting', async () => {
  const edit = vi.fn();
  await act(async () =>
    root.render(
      <StepReviewPage
        title="Review"
        editLabel="Edit"
        onEdit={edit}
        disabled
        sections={[
          {
            id: 'address',
            title: 'Address',
            step: 4,
            rows: [{ label: 'Address', value: 'Saved street' }],
          },
        ]}
      />
    )
  );
  const button = container.querySelector('button')!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(edit).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Saved street');
});
