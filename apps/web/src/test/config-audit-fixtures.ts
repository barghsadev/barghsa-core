import type { ConfigAuditPage, ConfigAuditScope } from '@barghsa/shared/admin';
export const configAuditEntry = {
  id: '01900000-0000-7000-8000-000000000001',
  actorId: 'staff-auditor',
  createdAt: '2026-09-30T12:00:00.000001Z',
  event: 'updated' as const,
  version: 2,
  detailsAvailable: true,
  changes: [
    {
      field: 'ttlSeconds',
      previous: { recorded: true, value: 300 },
      current: { recorded: true, value: 600 },
    },
  ],
};
export const configAuditCursor = 'reviewed_cursor_2';
export function configAuditPage(scope: ConfigAuditScope = 'otp'): ConfigAuditPage {
  const field = scope === 'branding' ? 'appTitle' : scope === 'otp' ? 'ttlSeconds' : 'ticket';
  return {
    scope,
    items: [
      {
        ...configAuditEntry,
        changes: [
          {
            field,
            previous: { recorded: true, value: scope === 'branding' ? 'Old title' : 300 },
            current: {
              recorded: true,
              value: scope === 'branding' ? '<script>Reviewed title</script>' : 600,
            },
          },
        ],
      },
    ],
    nextCursor: configAuditCursor,
  };
}
