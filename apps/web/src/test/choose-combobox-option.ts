import { act } from 'react';
import { fireEvent, within } from '@testing-library/react';

export async function chooseComboboxOption(input: HTMLInputElement, title: string) {
  await act(async () => {
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
  });
  const option = await within(document.body).findByRole('option', { name: title });
  await act(async () => fireEvent.click(option));
}
