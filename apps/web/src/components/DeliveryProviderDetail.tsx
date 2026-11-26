import type { ReactNode } from 'react';
import { Card, CardContent, TextCell } from '@barghsa/ui';

export function DeliveryProviderDetail<T extends { label: string }>({
  provider,
  fields,
  children,
}: {
  provider: T;
  fields: { id: string; label: string; render: (row: T) => ReactNode }[];
  children: ReactNode;
}) {
  const status = fields.find((field) => field.id === 'status');
  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <h2 className="text-xl font-semibold">
          <TextCell value={provider.label} />
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {status && (
            <div className="min-w-0 space-y-2 rounded-lg bg-muted/45 p-3 text-sm sm:col-span-full">
              <dt className="font-medium text-muted-foreground">{status.label}</dt>
              <dd className="wrap-anywhere">{status.render(provider)}</dd>
            </div>
          )}
          {fields
            .filter((field) => field.id !== 'status')
            .map((field) => (
              <div key={field.id} className="min-w-0 space-y-1 text-sm">
                <dt className="font-medium text-muted-foreground">{field.label}</dt>
                <dd className="wrap-anywhere">{field.render(provider)}</dd>
              </div>
            ))}
        </dl>
        <div className="border-t pt-4">{children}</div>
      </CardContent>
    </Card>
  );
}
