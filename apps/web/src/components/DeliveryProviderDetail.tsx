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
  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <h2 className="text-xl font-semibold">
          <TextCell value={provider.label} />
        </h2>
        <dl className="grid gap-4 border-y py-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div key={field.id} className="min-w-0 space-y-1 text-sm">
              <dt className="font-medium text-muted-foreground">{field.label}</dt>
              <dd className="wrap-anywhere">{field.render(provider)}</dd>
            </div>
          ))}
        </dl>
        {children}
      </CardContent>
    </Card>
  );
}
