import '@barghsa/ui/styles.css';
import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';
import { restoreEntryLocale } from './lib/entry-locale.js';
import { QueryProvider } from './providers/QueryProvider.js';

const QueryRoot = __BARGHSA_AUTH_ENTRY__ ? Fragment : QueryProvider;

restoreEntryLocale();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <QueryRoot>
      <RouterProvider router={router} />
    </QueryRoot>
  </StrictMode>
);
