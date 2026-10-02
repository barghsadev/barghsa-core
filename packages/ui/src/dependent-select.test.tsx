import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DependentSelect } from './components/ui/dependent-select';

let host: HTMLDivElement, root: Root;
const options = [
  { value: 'a1', label: 'City A', dependencyValue: 'a' },
  { value: 'b1', label: 'شهر ب', dependencyValue: 'b' },
];
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
it('filters options and never presents the previous parent selection as current', async () => {
  await act(async () =>
    root.render(
      <DependentSelect dependencyValue="a" value="a1" options={options} placeholder="City" />
    )
  );
  expect(host.querySelector('select')!.value).toBe('a1');
  expect(host.textContent).not.toContain('شهر ب');
  await act(async () =>
    root.render(
      <DependentSelect dependencyValue="b" value="a1" options={options} placeholder="City" />
    )
  );
  expect(host.querySelector('select')!.value).toBe('');
  expect(host.textContent).not.toContain('City A');
  expect(host.textContent).toContain('شهر ب');
});
it.each([
  { dependencyValue: '', ready: true, loading: false },
  { dependencyValue: 'a', ready: false, loading: false },
  { dependencyValue: 'a', ready: true, loading: true },
])('prevents choices while the dependency is unavailable: %j', async (state) => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      <DependentSelect
        {...state}
        value="a1"
        options={options}
        placeholder="City"
        onChange={change}
      />
    )
  );
  const select = host.querySelector('select')!;
  expect(select.disabled).toBe(true);
  expect(select.options.length).toBe(1);
  expect(select.getAttribute('aria-busy')).toBe(state.loading ? 'true' : null);
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
  expect(change).not.toHaveBeenCalled();
});
it('restores a retained draft after async recovery without changing it', async () => {
  const change = vi.fn();
  for (const ready of [false, true]) {
    await act(async () =>
      root.render(
        <DependentSelect
          dependencyValue="b"
          value="b1"
          ready={ready}
          options={options}
          placeholder="شهر"
          onChange={change}
          dir="rtl"
          aria-label="شهر"
          aria-describedby="city-error"
          aria-invalid
        />
      )
    );
    expect(host.querySelector('select')!.value).toBe(ready ? 'b1' : '');
  }
  const select = host.querySelector('select')!;
  expect(select.disabled).toBe(false);
  expect(select.dir).toBe('rtl');
  expect(select.getAttribute('aria-describedby')).toBe('city-error');
  expect(select.getAttribute('aria-invalid')).toBe('true');
  expect(change).not.toHaveBeenCalled();
});
it('allows only a matching option or explicit clearing', async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      <DependentSelect
        dependencyValue="a"
        value=""
        options={options}
        placeholder="City"
        onChange={(event) => change(event.target.value)}
      />
    )
  );
  const select = host.querySelector('select')!;
  for (const value of ['a1', '']) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  const forged = document.createElement('option');
  forged.value = 'b1';
  select.append(forged);
  await act(async () => {
    select.value = 'b1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(change.mock.calls).toEqual([['a1'], ['']]);
});
it('displays a saved inactive city only under its original province', async () => {
  const savedOption = { value: 'old', label: 'Saved city', dependencyValue: 'a' };
  for (const dependencyValue of ['a', 'b']) {
    await act(async () =>
      root.render(
        <DependentSelect
          dependencyValue={dependencyValue}
          value="old"
          options={options}
          placeholder="City"
          savedOption={savedOption}
        />
      )
    );
    const select = host.querySelector('select')!;
    expect(select.value).toBe(dependencyValue === 'a' ? 'old' : '');
    expect(select.querySelector('option[value="old"]')?.hasAttribute('disabled')).toBe(
      dependencyValue === 'a' ? true : undefined
    );
  }
});
it('honors the owning form disabled state after the catalogue is ready', async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      <DependentSelect
        dependencyValue="a"
        value="a1"
        options={options}
        placeholder="City"
        disabled
        onChange={change}
      />
    )
  );
  const select = host.querySelector('select')!;
  expect(select.disabled).toBe(true);
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
  expect(change).not.toHaveBeenCalled();
});
it('keeps an empty saved location as the placeholder, without a duplicate unknown option', async () => {
  await act(async () =>
    root.render(
      <DependentSelect
        dependencyValue=""
        value=""
        options={[]}
        placeholder="City"
        savedOption={{ value: '', label: 'Unknown', dependencyValue: '' }}
      />
    )
  );
  expect(host.querySelector('select')!.options.length).toBe(1);
  expect(host.textContent).toBe('City');
});
