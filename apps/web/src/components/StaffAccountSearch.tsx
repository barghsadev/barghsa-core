import { useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, Label, ListSearchInput, LoadingStatus } from '@barghsa/ui';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { ServerQueryError } from '../lib/server-query-client.js';

export interface StaffAccountOption {
  userId: string;
  username: string;
  name: string | null;
}

interface StaffMatches {
  items: StaffAccountOption[];
  hasMore: boolean;
}

function isStaffMatches(value: unknown): value is StaffMatches {
  if (!value || typeof value !== 'object') return false;
  const { items, hasMore } = value as Partial<StaffMatches>;
  return (
    typeof hasMore === 'boolean' &&
    Array.isArray(items) &&
    items.length <= 10 &&
    items.every(
      (account) =>
        account &&
        typeof account.userId === 'string' &&
        account.userId.trim() !== '' &&
        typeof account.username === 'string' &&
        account.username.trim() !== '' &&
        (account.name === null || typeof account.name === 'string')
    ) &&
    new Set(items.map((account) => account.userId)).size === items.length
  );
}

export function StaffAccountSearch({
  copy,
  disabled,
  onSelect,
  onSessionEnded,
}: {
  copy: (key: string) => string;
  disabled: boolean;
  onSelect: (account: StaffAccountOption) => void;
  onSessionEnded: () => void;
}) {
  const id = useId();
  const read = useStaffQueryRead('profiles');
  const [text, setText] = useState('');
  const [retry, setRetry] = useState(0);
  const [reply, setReply] = useState<{
    query: string;
    owner: typeof read;
    data: StaffMatches | 'denied' | 'failed';
  } | null>(null);
  const query = text.trim();
  const canSearch = query.length >= 2;
  const result = reply?.query === query && reply.owner === read ? reply.data : null;

  useEffect(() => {
    if (!canSearch) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void read(
        `/api/admin/staff/search?q=${encodeURIComponent(query)}`,
        'list',
        abort.signal,
        staffQueryJson,
        retry
      )
        .then((data) => {
          if (!isStaffMatches(data)) throw new Error('Invalid staff search response');
          if (!abort.signal.aborted) setReply({ query, owner: read, data });
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          const status = error instanceof ServerQueryError ? error.status : null;
          if (status === 401) onSessionEnded();
          else setReply({ query, owner: read, data: status === 403 ? 'denied' : 'failed' });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [canSearch, onSessionEnded, query, read, retry]);

  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{copy('lookup.searchLabel')}</Label>
      <ListSearchInput
        id={id}
        label={copy('lookup.searchLabel')}
        placeholder={copy('lookup.placeholder')}
        aria-describedby={`${id}-help`}
        autoComplete="off"
        maxLength={100}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          if (next.trim() !== query) setReply(null);
          setText(next);
        }}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {copy('lookup.help')}
      </p>
      {canSearch && (
        <div aria-busy={!result || undefined}>
          {!result ? (
            <LoadingStatus>{copy('lookup.searching')}</LoadingStatus>
          ) : result === 'denied' ? (
            <p role="status" className="rounded-lg bg-muted/60 p-3 text-sm">
              {copy('lookup.searchDenied')}
            </p>
          ) : result === 'failed' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/60 p-2">
              <p role="alert" className="text-sm">
                {copy('lookup.searchFailed')}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setReply(null);
                  setRetry((value) => value + 1);
                }}
              >
                {copy('retry')}
              </Button>
            </div>
          ) : !result.items.length ? (
            <p role="status" className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
              {copy('lookup.noMatches')}
            </p>
          ) : (
            <>
              <ul
                aria-label={copy('lookup.searchLabel')}
                className="max-h-72 divide-y overflow-y-auto rounded-lg border"
              >
                {result.items.map((account) => (
                  <li key={account.userId}>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disabled}
                      className="h-auto min-h-12 w-full justify-between rounded-none px-3 py-2 text-start whitespace-normal"
                      onClick={() => {
                        setText('');
                        setReply(null);
                        onSelect(account);
                      }}
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <bdi className="block">{account.name || account.username}</bdi>
                        {account.name && (
                          <bdi className="block text-xs text-muted-foreground">
                            {account.username}
                          </bdi>
                        )}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="shrink-0 text-muted-foreground rtl:rotate-180"
                      />
                    </Button>
                  </li>
                ))}
              </ul>
              {result.hasMore && (
                <p className="mt-2 text-xs text-muted-foreground">{copy('lookup.moreMatches')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
