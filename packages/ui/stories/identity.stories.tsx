import type { Story } from '@ladle/react';
import * as UI from '../src/index';
import { useStoryText } from './story-context';

export const Avatars: Story = () => {
  const text = useStoryText(),
    name = text('مجید علی سعادت', 'Ari Middle Buyer');
  return (
    <div className="space-y-8 p-2">
      <div className="flex flex-wrap items-center gap-6">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <div key={size} className="space-y-2 text-center">
            <UI.SizedAvatar size={size} role="img" aria-label={name + ' ' + size}>
              <UI.AvatarNameFallback name={name} />
            </UI.SizedAvatar>
            <p className="text-sm">{size}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        {(['online', 'offline', 'busy'] as const).map((status) => (
          <UI.AvatarPresence
            key={status}
            size="md"
            status={status}
            statusLabel={
              status === 'online'
                ? text('برخط', 'Online')
                : status === 'offline'
                  ? text('برون‌خط', 'Offline')
                  : text('مشغول', 'Busy')
            }
            role="img"
            aria-label={name}
          >
            <UI.AvatarNameFallback name={name} />
          </UI.AvatarPresence>
        ))}
        <UI.Avatar role="img" aria-label={text('تصویر آماده', 'Loaded picture')}>
          <UI.AvatarImage src="/avatar-loaded.svg" alt="" />
          <UI.AvatarNameFallback name={name} />
        </UI.Avatar>
        <UI.Avatar role="img" aria-label={text('تصویر ناموفق', 'Failed picture')}>
          <UI.AvatarImage src="/avatar-failed.svg" alt="" />
          <UI.AvatarNameFallback name={name} />
        </UI.Avatar>
        <UI.Avatar role="img" aria-label={text('حروف سفارشی', 'Custom initials')}>
          <UI.AvatarNameFallback name={name}>EX</UI.AvatarNameFallback>
        </UI.Avatar>
      </div>
      {(['xs', 'md', 'xl'] as const).map((size) => (
        <UI.AvatarGroup key={size} role="group" aria-label={text('گروه ', 'Group ') + size}>
          <UI.SizedAvatar size={size} aria-hidden="true">
            <UI.AvatarNameFallback name={name} />
            <UI.AvatarBadge aria-hidden="true" />
          </UI.SizedAvatar>
          <UI.SizedAvatarGroupCount size={size}>+2</UI.SizedAvatarGroupCount>
        </UI.AvatarGroup>
      ))}
    </div>
  );
};

export const LoadingShapes: Story = () => {
  const text = useStoryText();
  return (
    <div className="max-w-lg space-y-6">
      <div role="status" aria-label={text('در حال بارگذاری', 'Loading')}>
        <span className="sr-only">{text('در حال بارگذاری', 'Loading')}</span>
        <UI.SkeletonText />
        <UI.SkeletonText lines={3} className="mt-4" />
        <UI.SkeletonCard className="mt-4" />
        <UI.SkeletonAvatar className="mt-4" />
        <UI.SkeletonChart className="mt-4" />
        <table className="mt-4 w-full">
          <caption className="sr-only">
            {text('رکوردهای در حال بارگذاری', 'Loading records')}
          </caption>
          <tbody>
            <UI.SkeletonTableRow />
          </tbody>
        </table>
      </div>
      <div className="flex h-12 items-center gap-4">
        <span>{text('بخش یک', 'Section one')}</span>
        <UI.Separator orientation="vertical" />
        <span>{text('بخش دو', 'Section two')}</span>
      </div>
      <UI.Separator />
      <UI.LoadingSkeleton
        label={text('در حال بارگذاری جزئیات', 'Loading detail')}
        variant="detail"
      />
    </div>
  );
};
