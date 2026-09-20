import { useRef, useState, useId, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  destructive?: boolean;
  children?: ReactNode;
  /** The caller supplies translated phrase instructions, including the exact phrase. */
  confirmation?: { phrase: string; label: string };
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
  confirmation,
  children,
}: ConfirmDialogProps) {
  const [phrase, setPhrase] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <DialogContent showCloseButton={false} initialFocus={cancel}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      {confirmation ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>{confirmation.label}</Label>
          <Input
            id={id}
            autoComplete="off"
            value={phrase}
            disabled={loading}
            onChange={(event) => setPhrase(event.target.value)}
          />
        </div>
      ) : null}
      <DialogFooter>
        <Button ref={cancel} variant="outline" disabled={loading} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          loading={loading}
          disabled={Boolean(
            confirmation && (!confirmation.phrase || phrase !== confirmation.phrase)
          )}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
