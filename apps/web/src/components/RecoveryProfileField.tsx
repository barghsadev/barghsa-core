import { useRef, useState } from 'react';
import { Button, Input, Label, LoadingStatus } from '@barghsa/ui';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';

interface ProfileSummary {
  id: string;
  title: string | null;
  profileType: 'INDIVIDUAL' | 'LEGAL';
}

interface ProfileMatches {
  users: { username: string; profiles: ProfileSummary[] }[];
  hasMore: boolean;
}

function validMatches(value: unknown): value is ProfileMatches {
  if (!value || typeof value !== 'object') return false;
  const result = value as ProfileMatches;
  const valid =
    typeof result.hasMore === 'boolean' &&
    Array.isArray(result.users) &&
    result.users.length <= 8 &&
    result.users.every(
      (user) =>
        user &&
        typeof user.username === 'string' &&
        !!user.username.trim() &&
        Array.isArray(user.profiles) &&
        user.profiles.every(
          (profile) =>
            profile &&
            typeof profile.id === 'string' &&
            profile.id === profile.id.trim() &&
            isInvoiceUuid(profile.id) &&
            (profile.title === null || typeof profile.title === 'string') &&
            ['INDIVIDUAL', 'LEGAL'].includes(profile.profileType)
        )
    );
  if (!valid) return false;
  const profileIds = result.users.flatMap((user) =>
    user.profiles.map((profile) => profile.id.toLowerCase())
  );
  return new Set(profileIds).size === profileIds.length;
}

export function RecoveryProfileField({
  label,
  profileId,
  invalid,
  disabled,
  onChange,
  onSessionExpired,
}: {
  label: (key: string) => string;
  profileId: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (id: string, title?: string) => void;
  onSessionExpired: () => void;
}) {
  const [manual, setManual] = useState(false);
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [chosen, setChosen] = useState<ProfileSummary | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const scope = useCatalogueScope();
  const selected = chosen?.id === profileId ? chosen : null;
  const path =
    submitted && !manual && !selected
      ? `/api/crm/users?${new URLSearchParams({ search: submitted, limit: '8' })}`
      : null;
  const read = useCatalogueResource(scope, path, validMatches, {
    onUnauthorized: onSessionExpired,
  });
  const options = read.data?.users.flatMap(({ username, profiles }) =>
    profiles.map((profile) => ({ ...profile, username }))
  );
  function find() {
    const query = search.trim();
    if (query.length < 2 || disabled || read.loading) return;
    if (scope.denied) scope.recover();
    if (submitted === query) read.retry();
    else setSubmitted(query);
  }
  function showSearch() {
    setChosen(null);
    setManual(false);
    onChange('');
    requestAnimationFrame(() => searchInput.current?.focus());
  }
  if (selected) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-muted/50 p-3">
        <div className="min-w-0 space-y-1">
          <p className="sr-only">{label('selectedProfile')}</p>
          <p className="text-sm font-semibold wrap-anywhere">
            <bdi>{selected.title}</bdi>
          </p>
          <p className="text-xs text-muted-foreground wrap-anywhere">
            {label(selected.profileType === 'LEGAL' ? 'legalProfile' : 'individualProfile')}
            {' · '}
            <bdi dir="ltr" title={selected.id}>
              …{selected.id.slice(-8)}
            </bdi>
          </p>
        </div>
        <Button type="button" variant="ghost" className="shrink-0" onClick={showSearch}>
          {label('changeProfile')}
        </Button>
      </div>
    );
  }
  if (manual) {
    return (
      <div className="min-w-0 space-y-2">
        <Label htmlFor="recovery-profileId">{label('profileId')}</Label>
        <Input
          id="recovery-profileId"
          required
          aria-required="true"
          aria-invalid={invalid || undefined}
          aria-describedby="recovery-profile-hint"
          dir="ltr"
          maxLength={36}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={profileId}
          onChange={(event) => onChange(event.target.value)}
        />
        <p
          id="recovery-profile-hint"
          className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {label(invalid ? 'invalidProfileId' : 'profileIdHint')}
        </p>
        <Button type="button" variant="ghost" onClick={showSearch}>
          {label('searchProfile')}
        </Button>
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor="recovery-profile-search">{label('searchProfile')}</Label>
      <div className="flex items-center gap-2">
        <Input
          ref={searchInput}
          id="recovery-profile-search"
          value={search}
          maxLength={100}
          dir="auto"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby="recovery-profile-search-hint"
          onChange={(event) => {
            setSearch(event.target.value);
            setSubmitted('');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            find();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={search.trim().length < 2 || read.loading}
          onClick={find}
        >
          {label('findProfile')}
        </Button>
      </div>
      <p id="recovery-profile-search-hint" className="text-xs text-muted-foreground">
        {label(invalid ? 'chooseProfile' : 'profileSearchHelp')}
      </p>
      {read.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {submitted && (scope.denied || read.error) && (
        <p role="alert" className="text-sm text-muted-foreground">
          {label(scope.denied ? 'profileSearchDenied' : 'profileSearchFailed')}
        </p>
      )}
      {!read.loading &&
        !read.error &&
        options &&
        (options.length ? (
          <ul
            aria-label={label('profileResults')}
            className="max-h-56 divide-y overflow-y-auto rounded-lg border"
          >
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="block min-w-0 w-full px-3 py-2.5 text-start text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
                  onClick={() => {
                    const title = option.title?.trim() || option.username;
                    setChosen({ ...option, title });
                    onChange(option.id, title);
                  }}
                >
                  <bdi className="block font-medium wrap-anywhere">
                    {option.title || option.username}
                  </bdi>
                  <span className="mt-0.5 block text-xs text-muted-foreground wrap-anywhere">
                    {label(option.profileType === 'LEGAL' ? 'legalProfile' : 'individualProfile')}
                    {' · '}
                    <bdi dir="ltr">{option.username}</bdi>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {label('noProfiles')}
          </p>
        ))}
      {!read.loading && !read.error && read.data?.hasMore && (
        <p className="text-xs text-muted-foreground">{label('refineProfileSearch')}</p>
      )}
      <Button type="button" variant="ghost" onClick={() => setManual(true)}>
        {label('enterProfileId')}
      </Button>
    </div>
  );
}
