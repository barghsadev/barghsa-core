import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

interface Inventory {
  stockTracking: boolean;
  stockCount: number;
  reservedCount: number;
  reservationMinutes: number;
}
export function SavingInventoryPanel({ hardwareId }: { hardwareId: string }) {
  const locale = useLocale();
  const label = (key: string) => tCatalogue(key, locale);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [tracking, setTracking] = useState(false);
  const [count, setCount] = useState('0');
  const [minutes, setMinutes] = useState('1440');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const path = `/api/admin/catalogue/hardware/${encodeURIComponent(hardwareId)}/inventory`;
  useEffect(() => {
    const controller = new AbortController();
    setInventory(null);
    setError(false);
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('inventory');
        return response.json() as Promise<Inventory>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setInventory(value);
        setTracking(value.stockTracking);
        setCount(String(value.stockCount));
        setMinutes(String(value.reservationMinutes));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [path, revision]);
  function save(event: FormEvent) {
    event.preventDefault();
    const stockCount = Number(count),
      reservationMinutes = Number(minutes);
    if (
      !Number.isInteger(stockCount) ||
      stockCount < (inventory?.reservedCount ?? 0) ||
      stockCount > 1_000_000 ||
      !Number.isInteger(reservationMinutes) ||
      reservationMinutes < 5 ||
      reservationMinutes > 10080
    )
      return;
    setAction({
      title: label('saveInventory'),
      description: label('confirmInventory'),
      path,
      method: 'PUT',
      body: { stockTracking: tracking, stockCount, reservationMinutes },
      conflictMessage: label('inventoryConflict'),
      forbiddenMessage: label('denied'),
    });
  }
  return (
    <section className="space-y-3 border-y py-5" aria-label={label('inventory')}>
      <h2 className="text-xl font-semibold">{label('inventory')}</h2>
      {error && <p role="alert">{label('error')}</p>}
      {!inventory && !error && <p role="status">{label('loading')}</p>}
      {inventory && (
        <form onSubmit={save} className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={tracking}
              onChange={(e) => setTracking(e.target.checked)}
            />
            {label('trackStock')}
          </label>
          <p>
            {label('reservedCount')}: {inventory.reservedCount}
          </p>
          <div>
            <Label htmlFor="saving-stock-count">{label('stockCount')}</Label>
            <Input
              id="saving-stock-count"
              type="number"
              min={inventory.reservedCount}
              max={1000000}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="saving-reservation-minutes">{label('reservationMinutes')}</Label>
            <Input
              id="saving-reservation-minutes"
              type="number"
              min={5}
              max={10080}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={!tracking && inventory.reservedCount > 0}>
            {label('saveInventory')}
          </Button>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
