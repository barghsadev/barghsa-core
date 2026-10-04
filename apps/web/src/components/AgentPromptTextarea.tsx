import { forwardRef, useMemo, useRef, type TextareaHTMLAttributes } from 'react';
import { lexer, type Token } from 'marked';
import { getBrandTextColor, useBrandConfig } from '../providers/BrandThemeProvider.js';

const color: Record<string, [string, string]> = {
  heading: ['#6d28d9', '#c4b5fd'],
  list: ['#1d4ed8', '#93c5fd'],
  link: ['#1d4ed8', '#93c5fd'],
  code: ['#047857', '#6ee7b7'],
  codespan: ['#047857', '#6ee7b7'],
  strong: ['#92400e', '#fcd34d'],
  em: ['#6d28d9', '#c4b5fd'],
};
/** Highlight source only: React escapes every token and submitted text stays unchanged. */
export function promptParts(value: string) {
  try {
    const parts = lexer(value).flatMap((token: Token) => {
      if (token.type === 'paragraph' && token.tokens) {
        const raw = token.tokens.map((part) => part.raw).join('');
        if (token.raw.startsWith(raw))
          return [
            ...token.tokens.map((part) => ({
              text: part.raw,
              color: color[part.type] ? part.type : '',
            })),
            { text: token.raw.slice(raw.length), color: '' },
          ];
      }
      return [{ text: token.raw, color: color[token.type] ? token.type : '' }];
    });
    return parts.map((part) => part.text).join('') === value ? parts : [{ text: value, color: '' }];
  } catch {
    return [{ text: value, color: '' }];
  }
}
export const AgentPromptTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }
>(function AgentPromptTextarea({ value, className = '', onScroll, ...props }, ref) {
  const { brandConfig, userMode } = useBrandConfig();
  const dark = userMode === null ? brandConfig.darkMode : userMode === 'dark';
  const background = dark ? brandConfig.darkBackgroundColor : brandConfig.backgroundColor;
  const palette = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(color).map(([type, colors]) => [
          type,
          getBrandTextColor(colors[dark ? 1 : 0], [background]),
        ])
      ),
    [dark, background]
  );
  const backdrop = useRef<HTMLPreElement>(null);
  const parts = useMemo(() => promptParts(value), [value]);
  const typography =
    'w-full whitespace-pre-wrap break-words border p-3 font-mono text-sm leading-6 [tab-size:2] [scrollbar-gutter:stable]';
  return (
    <div className="relative min-w-0">
      <pre
        ref={backdrop}
        aria-hidden="true"
        dir={props.dir}
        className={`pointer-events-none absolute inset-0 m-0 overflow-hidden rounded-md border-transparent text-foreground forced-colors:hidden ${typography}`}
      >
        {parts.map((part, index) => (
          <span
            key={index}
            className={
              part.color
                ? `text-inherit ${palette[part.color] === 'var(--foreground)' ? 'underline decoration-dotted underline-offset-4' : ''}`
                : undefined
            }
            style={part.color ? { color: palette[part.color] } : undefined}
          >
            {part.text}
          </span>
        ))}
        {'\u200b'}
      </pre>
      <textarea
        {...props}
        ref={ref}
        value={value}
        className={`relative block min-h-40 resize-y rounded-md bg-transparent text-transparent caret-foreground selection:bg-muted selection:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground forced-colors:text-[CanvasText] ${typography} ${className}`}
        onScroll={(event) => {
          if (backdrop.current) {
            backdrop.current.scrollTop = event.currentTarget.scrollTop;
            backdrop.current.scrollLeft = event.currentTarget.scrollLeft;
          }
          onScroll?.(event);
        }}
      />
    </div>
  );
});
