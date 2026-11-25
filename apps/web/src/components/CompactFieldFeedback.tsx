import { FormDescription, FormMessage } from '@barghsa/ui/form';

export function CompactFieldFeedback({
  help,
  validationMessage,
  invalid,
}: {
  help: string;
  validationMessage: string;
  invalid: boolean;
}) {
  // Leave the action button in place when a pointer click triggers validation on blur.
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
      <FormDescription className={`col-start-1 row-start-1 ${invalid ? 'opacity-0' : ''}`}>
        {help}
      </FormDescription>
      <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
        {validationMessage}
      </p>
      <FormMessage className="col-start-1 row-start-1" />
    </div>
  );
}
