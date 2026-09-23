import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface SavingHardwareUpgrade {
  id: string;
  status: 'awaiting_payment' | 'applied' | 'cancelled' | 'expired';
  createdAt: string;
  reason: string;
  priceDeltaIrR: string;
  adjustmentInvoiceId: string;
  invoiceState: string;
  paidIrR: string;
  previousTitle: { fa: string; en: string };
  hardwareTitle: { fa: string; en: string };
}

export function SavingHardwareUpgradeHistory({
  upgrades,
  onCancel,
}: {
  upgrades: SavingHardwareUpgrade[];
  onCancel?: (upgrade: SavingHardwareUpgrade, reason: string) => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [cancelReason, setCancelReason] = useState('');
  if (upgrades.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h2 className="text-xl font-semibold">{copy('hardwareUpgrades')}</h2>
        <ol className="space-y-4">
          {upgrades.map((upgrade) => (
            <li key={upgrade.id} className="border-s-2 border-primary/40 ps-4 text-sm">
              <p className="font-medium">
                {upgrade.previousTitle[locale]}{' '}
                <span aria-hidden="true">{locale === 'fa' ? '←' : '→'}</span>{' '}
                {upgrade.hardwareTitle[locale]}
              </p>
              <p>{copy(`hardwareUpgrade.${upgrade.status}`)}</p>
              <p>
                {copy('hardwareAdditionalCharge')}:{' '}
                <bdi>{numbers.money(upgrade.priceDeltaIrR)}</bdi>{' '}
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: upgrade.adjustmentInvoiceId }}
                  className="text-primary underline"
                >
                  {copy('invoice')}
                </Link>
              </p>
              <p className="whitespace-pre-wrap text-muted-foreground">{upgrade.reason}</p>
              {upgrade.status === 'awaiting_payment' &&
                upgrade.paidIrR === '0' &&
                ['Unpaid', 'Overdue'].includes(upgrade.invoiceState) &&
                onCancel && (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor={`saving-upgrade-cancel-${upgrade.id}`}>
                      {copy('staffAmendReason')}
                    </Label>
                    <Input
                      id={`saving-upgrade-cancel-${upgrade.id}`}
                      value={cancelReason}
                      maxLength={1000}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={!cancelReason.trim()}
                      onClick={() => onCancel(upgrade, cancelReason.trim())}
                    >
                      {copy('hardwareUpgradeCancel')}
                    </Button>
                  </div>
                )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
