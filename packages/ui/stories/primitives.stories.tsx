import { useState } from 'react';
import type { Story } from '@ladle/react';
import { Search, ArrowUpRight, CircleAlert, CircleCheck, Eye, EyeOff, Zap } from 'lucide-react';
import * as UI from '../src/index';
import { useStoryText } from './story-context';
export const Buttons: Story = () => {
  const text = useStoryText();
  const [clicks, setClicks] = useState(0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const).map(
          (variant) => (
            <UI.Button key={variant} variant={variant} onClick={() => setClicks((n) => n + 1)}>
              {variant}
            </UI.Button>
          )
        )}
        <UI.Button loading>{text('در حال ذخیره', 'Saving')}</UI.Button>
        <UI.Button disabled>{text('غیرفعال', 'Disabled')}</UI.Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {(['xs', 'sm', 'default', 'lg', 'xl'] as const).map((size) => (
          <UI.Button key={size} size={size}>
            {size}
          </UI.Button>
        ))}
        {(['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const).map((size) => (
          <UI.Button key={size} size={size} aria-label={text('جستجو', 'Search')}>
            <Search />
          </UI.Button>
        ))}
        <UI.Button render={<a href="#story-link" />} nativeButton={false} role="link">
          {text('پیوند نمونه', 'Example link')}
          <ArrowUpRight aria-hidden="true" />
        </UI.Button>
      </div>
      <p role="status">
        {text('تعداد کلیک', 'Clicks')}: {clicks}
      </p>
    </div>
  );
};
export const Inputs: Story = () => {
  const text = useStoryText();
  return (
    <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
      {(['default', 'error', 'success'] as const).map((variant) => (
        <div key={variant} className="space-y-2">
          <UI.Label htmlFor={'input-' + variant}>{variant}</UI.Label>
          <UI.Input
            id={'input-' + variant}
            variant={variant}
            aria-describedby={'help-' + variant}
          />
          <p id={'help-' + variant} className="text-sm text-muted-foreground">
            {text('راهنمای ورود اطلاعات', 'Input guidance')}
          </p>
        </div>
      ))}
      {(['xs', 'sm', 'default', 'lg', 'xl'] as const).map((controlSize) => (
        <UI.Input
          key={controlSize}
          controlSize={controlSize}
          aria-label={controlSize}
          placeholder={controlSize}
        />
      ))}
      <UI.Input
        disabled
        aria-label={text('غیرفعال', 'Disabled')}
        placeholder={text('غیرفعال', 'Disabled')}
      />
      <UI.Input
        readOnly
        aria-label={text('فقط خواندنی', 'Read only')}
        value={text('مقدار نمونه', 'Sample value')}
      />
      <UI.InputGroup>
        <UI.InputGroupAddon>
          <Search aria-hidden="true" />
        </UI.InputGroupAddon>
        <UI.InputGroupInput aria-label={text('جستجو', 'Search')} />
        <UI.InputGroupAddon align="inline-end">
          <UI.InputGroupText>kWh</UI.InputGroupText>
        </UI.InputGroupAddon>
      </UI.InputGroup>
    </div>
  );
};
export const Cards: Story = () => (
  <div className="grid gap-4 sm:grid-cols-2">
    {(['default', 'interactive', 'flat', 'widget'] as const).flatMap((variant) =>
      (['default', 'sm'] as const).map((size) => (
        <UI.Card key={variant + size} variant={variant} size={size}>
          <UI.CardHeader>
            <UI.CardTitle>
              <span className="flex items-center gap-2">
                {variant === 'widget' ? <Zap aria-hidden="true" className="size-4" /> : null}
                {variant} · {size}
              </span>
            </UI.CardTitle>
            <UI.CardDescription>CardDescription</UI.CardDescription>
            <UI.CardAction>
              <UI.Badge>CardAction</UI.Badge>
            </UI.CardAction>
          </UI.CardHeader>
          <UI.CardContent>CardContent</UI.CardContent>
          <UI.CardFooter>
            <UI.Button variant="outline">CardFooter</UI.Button>
          </UI.CardFooter>
        </UI.Card>
      ))
    )}
  </div>
);
export const Badges: Story = () => (
  <div className="space-y-4">
    {(['sm', 'default', 'lg'] as const).map((size) => (
      <div key={size} className="flex flex-wrap gap-3">
        {(
          [
            'default',
            'secondary',
            'success',
            'warning',
            'info',
            'purple',
            'destructive',
            'outline',
            'ghost',
            'link',
          ] as const
        ).map((variant) => (
          <UI.Badge key={variant} size={size} variant={variant}>
            {variant} · {size}
          </UI.Badge>
        ))}
      </div>
    ))}
    {(['sm', 'default', 'lg'] as const).map((size) => (
      <div key={size} className="flex flex-wrap items-center gap-3">
        {(
          [
            'default',
            'secondary',
            'destructive',
            'outline',
            'success',
            'warning',
            'info',
            'purple',
          ] as const
        ).map((variant) => (
          <UI.Badge key={variant} size={size} variant={variant} dot>
            {variant} · {size}
          </UI.Badge>
        ))}
      </div>
    ))}
  </div>
);

export const Labels: Story = () => {
  const text = useStoryText();
  return (
    <div className="max-w-lg space-y-5">
      <div className="space-y-2">
        <UI.Label htmlFor="required-name" required>
          {text('نام ضروری', 'Required name')}
        </UI.Label>
        <UI.Input id="required-name" required />
      </div>
      <div className="space-y-2">
        <UI.Label htmlFor="optional-name" optional={text('اختیاری', 'Optional')}>
          {text('نام دوم', 'Other name')}
        </UI.Label>
        <UI.Input id="optional-name" />
      </div>
      <div className="space-y-2">
        <UI.Label htmlFor="disabled-name" disabled>
          {text('نام غیرفعال', 'Disabled name')}
        </UI.Label>
        <UI.Input id="disabled-name" disabled />
      </div>
    </div>
  );
};

export const InputAddons: Story = () => {
  const text = useStoryText();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState('Sample');
  return (
    <div className="max-w-lg space-y-5">
      <UI.Label htmlFor="secret">{text('گذرواژه نمونه', 'Sample password')}</UI.Label>
      <UI.InputGroup>
        <UI.InputGroupInput
          id="secret"
          type={visible ? 'text' : 'password'}
          defaultValue="example"
        />
        <UI.InputGroupAddon align="inline-end">
          <UI.InputGroupButton
            size="icon-sm"
            aria-label={
              visible ? text('پنهان کردن', 'Hide password') : text('نمایش گذرواژه', 'Show password')
            }
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </UI.InputGroupButton>
        </UI.InputGroupAddon>
      </UI.InputGroup>
      <UI.Label htmlFor="clear-input">{text('متن نمونه', 'Sample text')}</UI.Label>
      <UI.InputGroup>
        <UI.InputGroupAddon>
          <Search aria-hidden="true" />
        </UI.InputGroupAddon>
        <UI.InputGroupInput
          id="clear-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <UI.InputGroupAddon align="inline-end">
          <UI.InputGroupButton onClick={() => setValue('')}>
            {text('پاک کردن', 'Clear')}
          </UI.InputGroupButton>
        </UI.InputGroupAddon>
      </UI.InputGroup>
      {(['error', 'success'] as const).map((variant) => (
        <div key={variant} className="space-y-2">
          <UI.Label htmlFor={'adorned-' + variant}>{variant}</UI.Label>
          <UI.InputGroup className={variant === 'success' ? 'border-success' : undefined}>
            <UI.InputGroupInput
              id={'adorned-' + variant}
              aria-invalid={variant === 'error' || undefined}
              aria-describedby={'adorned-help-' + variant}
            />
            <UI.InputGroupAddon align="inline-end">
              {variant === 'error' ? (
                <CircleAlert aria-hidden="true" className="text-destructive" />
              ) : (
                <CircleCheck aria-hidden="true" className="text-success" />
              )}
            </UI.InputGroupAddon>
          </UI.InputGroup>
          <p
            id={'adorned-help-' + variant}
            className={
              variant === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {variant === 'error'
              ? text('مقدار را اصلاح کنید', 'Correct this value')
              : text('مقدار تأیید شد', 'Value confirmed')}
          </p>
        </div>
      ))}
      <UI.Label htmlFor="money">{text('مبلغ', 'Amount')}</UI.Label>
      <UI.InputGroup>
        <UI.InputGroupAddon>
          <UI.InputGroupText>IRR</UI.InputGroupText>
        </UI.InputGroupAddon>
        <UI.InputGroupInput id="money" inputMode="numeric" />
        <UI.InputGroupAddon align="inline-end">
          <UI.InputGroupText>kWh</UI.InputGroupText>
        </UI.InputGroupAddon>
      </UI.InputGroup>
      <UI.Label htmlFor="group-notes">{text('یادداشت چندخطی', 'Multiline notes')}</UI.Label>
      <UI.InputGroup>
        <UI.InputGroupAddon align="block-start">
          <UI.InputGroupText>{text('راهنمای نمونه', 'Sample guidance')}</UI.InputGroupText>
        </UI.InputGroupAddon>
        <UI.InputGroupTextarea id="group-notes" />
        <UI.InputGroupAddon align="block-end">
          <UI.InputGroupButton>{text('ثبت نمایشی', 'Save sample')}</UI.InputGroupButton>
        </UI.InputGroupAddon>
      </UI.InputGroup>
    </div>
  );
};
export const Avatars: Story = () => (
  <div className="flex flex-wrap gap-4">
    {(['sm', 'default', 'lg'] as const).map((size) => (
      <UI.Avatar key={size} size={size}>
        <UI.AvatarImage
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3C/svg%3E"
          alt="Sample avatar"
        />
        <UI.AvatarFallback>BS</UI.AvatarFallback>
        <UI.AvatarBadge role="img" aria-label="Online" />
      </UI.Avatar>
    ))}
    <UI.AvatarGroup>
      <UI.Avatar>
        <UI.AvatarFallback>AB</UI.AvatarFallback>
      </UI.Avatar>
      <UI.Avatar>
        <UI.AvatarFallback>CD</UI.AvatarFallback>
      </UI.Avatar>
      <UI.AvatarGroupCount>+3</UI.AvatarGroupCount>
    </UI.AvatarGroup>
  </div>
);
export const Notices: Story = () => {
  const text = useStoryText();
  return (
    <div className="max-w-2xl space-y-3">
      {(['default', 'info', 'success', 'warning', 'destructive'] as const).map((variant) => (
        <UI.Alert key={variant} variant={variant}>
          <UI.AlertTitle>{variant}</UI.AlertTitle>
          <UI.AlertDescription>
            {text('این پیام نمایشی است.', 'This is a sample notice.')}
          </UI.AlertDescription>
        </UI.Alert>
      ))}
    </div>
  );
};
export const Loading: Story = () => (
  <div className="max-w-lg space-y-5">
    <UI.Skeleton className="h-5 w-2/3" />
    <UI.Skeleton className="size-12 rounded-full" />
    <UI.Skeleton className="h-32" />
    <UI.Separator />
    <UI.Progress value={65} aria-label="Progress">
      <UI.ProgressLabel>Progress</UI.ProgressLabel>
      <UI.ProgressValue />
    </UI.Progress>
    <UI.Progress value={null} aria-label="Indeterminate progress" />
  </div>
);
export const Textareas: Story = () => {
  const text = useStoryText();
  return (
    <div className="max-w-lg space-y-5">
      <UI.Label htmlFor="notes">{text('یادداشت', 'Notes')}</UI.Label>
      <UI.Textarea id="notes" maxLength={140} placeholder={text('یادداشت نمونه', 'Sample notes')} />
      <UI.Textarea
        aria-label={text('خطا', 'Error')}
        aria-invalid
        defaultValue={text('ورودی نامعتبر', 'Invalid input')}
      />
      <UI.Textarea disabled aria-label={text('غیرفعال', 'Disabled')} />
    </div>
  );
};
export const Scrolling: Story = () => (
  <UI.ScrollArea
    className="h-60 w-full max-w-lg rounded-lg border p-4"
    aria-label="Scrollable sample"
  >
    <div className="space-y-4">
      {Array.from({ length: 20 }, (_, n) => (
        <p key={n}>Sample item {n + 1}</p>
      ))}
    </div>
    <UI.ScrollBar />
  </UI.ScrollArea>
);
export const Breadcrumbs: Story = () => (
  <UI.Breadcrumb>
    <UI.BreadcrumbList>
      <UI.BreadcrumbItem>
        <UI.BreadcrumbLink href="#home">Home</UI.BreadcrumbLink>
      </UI.BreadcrumbItem>
      <UI.BreadcrumbSeparator />
      <UI.BreadcrumbItem>
        <UI.BreadcrumbEllipsis aria-label="Earlier pages" />
      </UI.BreadcrumbItem>
      <UI.BreadcrumbSeparator />
      <UI.BreadcrumbItem>
        <UI.BreadcrumbPage>Current page</UI.BreadcrumbPage>
      </UI.BreadcrumbItem>
    </UI.BreadcrumbList>
  </UI.Breadcrumb>
);
