import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryProvider } from './query-provider.js';

export function renderAuthForm(element: ReactElement, container: HTMLElement): RenderResult {
  return render(element, { container, wrapper: QueryProvider });
}
