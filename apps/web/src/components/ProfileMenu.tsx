import { lazy, Suspense, useState, type ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import {
  LoadingStatus,
  AvatarNameFallback,
  Button,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  SizedAvatar,
} from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { parseSessionContext } from '../lib/session-role.js';

const ProfileMenuActions = lazy(() => import('./ProfileMenuActions.js'));
const OperatingContextSwitch = lazy(() =>
  import('./OperatingContextSwitch.js').then((module) => ({
    default: module.OperatingContextSwitch,
  }))
);
const ConversationIdentityDialog = lazy(() =>
  import('./ConversationIdentityDialog.js').then((module) => ({
    default: module.ConversationIdentityDialog,
  }))
);

async function readAccount(response: Response) {
  if (!response.ok) throw new Error('Account unavailable');
  return parseSessionContext(await response.json());
}

export function ProfileMenu({
  area,
  locale,
  compact = false,
  preferences,
  profileBadge,
  onOpen,
}: {
  area: 'dashboard' | 'admin';
  locale: 'fa' | 'en';
  compact?: boolean;
  preferences?: ReactNode;
  profileBadge?: ReactNode;
  onOpen?: () => void;
}) {
  const account = useAsyncData('/api/auth/user', { read: readAccount });
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const user = account.status === 'ready' ? account.data : null;
  const accountLoading = (
    <LoadingStatus className="text-sm text-muted-foreground">
      {shellText('accountLoading', locale)}
    </LoadingStatus>
  );
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setOpened(true);
            account.retry();
            onOpen?.();
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant={area === 'admin' && !compact ? 'outline' : 'ghost'}
              size={area === 'admin' && compact ? 'icon' : 'default'}
              className={
                area === 'admin'
                  ? compact
                    ? 'rounded-full'
                    : 'min-h-11 gap-2 rounded-full px-2.5'
                  : undefined
              }
              aria-label={shellText('accountMenu', locale)}
            />
          }
        >
          <span
            className={profileBadge ? 'flex min-w-0 flex-col items-center gap-0.5' : 'contents'}
          >
            {profileBadge ?? (
              <SizedAvatar aria-hidden="true" size="sm">
                <AvatarNameFallback name={user?.username ?? ''} className="font-medium">
                  {user?.username ? undefined : <UserRound className="size-4" />}
                </AvatarNameFallback>
              </SizedAvatar>
            )}
            <span
              data-slot="operating-context-indicator"
              dir={locale === 'fa' ? 'rtl' : 'ltr'}
              className={
                area === 'admin'
                  ? 'whitespace-nowrap text-xs font-semibold max-lg:sr-only'
                  : 'whitespace-nowrap rounded-md border border-current/20 px-2 py-1 text-xs font-semibold'
              }
            >
              {shellText(area === 'admin' ? 'staffContext' : 'customerContext', locale)}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent
          keepMounted
          align="end"
          className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] gap-4 overflow-y-auto p-4"
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
        >
          <div className="min-w-0 space-y-1">
            <PopoverTitle>{shellText('account', locale)}</PopoverTitle>
            {account.status === 'loading' ? (
              accountLoading
            ) : account.status === 'error' ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-muted-foreground">{shellText('accountError', locale)}</p>
                <Button variant="outline" onClick={account.retry}>
                  {shellText('accountRetry', locale)}
                </Button>
              </div>
            ) : (
              <>
                {user?.username && (
                  <p dir="auto" className="break-words font-medium">
                    {user.username}
                  </p>
                )}
                {user?.email && (
                  <p dir="ltr" className="break-all text-sm text-muted-foreground">
                    {user.email}
                  </p>
                )}
                {user?.mobile && (
                  <p dir="ltr" className="break-all text-sm text-muted-foreground">
                    {user.mobile}
                  </p>
                )}
              </>
            )}
          </div>
          <Suspense fallback={account.status === 'loading' ? null : accountLoading}>
            <div className="space-y-2 border-t pt-3">
              {opened && <OperatingContextSwitch area={area} locale={locale} session={user} />}
              {preferences}
            </div>
            {opened && (
              <ProfileMenuActions
                area={area}
                locale={locale}
                onClose={() => setOpen(false)}
                onIdentity={() => {
                  setOpen(false);
                  setIdentityOpen(true);
                }}
              />
            )}
          </Suspense>
        </PopoverContent>
      </Popover>
      {identityOpen && (
        <Suspense fallback={<p role="status">{shellText('accountLoading', locale)}</p>}>
          <ConversationIdentityDialog locale={locale} onClose={() => setIdentityOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
