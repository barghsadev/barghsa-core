import { act } from 'react';

export async function openManualRecordDateTime(id: string) {
  if (document.getElementById(id) instanceof HTMLInputElement) return;
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(`button[aria-controls="date-time-entry-${id}"]`)!
      .click()
  );
}
