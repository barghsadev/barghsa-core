'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';

function Textarea({ className, ref, onInput, ...props }: React.ComponentProps<'textarea'>) {
  const input = React.useRef<HTMLTextAreaElement>(null);
  const nativeSizing =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('field-sizing', 'content');
  React.useImperativeHandle(ref, () => input.current!, []);
  const resize = React.useCallback(() => {
    const node = input.current;
    if (!node || nativeSizing || props.style?.height !== undefined) return;
    node.style.height = 'auto';
    node.style.height = node.scrollHeight + node.offsetHeight - node.clientHeight + 'px';
  }, [nativeSizing, props.style?.height]);
  React.useEffect(() => {
    resize();
  }, [props.value, props.defaultValue, resize]);
  React.useEffect(() => {
    const node = input.current;
    if (!node || nativeSizing) return;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      clearTimeout(resetTimer);
      // A trusted reset may run microtasks before its native default action.
      resetTimer = setTimeout(resize, 0);
    };
    const form = node.form;
    form?.addEventListener('reset', reset);
    let width = node.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (node.clientWidth !== width) {
              width = node.clientWidth;
              resize();
            }
          });
    observer?.observe(node);
    return () => {
      clearTimeout(resetTimer);
      form?.removeEventListener('reset', reset);
      observer?.disconnect();
    };
  }, [nativeSizing, props.form, resize]);
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-shadow outline-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:not-focus-visible:ring-3 aria-invalid:not-focus-visible:ring-destructive/20 md:text-sm  dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:not-focus-visible:ring-destructive/40',
        className
      )}
      {...props}
      ref={input}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
    />
  );
}

/** Opt-in localized counter; keeps count state out of ordinary textarea consumers. */
function TextareaWithCounter({
  ref,
  counterLabel,
  maxLength,
  onChange,
  ...props
}: React.ComponentProps<typeof Textarea> & {
  maxLength: number;
  counterLabel: (count: number, limit: number) => string;
}) {
  const input = React.useRef<HTMLTextAreaElement>(null);
  const counterId = React.useId();
  const [text, setText] = React.useState(String(props.defaultValue ?? ''));
  React.useImperativeHandle(ref, () => input.current!, []);
  React.useEffect(() => {
    const node = input.current;
    if (!node) return;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setText(node.value), 0);
    };
    const form = node.form;
    form?.addEventListener('reset', reset);
    return () => {
      clearTimeout(resetTimer);
      form?.removeEventListener('reset', reset);
    };
  }, [props.form]);
  return (
    <div className="w-full space-y-1">
      <Textarea
        {...props}
        maxLength={maxLength}
        ref={input}
        aria-describedby={[props['aria-describedby'], counterId].filter(Boolean).join(' ')}
        onChange={(event) => {
          setText(event.currentTarget.value);
          onChange?.(event);
        }}
      />
      <p
        id={counterId}
        data-slot="textarea-counter"
        className="text-end text-xs text-muted-foreground"
      >
        {counterLabel(String(props.value ?? text).length, maxLength)}
      </p>
    </div>
  );
}

export { Textarea, TextareaWithCounter };
