import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button } from './button';
import { cn } from '../../lib/utils';

export type DynamicFieldArrayProps<T> = Omit<ComponentProps<'div'>, 'children' | 'onChange'> & {
  value: readonly T[];
  onChange: (items: T[]) => void;
  /** Keys must be unique and remain unchanged when an item moves. */
  getItemKey: (item: T) => string;
  renderItem: (item: T, index: number, actions: ReactNode) => ReactNode;
  removeLabel: (item: T, index: number) => string;
  moveUpLabel: (item: T, index: number) => string;
  moveDownLabel: (item: T, index: number) => string;
  createItem?: () => T;
  addLabel?: string;
  getItemError?: (item: T, index: number) => ReactNode;
  minItems?: number;
  maxItems?: number;
  disabled?: boolean;
  reorder?: boolean;
  /** Focus the existing picker/editor when an externally added list becomes empty. */
  emptyFocusRef?: RefObject<HTMLElement | null>;
};

/** Controlled items keep their fields, validation and server transactions with the form. */
export function DynamicFieldArray<T>({
  value,
  onChange,
  getItemKey,
  renderItem,
  removeLabel,
  moveUpLabel,
  moveDownLabel,
  createItem,
  addLabel,
  getItemError,
  minItems = 0,
  maxItems = Infinity,
  disabled = false,
  reorder = true,
  emptyFocusRef,
  className,
  ...props
}: DynamicFieldArrayProps<T>) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  const add = useRef<HTMLButtonElement>(null);
  const focus = useRef<{ key: string | null; action?: 'up' | 'down' } | null>(null);
  useLayoutEffect(() => {
    const pending = focus.current;
    if (!pending) return;
    focus.current = null;
    const row = pending.key === null ? undefined : rows.current.get(pending.key);
    const target =
      (pending.action &&
        row?.querySelector<HTMLButtonElement>(
          `button[data-array-action="${pending.action}"]:not(:disabled)`
        )) ||
      row?.querySelector<HTMLElement>(
        pending.action
          ? 'button[data-array-action]:not(:disabled)'
          : 'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
      );
    (target || add.current || emptyFocusRef?.current)?.focus();
  }, [value, emptyFocusRef]);

  function remove(index: number) {
    if (disabled || value.length <= minItems) return;
    const next = value.filter((_, position) => position !== index);
    focus.current = {
      key: next.length ? getItemKey(next[Math.min(index, next.length - 1)]!) : null,
    };
    onChange(next);
  }
  function move(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (disabled || !reorder || destination < 0 || destination >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(destination, 0, item!);
    focus.current = { key: getItemKey(item!), action: offset === -1 ? 'up' : 'down' };
    onChange(next);
  }

  return (
    <div
      {...props}
      data-slot="dynamic-field-array"
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <div role="list" className="flex min-w-0 flex-col gap-3">
        {value.map((item, index) => {
          const key = getItemKey(item);
          const error = getItemError?.(item, index);
          const actions = (
            <div className="flex flex-wrap items-center gap-1">
              {reorder && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-array-action="up"
                    disabled={disabled || index === 0}
                    aria-label={moveUpLabel(item, index)}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-array-action="down"
                    disabled={disabled || index === value.length - 1}
                    aria-label={moveDownLabel(item, index)}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                data-array-action="remove"
                disabled={disabled || value.length <= minItems}
                aria-label={removeLabel(item, index)}
                onClick={() => remove(index)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          );
          return (
            <div
              key={key}
              role="listitem"
              ref={(element) => {
                if (element) rows.current.set(key, element);
                else rows.current.delete(key);
              }}
              className="min-w-0"
            >
              {renderItem(item, index, actions)}
              {error && (
                <div role="alert" className="mt-2 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {createItem && addLabel && (
        <Button
          ref={add}
          type="button"
          variant="outline"
          className="self-start"
          disabled={disabled || value.length >= maxItems}
          onClick={() => {
            if (disabled || value.length >= maxItems) return;
            const item = createItem();
            focus.current = { key: getItemKey(item) };
            onChange([...value, item]);
          }}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}
