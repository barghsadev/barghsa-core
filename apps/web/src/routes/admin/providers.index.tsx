import { createFileRoute, redirect } from '@tanstack/react-router';
import { providerDestination, validProviderId } from '../../lib/provider-workspace.js';

export const Route = createFileRoute('/admin/providers/')({
  validateSearch: (search: Record<string, unknown>) => ({
    channel: search.channel === 'sms' ? ('sms' as const) : ('email' as const),
    panel: search.panel,
    selected: search.selected,
  }),
  beforeLoad: ({ search: { channel, panel, selected } }) => {
    const selection =
      panel === 'new'
        ? ({ panel } as const)
        : validProviderId(selected) &&
            (panel === 'edit' || (channel === 'sms' && (panel === 'clone' || panel === 'preview')))
          ? { panel, id: selected }
          : undefined;
    throw redirect({ ...providerDestination(channel, selection), replace: true });
  },
});
