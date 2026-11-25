import { createFileRoute, redirect } from '@tanstack/react-router';
import { wizardStepSearch } from '../../lib/wizard-step.js';

export const Route = createFileRoute('/_app/savings/order')({
  validateSearch: (search: Record<string, unknown>) => ({ step: search.step }),
  beforeLoad: ({ search }) => {
    const { step } = wizardStepSearch(search, 6);
    throw redirect({
      to: '/savings/orders/new',
      search: search.step === undefined ? {} : { step: Math.ceil((step ?? 1) / 2) },
      replace: true,
    });
  },
});
