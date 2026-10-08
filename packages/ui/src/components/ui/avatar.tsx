'use client';

import * as React from 'react';
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';

import { cn } from '../../lib/utils';

function Avatar({
  className,
  size = 'default',
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: 'default' | 'sm' | 'lg';
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten',
        className
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full rounded-full object-cover', className)}
      {...props}
    />
  );
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-sm text-foreground group-data-[size=sm]/avatar:text-xs',
        className
      )}
      {...props}
    />
  );
}

function AvatarBadge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        'absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none',
        'group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden',
        'group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2',
        'group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
        className
      )}
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
        className
      )}
      {...props}
    />
  );
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
        className
      )}
      {...props}
    />
  );
}

const avatarSizes = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-12',
  lg: 'size-16',
  xl: 'size-24',
} as const;
type AvatarSize = keyof typeof avatarSizes;

/** Canonical 24/32/48/64/96px sizes; legacy Avatar sizes stay unchanged. */
function SizedAvatar({
  size = 'md',
  className,
  ...props
}: Omit<React.ComponentProps<typeof Avatar>, 'size'> & { size?: AvatarSize }) {
  return <Avatar {...props} data-scale={size} className={cn(avatarSizes[size], className)} />;
}
function avatarInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return [parts[0], ...(parts.length > 1 ? [parts.at(-1)] : [])]
    .map((part) => Array.from(part ?? '')[0] ?? '')
    .join('')
    .toUpperCase();
}
function AvatarNameFallback({
  name,
  children,
  className,
  ...props
}: React.ComponentProps<typeof AvatarFallback> & { name: string }) {
  return (
    <AvatarFallback
      {...props}
      className={cn(
        'group-data-[scale=xs]/avatar:text-xs group-data-[scale=md]/avatar:text-base group-data-[scale=lg]/avatar:text-xl group-data-[scale=xl]/avatar:text-3xl',
        className
      )}
    >
      {children ?? avatarInitials(name)}
    </AvatarFallback>
  );
}
function SizedAvatarGroupCount({
  size = 'md',
  className,
  ...props
}: React.ComponentProps<typeof AvatarGroupCount> & { size?: AvatarSize }) {
  return <AvatarGroupCount {...props} className={cn(avatarSizes[size], className)} />;
}
/** The caller owns both the accessible person name and localized presence label. */
function AvatarPresence({
  status,
  statusLabel,
  className,
  ...props
}: React.ComponentProps<typeof SizedAvatar> & {
  status: 'online' | 'offline' | 'busy';
  statusLabel: string;
}) {
  return (
    <SizedAvatar
      {...props}
      data-status={status}
      title={props.title ?? statusLabel}
      aria-description={[props['aria-description'], statusLabel].filter(Boolean).join(', ')}
      className={cn(
        'outline-2 outline-offset-2',
        status === 'online'
          ? 'outline-success'
          : status === 'offline'
            ? 'outline-dashed outline-muted-foreground'
            : 'outline-4 outline-double outline-warning',
        className
      )}
    />
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
  SizedAvatar,
  AvatarNameFallback,
  SizedAvatarGroupCount,
  AvatarPresence,
  avatarInitials,
};
