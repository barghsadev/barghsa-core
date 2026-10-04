import type { ComponentProps, ReactNode } from 'react';
import { MoreHorizontalIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { StatusBadge } from '../ui/workflow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function TextCell({ value }: { value: string | null | undefined }) {
  return (
    <span className="break-words [overflow-wrap:anywhere]">
      <bdi>{value ?? '—'}</bdi>
    </span>
  );
}

export function NumberCell({
  value,
  locale = 'en',
  numerals,
  options,
}: {
  value: number | bigint | null | undefined;
  locale?: 'en' | 'fa';
  numerals?: 'latn' | 'arabext';
  options?: Omit<Intl.NumberFormatOptions, 'numberingSystem'>;
}) {
  const valid = typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value));
  return (
    <bdi className="tabular-nums">
      {valid
        ? new Intl.NumberFormat(locale, {
            ...options,
            numberingSystem: numerals ?? (locale === 'fa' ? 'arabext' : 'latn'),
          }).format(value!)
        : '—'}
    </bdi>
  );
}

/** The owner supplies account timezone/locale formatting, including relative dates. */
export function DateCell({
  value,
  format,
  mode = 'absolute',
}: {
  value: string | number | Date | null | undefined;
  format: (value: string | number | Date, mode: 'absolute' | 'relative') => string;
  mode?: 'absolute' | 'relative';
}) {
  const date = value == null ? null : new Date(value);
  if (!date || !Number.isFinite(date.getTime())) return <span>—</span>;
  return (
    <time dateTime={date.toISOString()}>
      <bdi>{format(value!, mode)}</bdi>
    </time>
  );
}

export function StatusCell(props: ComponentProps<typeof StatusBadge>) {
  return <StatusBadge {...props} />;
}

/** Use the owner's exact IRR/toman formatter; never convert money through Number. */
export function CurrencyCell({
  amount,
  format,
}: {
  amount: string | number | bigint | null | undefined;
  format: (amount: string | number | bigint) => string;
}) {
  return (
    <bdi className="tabular-nums break-words [overflow-wrap:anywhere]">
      {amount == null ? '—' : format(amount)}
    </bdi>
  );
}

function safeHref(value: string | null | undefined) {
  if (
    !value ||
    value !== value.trim() ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\'
    )
  )
    return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (value.startsWith('#')) return value;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !parsed.username &&
      !parsed.password
    )
      return parsed.href;
  } catch {
    /* Invalid or executable URLs are displayed as ordinary text. */
  }
  return null;
}

export function LinkCell({
  href,
  children,
}: {
  href: string | null | undefined;
  children: ReactNode;
}) {
  const target = safeHref(href);
  return target ? (
    <a
      href={target}
      className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <bdi>{children}</bdi>
    </a>
  ) : (
    <span>
      <bdi>{children}</bdi>
    </span>
  );
}

export function AvatarCell({ name, src }: { name: string; src?: string | null }) {
  const image = safeHref(src);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar size="sm" aria-hidden="true">
        {image && <AvatarImage src={image} alt="" />}
        <AvatarFallback>{Array.from(name.trim())[0] ?? '—'}</AvatarFallback>
      </Avatar>
      <TextCell value={name} />
    </span>
  );
}

export interface CellAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function ActionCell({
  label,
  actions,
  disabled = false,
}: {
  label: string;
  actions: CellAction[];
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || !actions.length}
        aria-label={label}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            disabled={disabled || action.disabled}
            variant={action.destructive ? 'destructive' : 'default'}
            onClick={() => {
              if (!disabled && !action.disabled) action.onSelect();
            }}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
