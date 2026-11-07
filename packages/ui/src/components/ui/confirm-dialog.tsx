import { useRef, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';
import {
  ConfirmationFields,
  useConfirmationGate,
  type ConfirmationRequirements,
} from './confirmation-gate';

export interface ConfirmDialogProps extends ConfirmationRequirements {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  destructive?: boolean;
  variant?: 'primary' | 'destructive' | 'warning';
  /** Captured target/review identity; changing it withdraws previous approval. */
  scope?: unknown;
  children?: ReactNode;
  /** The caller supplies translated phrase instructions, including the exact phrase. */
}
/** Controlled dialog. Keep errors in children and close only after a verified write. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.loading) props.onCancel();
      }}
    >
      <ConfirmContent key={String(props.open)} {...props} />
    </Dialog>
  );
}
function ConfirmContent({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading = false,
  destructive = false,
  variant = destructive ? 'destructive' : 'primary',
  scope,
  confirmation,
  acknowledgement,
  children,
}: ConfirmDialogProps) {
  const gate = useConfirmationGate(scope, { confirmation, acknowledgement });
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <DialogContent
      showCloseButton={false}
      initialFocus={cancel}
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <ConfirmationFields gate={gate} disabled={loading} />
      <DialogFooter>
        <Button ref={cancel} variant="outline" disabled={loading} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === 'primary' ? 'default' : variant}
          loading={loading}
          disabled={!gate.allowed}
          onClick={() => {
            if (!loading && gate.allowed) onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function DestructiveConfirmDialog(
  props: Omit<ConfirmDialogProps, 'variant' | 'destructive'> & {
    confirmation: NonNullable<ConfirmDialogProps['confirmation']>;
  }
) {
  return <ConfirmDialog {...props} variant="destructive" />;
}

export function FinancialConfirmDialog(
  props: Omit<ConfirmDialogProps, 'variant'> & {
    acknowledgement: string;
    children: ReactNode;
  }
) {
  return <ConfirmDialog {...props} variant={props.destructive ? 'destructive' : 'warning'} />;
}
