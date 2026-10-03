import { useCallback } from 'react';
import { Button, Input, Label, Alert } from '@barghsa/ui';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor, type CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';
import {
  inventoryDefaults,
  inventoryValues,
  inventoryBasis,
  inventoryInteger,
  validInventory,
  matchesInventoryReceipt,
  type Inventory,
  type InventoryDraft,
} from '../lib/saving-catalogue-form.js';
import { TeamActionDialog } from './TeamActionDialog.js';

export function SavingInventoryPanel({
  hardwareId,
  ...props
}: CatalogueEditorProps & { hardwareId: string }) {
  const locale = useLocale();
  const label = (key: string) => tCatalogue(key, locale);
  const numbers = useNumberFormatting(locale);
  const path = `/api/admin/catalogue/hardware/${encodeURIComponent(hardwareId)}/inventory`;
  const validate = useCallback(
    (value: unknown): value is Inventory =>
      validInventory(value) && value.hardwareId === hardwareId,
    [hardwareId]
  );
  const messages = {
    stockTracking: label('invalidStockTracking'),
    stockCount: label('invalidStockCount'),
    reservationMinutes: label('invalidReservationMinutes'),
  };
  const editor = useCatalogueEditor<Inventory, InventoryDraft>({
    ...props,
    identity: hardwareId,
    path,
    validate,
    basis: inventoryBasis,
    defaults: inventoryDefaults,
    values: inventoryValues,
    messages,
    label,
    schema: async (inventory) => {
      const reserved = inventory?.reservedCount ?? 0;
      const { inventoryFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return inventoryFormSchema(reserved, messages, inventoryInteger);
    },
  });
  const rootError = editor.errors.root?.validation?.message ?? editor.errors.root?.message;
  const inventory = editor.resource.data;
  const [tracking, setTracking] = editor.field('stockTracking'),
    [count, setCount] = editor.field('stockCount'),
    [minutes, setMinutes] = editor.field('reservationMinutes');
  const command = editor.action?.body as
    { stockTracking: boolean; stockCount: number; reservationMinutes: number } | undefined;
  return (
    <section className="space-y-3 border-y py-5" aria-label={label('inventory')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{label('inventory')}</h2>
        <Button
          type="button"
          variant="outline"
          disabled={editor.busy || props.disabled}
          onClick={editor.refresh}
        >
          {label(editor.resource.error || editor.denied ? 'retry' : 'refresh')}
        </Button>
      </div>
      {editor.denied && <Alert variant="destructive">{label('denied')}</Alert>}
      {editor.resource.error && <Alert variant="destructive">{label('inventoryLoadError')}</Alert>}
      {editor.resource.loading && <p role="status">{label('loading')}</p>}
      {editor.saved && <p role="status">{label('saved')}</p>}
      {editor.uncertain && <Alert variant="destructive">{label('unverifiedSaving')}</Alert>}
      {inventory && (
        <form
          aria-label={label('inventory')}
          noValidate
          aria-busy={editor.pending || undefined}
          className="space-y-3"
          onSubmit={(event) =>
            void editor.submit(event, (values) => ({
              path,
              method: 'PUT',
              body: {
                stockTracking: values.stockTracking,
                stockCount: inventoryInteger(values.stockCount, 0, 1_000_000),
                reservationMinutes: inventoryInteger(values.reservationMinutes, 5, 10080),
              },
              title: label('saveInventory'),
              description: label('confirmInventory'),
              conflictMessage: label('inventoryConflict'),
              forbiddenMessage: label('denied'),
            }))
          }
        >
          {rootError && <Alert variant="destructive">{rootError}</Alert>}
          <p>
            {label('reservedCount')}: <bdi>{numbers.number(inventory.reservedCount)}</bdi>
          </p>
          <fieldset disabled={editor.disabled} className="min-w-0 space-y-3 border-0 p-0">
            <div>
              <label className="flex items-center gap-2" htmlFor="saving-stock-tracking">
                <input
                  id="saving-stock-tracking"
                  type="checkbox"
                  {...editor.bind('stockTracking')}
                  checked={tracking}
                  onChange={(event) => setTracking(event.target.checked)}
                />
                {label('trackStock')}
              </label>
              {editor.feedback('stockTracking')}
            </div>
            <div>
              <Label htmlFor="saving-stock-count">{label('stockCount')}</Label>
              <Input
                id="saving-stock-count"
                {...editor.bind('stockCount')}
                dir="ltr"
                inputMode="numeric"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
              {editor.feedback('stockCount')}
            </div>
            <div>
              <Label htmlFor="saving-reservation-minutes">{label('reservationMinutes')}</Label>
              <Input
                id="saving-reservation-minutes"
                {...editor.bind('reservationMinutes')}
                dir="ltr"
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
              {editor.feedback('reservationMinutes')}
            </div>
            <Button type="submit" aria-busy={editor.pending || undefined}>
              {editor.pending && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {label(editor.pending ? 'working' : 'saveInventory')}
            </Button>
          </fieldset>
        </form>
      )}
      {editor.action && command && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onValidationError={editor.onValidationError}
          summary={
            <div className="space-y-2 rounded-md border p-3">
              <p>
                {label('trackStock')}: {label(command.stockTracking ? 'enabled' : 'disabled')}
              </p>
              <p>
                {label('stockCount')}: <bdi>{numbers.number(command.stockCount)}</bdi>
              </p>
              <p>
                {label('reservationMinutes')}:{' '}
                <bdi>{numbers.number(command.reservationMinutes)}</bdi>
              </p>
              {editor.uncertain && <Alert variant="destructive">{label('unverifiedSaving')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            const captured = {
              stockTracking: command.stockTracking,
              stockCount: String(command.stockCount),
              reservationMinutes: String(command.reservationMinutes),
            };
            if (!editor.verifyReceipt(matchesInventoryReceipt(result, hardwareId, captured)))
              return;
            editor.resource.accept(result as Inventory);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
