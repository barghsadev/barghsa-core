import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { BrandThemeProvider } from '../providers/BrandThemeProvider.js';
import { UiDirectionProvider } from '../providers/UiDirectionProvider.js';
import { QueryProvider } from './query-provider.js';

function WorkspaceProviders({ accountId, children }: { accountId: string; children: ReactNode }) {
  return (
    <QueryProvider>
      <UiDirectionProvider>
        <BrandThemeProvider>
          <AccountUserProvider value={accountId}>{children}</AccountUserProvider>
        </BrandThemeProvider>
      </UiDirectionProvider>
    </QueryProvider>
  );
}

export function renderWorkspace(
  element: ReactElement,
  container: HTMLElement,
  accountId: string
): RenderResult {
  return render(<WorkspaceProviders accountId={accountId}>{element}</WorkspaceProviders>, {
    container,
  });
}
