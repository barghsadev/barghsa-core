import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input, Label, Textarea } from '@barghsa/ui';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

/** Present the same draft as individual entries or as a pasteable list. */
export function RecordListField({
  id,
  label,
  value,
  onChange,
  onBlur,
  focusRef,
  limit,
  rowHelp,
  bulkHelp,
  descriptionId,
  invalid,
  urls = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  focusRef: (element: HTMLElement | null) => void;
  limit: number;
  rowHelp: string;
  bulkHelp: string;
  descriptionId?: string | undefined;
  invalid: boolean;
  urls?: boolean;
}) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const lines = value.split(/\r?\n/);
  const entries = lines.filter((item) => item.trim());
  const [editingBulk, setEditingBulk] = useState(false);
  const bulk = editingBulk || lines.length > limit;
  const focusId = useRef<string | null>(null);
  const helpId = `${id}-help`;
  const describedBy = descriptionId ? `${descriptionId} ${helpId}` : helpId;
  const rowId = (index: number) => (index === 0 ? id : `${id}-${index + 1}`);
  useEffect(() => {
    if (!focusId.current) return;
    document.getElementById(focusId.current)?.focus();
    focusId.current = null;
  }, [value, bulk]);

  function add() {
    focusId.current = rowId(lines.length);
    onChange(`${value}\n`);
  }
  function remove(index: number) {
    focusId.current = rowId(Math.max(0, Math.min(index, lines.length - 2)));
    onChange(lines.filter((_, row) => row !== index).join('\n'));
  }
  function toggleBulk() {
    focusId.current = id;
    if (bulk) onChange(entries.join('\n'));
    setEditingBulk(!bulk);
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={bulk && entries.length > limit}
          onClick={toggleBulk}
        >
          {copy(bulk ? 'editIndividualItems' : 'editPastedList')}
        </Button>
      </div>
      {bulk ? (
        <Textarea
          id={id}
          ref={focusRef}
          value={value}
          rows={3}
          className="max-h-48 resize-y"
          dir={urls ? 'ltr' : 'auto'}
          aria-required="true"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onBlur={onBlur}
          onChange={(event) => {
            setEditingBulk(true);
            onChange(event.target.value);
          }}
        />
      ) : (
        <>
          <div className="max-h-72 space-y-1.5 overflow-y-auto px-1 py-1">
            {lines.map((line, index) => (
              <div key={index} className="flex min-w-0 items-center gap-1.5">
                <Input
                  id={rowId(index)}
                  ref={index === 0 ? focusRef : undefined}
                  type={urls ? 'url' : 'text'}
                  dir={urls ? 'ltr' : 'auto'}
                  aria-label={
                    index
                      ? copy('listItemNumber').replace('{number}', number(index + 1))
                      : undefined
                  }
                  className="min-w-0"
                  value={line}
                  placeholder={urls ? 'https://' : undefined}
                  aria-required={lines.length === 1 || undefined}
                  aria-invalid={index === 0 && invalid ? true : undefined}
                  aria-describedby={describedBy}
                  onBlur={onBlur}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = event.target.value;
                    onChange(next.join('\n'));
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (index < lines.length - 1)
                      document.getElementById(rowId(index + 1))?.focus();
                    else if (line.trim() && lines.length < limit) add();
                  }}
                />
                {(line || lines.length > 1) && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={copy('removeListItem').replace('{number}', number(index + 1))}
                    title={copy('removeListItem').replace('{number}', number(index + 1))}
                    onClick={() => remove(index)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-card"
            disabled={lines.length >= limit || !lines.at(-1)?.trim()}
            onClick={add}
          >
            <Plus aria-hidden="true" className="size-4" />
            {copy(urls ? 'addSourceAddress' : 'addPolicyItem')}
          </Button>
        </>
      )}
      <p id={helpId} className="text-xs text-muted-foreground">
        {bulk ? bulkHelp : rowHelp}
      </p>
    </div>
  );
}
