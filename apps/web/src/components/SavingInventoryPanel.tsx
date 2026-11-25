import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
  recordEditorGrid,
} from './RecordEditorLayout.js';
import { CommandFeedback } from './CommandFeedback.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { useCallback, type ReactNode } from 'react';
import { LoadingStatus, Button, ListRefreshButton, Input, Label, Alert } from '@barghsa/ui';
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
  standalone = false,
  onProductRefresh,
  heading,
  ...props
}: CatalogueEditorProps & {
  hardwareId: string;
  standalone?: boolean;
  onProductRefresh?: () => void;
  heading?: ReactNode;
}) {
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
    <section className="space-y-3" aria-label={label('inventory')}>
      {standalone && (
        <RecordCommandGuard blocked={() => editor.commandPending || editor.uncertain} />
      )}
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        {heading ??
          (!standalone && <h2 className="text-lg font-semibold">{label('inventory')}</h2>)}
        <ListRefreshButton
          label={label(editor.resource.error || editor.denied ? 'retry' : 'refresh')}
          disabled={
            props.disabled ||
            !!editor.action ||
            editor.commandPending ||
            (!onProductRefresh && editor.pending)
          }
          onClick={editor.pending && onProductRefresh ? onProductRefresh : editor.refresh}
        />
      </header>
      {editor.denied && <Alert variant="destructive">{label('denied')}</Alert>}
      {editor.resource.error && <Alert variant="destructive">{label('inventoryLoadError')}</Alert>}
      {editor.resource.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
      <CommandFeedback message={editor.saved ? label('saved') : null} />
      {editor.uncertain && <Alert variant="destructive">{label('unverifiedSaving')}</Alert>}
      {inventory && (
        <form
          aria-label={label('inventory')}
          noValidate
          aria-busy={editor.pending || undefined}
          className={recordEditorSurface}
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
          {rootError && (
            <Alert variant="destructive" className="m-4">
              {rootError}
            </Alert>
          )}
          <fieldset disabled={editor.disabled} className="min-w-0">
            <legend className="sr-only">{label('inventory')}</legend>
            {standalone && (
              <RecordEditorSection title={label('currentInventory')}>
                {inventory.stockTracking ? (
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    {(
                      [
                        ['savedStockCount', inventory.stockCount],
                        ['reservedCount', inventory.reservedCount],
                        ['availableStockCount', inventory.stockCount - inventory.reservedCount],
                      ] as const
                    ).map(([key, value]) => (
                      <div key={key} className="min-w-0 rounded-lg bg-muted/45 px-2 py-2 sm:px-3">
                        <dt className="text-muted-foreground">{label(key)}</dt>
                        <dd className="mt-1 font-semibold tabular-nums">
                          <bdi>{numbers.number(value)}</bdi>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{label('inventoryTrackingOff')}</p>
                )}
              </RecordEditorSection>
            )}
            <RecordEditorSection title={label('stockSettings')}>
              <div className={recordEditorField}>
                <label
                  className="flex min-h-8 w-fit cursor-pointer items-center gap-2"
                  htmlFor="saving-stock-tracking"
                >
                  <input
                    id="saving-stock-tracking"
                    type="checkbox"
                    className="size-4 accent-primary"
                    {...editor.bind('stockTracking')}
                    checked={tracking}
                    onChange={(event) => setTracking(event.target.checked)}
                  />
                  {label('trackStock')}
                </label>
                {(!standalone || editor.errors.stockTracking) && editor.feedback('stockTracking')}
              </div>
              <div className={recordEditorGrid}>
                <div className={recordEditorField}>
                  <Label htmlFor="saving-stock-count">{label('stockCount')}</Label>
                  <Input
                    id="saving-stock-count"
                    {...editor.bind('stockCount')}
                    dir="ltr"
                    inputMode="numeric"
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                  />
                  {(!standalone || editor.errors.stockCount) && editor.feedback('stockCount')}
                </div>
                <div className={recordEditorField}>
                  <Label htmlFor="saving-reservation-minutes">{label('reservationMinutes')}</Label>
                  <Input
                    id="saving-reservation-minutes"
                    {...editor.bind('reservationMinutes')}
                    dir="ltr"
                    inputMode="numeric"
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                  />
                  {(!standalone || editor.errors.reservationMinutes) &&
                    editor.feedback('reservationMinutes')}
                </div>
              </div>
              {standalone ? (
                <p className="text-sm text-muted-foreground">{label('reservationPeriodHelp')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {label('reservedCount')}: <bdi>{numbers.number(inventory.reservedCount)}</bdi>
                </p>
              )}
            </RecordEditorSection>
            <RecordEditorActions>
              <Button type="submit" aria-busy={editor.pending || undefined}>
                {editor.pending && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {label(editor.pending ? 'working' : 'saveInventory')}
              </Button>
            </RecordEditorActions>
          </fieldset>
        </form>
      )}
      {editor.action && command && (
        <TeamActionDialog
          action={editor.action}
          toastErrors={!standalone}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
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
