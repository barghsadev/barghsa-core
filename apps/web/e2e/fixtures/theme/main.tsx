import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../../../packages/ui/src/components/ui/button';
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from '../../../../../packages/ui/src/components/ui/alert';
import { BrandThemeProvider } from '../../../src/providers/BrandThemeProvider';
const locale = new URLSearchParams(location.search).has('fa') ? 'fa' : 'en';
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
createRoot(document.getElementById('root')!).render(
  <BrandThemeProvider>
    <main className="flex flex-col gap-4 p-6">
      <h1>Theme checks</h1>
      {(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const).map(
        (variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        )
      )}
      <Alert variant="destructive">
        <AlertTitle>{locale === 'fa' ? 'ذخیره انجام نشد' : 'Could not save'}</AlertTitle>
        <AlertDescription>{locale === 'fa' ? 'دوباره تلاش کنید.' : 'Try again.'}</AlertDescription>
      </Alert>
    </main>
  </BrandThemeProvider>
);
