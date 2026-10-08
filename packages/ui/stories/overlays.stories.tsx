import { useContext, useState, type ComponentProps } from 'react';
import type { Story } from '@ladle/react';
import { Toaster } from '../src/components/ui/sonner';
import { toast } from 'sonner';
import * as UI from '../src/index';
import { StoryLocale, StoryTheme, useStoryText } from './story-context';
export const Dialog: Story = () => {
  const text = useStoryText();
  return (
    <UI.Dialog>
      <UI.DialogTrigger render={<UI.Button />}>
        {text('باز کردن پنجره', 'Open dialog')}
      </UI.DialogTrigger>
      <UI.DialogContent closeLabel={text('بستن', 'Close')}>
        <UI.DialogHeader>
          <UI.DialogTitle>{text('عنوان پنجره', 'Dialog title')}</UI.DialogTitle>
          <UI.DialogDescription>
            {text('اطلاعات نمایشی برای بررسی.', 'Sample information to review.')}
          </UI.DialogDescription>
        </UI.DialogHeader>
        <UI.Label htmlFor="dialog-name">{text('نام', 'Name')}</UI.Label>
        <UI.Input id="dialog-name" />
        <UI.DialogFooter>
          <UI.DialogClose render={<UI.Button variant="outline" />}>
            {text('انصراف', 'Cancel')}
          </UI.DialogClose>
        </UI.DialogFooter>
      </UI.DialogContent>
    </UI.Dialog>
  );
};
export const Sheets: Story = () => {
  const text = useStoryText();
  return (
    <div className="flex flex-wrap gap-3">
      {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
        <UI.Sheet key={side}>
          <UI.SheetTrigger render={<UI.Button variant="outline" />}>{side}</UI.SheetTrigger>
          <UI.SheetContent side={side} closeLabel={text('بستن', 'Close')}>
            <UI.SheetHeader>
              <UI.SheetTitle>
                {text('جزئیات نمونه', 'Sample details')} · {side}
              </UI.SheetTitle>
              <UI.SheetDescription>
                {text('پنل نمایشی، بدون داده واقعی.', 'Example panel, without live data.')}
              </UI.SheetDescription>
            </UI.SheetHeader>
            <UI.SheetFooter>
              <UI.SheetClose render={<UI.Button />}>
                {text('بستن پنل', 'Close panel')}
              </UI.SheetClose>
            </UI.SheetFooter>
          </UI.SheetContent>
        </UI.Sheet>
      ))}
    </div>
  );
};

export const DialogOptions: Story = () => {
  const text = useStoryText();
  const [open, setOpen] = useState(false);
  const [size, setSize] =
    useState<NonNullable<ComponentProps<typeof UI.DialogContent>['size']>>('default');
  const [protect, setProtect] = useState(true);
  const [closeButton, setCloseButton] = useState(true);
  return (
    <div className="max-w-md space-y-4">
      <UI.Label htmlFor="dialog-size">{text('اندازه پنجره', 'Dialog size')}</UI.Label>
      <UI.NativeSelect
        id="dialog-size"
        value={size}
        onChange={(e) => setSize(e.target.value as typeof size)}
      >
        {(['sm', 'default', 'lg', 'xl', 'fullscreen'] as const).map((value) => (
          <UI.NativeSelectOption key={value}>{value}</UI.NativeSelectOption>
        ))}
      </UI.NativeSelect>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
        {text('جلوگیری از بستن با کلیک بیرون', 'Prevent outside dismissal')}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={closeButton}
          onChange={(e) => setCloseButton(e.target.checked)}
        />
        {text('نمایش دکمه بستن', 'Show close button')}
      </label>
      <UI.Dialog open={open} onOpenChange={setOpen} preventCloseOnOverlayClick={protect}>
        <UI.DialogTrigger render={<UI.Button />}>
          {text('باز کردن گزینه‌ها', 'Open options')}
        </UI.DialogTrigger>
        <UI.DialogContent
          size={size}
          showCloseButton={closeButton}
          closeLabel={text('بستن', 'Close')}
        >
          <UI.DialogHeader>
            <UI.DialogTitle>{text('فرم نمونه', 'Sample form')}</UI.DialogTitle>
            <UI.DialogDescription>
              {text('این فرم درخواست سروری ندارد.', 'This form makes no server requests.')}
            </UI.DialogDescription>
          </UI.DialogHeader>
          <UI.Label htmlFor="modal-notes">{text('یادداشت', 'Notes')}</UI.Label>
          <UI.Input id="modal-notes" />
          <UI.DialogFooter>
            <UI.DialogClose render={<UI.Button variant="outline" />}>
              {text('انصراف', 'Cancel')}
            </UI.DialogClose>
          </UI.DialogFooter>
        </UI.DialogContent>
      </UI.Dialog>
    </div>
  );
};

export const SheetOptions: Story = () => {
  const text = useStoryText();
  const [blur, setBlur] = useState(true);
  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={blur} onChange={(e) => setBlur(e.target.checked)} />
        {text('محو کردن پس‌زمینه', 'Blur backdrop')}
      </label>
      <div className="flex flex-wrap gap-3">
        {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
          <UI.Sheet key={side}>
            <UI.SheetTrigger render={<UI.Button variant="outline" />}>{side}</UI.SheetTrigger>
            <UI.SheetContent side={side} backdropBlur={blur} closeLabel={text('بستن', 'Close')}>
              <UI.SheetHeader>
                <UI.SheetTitle>{text('پنل نمونه', 'Sample panel')}</UI.SheetTitle>
                <UI.SheetDescription>
                  {text('گزینه‌های نمایش پنل', 'Panel display options')}
                </UI.SheetDescription>
              </UI.SheetHeader>
              <UI.SheetFooter>
                <UI.SheetClose render={<UI.Button />}>
                  {text('بستن پنل', 'Close panel')}
                </UI.SheetClose>
              </UI.SheetFooter>
            </UI.SheetContent>
          </UI.Sheet>
        ))}
      </div>
    </div>
  );
};

export const PopoverOptions: Story = () => {
  const text = useStoryText();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'top' | 'bottom' | 'left' | 'right'>('bottom');
  const [align, setAlign] = useState<'start' | 'center' | 'end'>('center');
  const [offset, setOffset] = useState(16);
  return (
    <div className="space-y-4">
      <UI.Label htmlFor="popover-side">{text('جهت', 'Side')}</UI.Label>
      <UI.NativeSelect
        id="popover-side"
        value={side}
        onChange={(e) => setSide(e.target.value as typeof side)}
      >
        {(['top', 'bottom', 'left', 'right'] as const).map((value) => (
          <UI.NativeSelectOption key={value}>{value}</UI.NativeSelectOption>
        ))}
      </UI.NativeSelect>
      <UI.Label htmlFor="popover-align">{text('تراز', 'Alignment')}</UI.Label>
      <UI.NativeSelect
        id="popover-align"
        value={align}
        onChange={(e) => setAlign(e.target.value as typeof align)}
      >
        {(['start', 'center', 'end'] as const).map((value) => (
          <UI.NativeSelectOption key={value}>{value}</UI.NativeSelectOption>
        ))}
      </UI.NativeSelect>
      <UI.Label htmlFor="popover-offset">{text('فاصله', 'Offset')}</UI.Label>
      <UI.NativeSelect
        id="popover-offset"
        value={offset}
        onChange={(e) => setOffset(Number(e.target.value))}
      >
        <UI.NativeSelectOption value={0}>0</UI.NativeSelectOption>
        <UI.NativeSelectOption value={16}>16</UI.NativeSelectOption>
      </UI.NativeSelect>
      <div className="flex min-h-96 items-center justify-center">
        <UI.Popover open={open} onOpenChange={setOpen}>
          <UI.PopoverTrigger render={<UI.Button />}>
            {text('نمایش راهنما', 'Show guidance')}
          </UI.PopoverTrigger>
          <UI.PopoverContent side={side} align={align} sideOffset={offset} className="w-28">
            <UI.PopoverTitle>{text('راهنما', 'Guidance')}</UI.PopoverTitle>
            <UI.PopoverDescription>{text('داده نمونه', 'Sample data')}</UI.PopoverDescription>
            <a href="#guidance" className="underline">
              {text('پیوند راهنما', 'Guidance link')}
            </a>
            <UI.PopoverArrow />
          </UI.PopoverContent>
        </UI.Popover>
      </div>
    </div>
  );
};
export const Popovers: Story = () => {
  const text = useStoryText();
  return (
    <div className="flex flex-wrap gap-3">
      {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
        <UI.Popover key={side}>
          <UI.PopoverTrigger render={<UI.Button variant="outline" />}>{side}</UI.PopoverTrigger>
          <UI.PopoverContent side={side}>
            <UI.PopoverHeader>
              <UI.PopoverTitle>{text('اطلاعات بیشتر', 'More information')}</UI.PopoverTitle>
              <UI.PopoverDescription>
                {text('راهنمای نمایشی.', 'Sample guidance.')}
              </UI.PopoverDescription>
            </UI.PopoverHeader>
            <UI.Button>{text('اقدام نمونه', 'Example action')}</UI.Button>
          </UI.PopoverContent>
        </UI.Popover>
      ))}
    </div>
  );
};
export const Tooltips: Story = () => {
  const text = useStoryText();
  return (
    <UI.TooltipProvider delay={200}>
      <div className="flex flex-wrap gap-4">
        {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
          <UI.Tooltip key={side}>
            <UI.TooltipTrigger render={<UI.Button variant="outline" />}>{side}</UI.TooltipTrigger>
            <UI.TooltipContent side={side}>
              {text('راهنمای دکمه', 'Button guidance')}
            </UI.TooltipContent>
          </UI.Tooltip>
        ))}
      </div>
    </UI.TooltipProvider>
  );
};
export const TooltipOptions: Story = () => {
  const text = useStoryText();
  return (
    <UI.TooltipProvider delay={150} closeDelay={100}>
      <div className="flex flex-wrap gap-4">
        <UI.Tooltip>
          <UI.TooltipTrigger render={<UI.Button variant="outline" />}>
            {text('راهنمای توضیحی', 'Descriptive guidance')}
          </UI.TooltipTrigger>
          <UI.TooltipContent>
            <span>
              <strong>{text('یادآوری', 'Reminder')}</strong> ·{' '}
              {text('راهنمای نمایشی برای این دکمه.', 'Sample guidance for this button.')}
            </span>
          </UI.TooltipContent>
        </UI.Tooltip>
        <UI.Tooltip>
          <UI.TooltipTrigger
            render={<span tabIndex={0} role="group" />}
            aria-label={text('دلیل غیرفعال بودن', 'Why unavailable')}
          >
            <UI.Button disabled className="pointer-events-none">
              {text('غیرفعال', 'Unavailable')}
            </UI.Button>
          </UI.TooltipTrigger>
          <UI.TooltipContent>
            {text(
              'این اقدام در وضعیت نمونه آماده نیست.',
              'This action is unavailable in the sample state.'
            )}
          </UI.TooltipContent>
        </UI.Tooltip>
        <UI.Tooltip disabled>
          <UI.TooltipTrigger render={<UI.Button variant="outline" />}>
            {text('راهنمای خاموش', 'Disabled tooltip')}
          </UI.TooltipTrigger>
          <UI.TooltipContent>
            {text('این راهنما نباید نمایش داده شود.', 'This tooltip must remain hidden.')}
          </UI.TooltipContent>
        </UI.Tooltip>
      </div>
    </UI.TooltipProvider>
  );
};
export const Menus: Story = () => {
  const text = useStoryText();
  const [checked, setChecked] = useState(false);
  const [choice, setChoice] = useState('one');
  return (
    <UI.DropdownMenu>
      <UI.DropdownMenuTrigger render={<UI.Button />}>
        {text('اقدام‌ها', 'Actions')}
      </UI.DropdownMenuTrigger>
      <UI.DropdownMenuContent>
        <UI.DropdownMenuGroup>
          <UI.DropdownMenuLabel>{text('گزینه‌ها', 'Options')}</UI.DropdownMenuLabel>
          <UI.DropdownMenuItem>
            {text('مشاهده', 'View')}
            <UI.DropdownMenuShortcut>⌘V</UI.DropdownMenuShortcut>
          </UI.DropdownMenuItem>
          <UI.DropdownMenuItem disabled>{text('غیرفعال', 'Disabled')}</UI.DropdownMenuItem>
          <UI.DropdownMenuItem variant="destructive">
            {text('حذف نمونه', 'Sample removal')}
          </UI.DropdownMenuItem>
        </UI.DropdownMenuGroup>
        <UI.DropdownMenuSeparator />
        <UI.DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>
          {text('نمایش جزئیات', 'Show details')}
        </UI.DropdownMenuCheckboxItem>
        <UI.DropdownMenuRadioGroup value={choice} onValueChange={setChoice}>
          <UI.DropdownMenuRadioItem value="one">
            {text('گزینه یک', 'Option one')}
          </UI.DropdownMenuRadioItem>
          <UI.DropdownMenuRadioItem value="two">
            {text('گزینه دو', 'Option two')}
          </UI.DropdownMenuRadioItem>
        </UI.DropdownMenuRadioGroup>
        <UI.DropdownMenuSub>
          <UI.DropdownMenuSubTrigger>{text('بیشتر', 'More')}</UI.DropdownMenuSubTrigger>
          <UI.DropdownMenuSubContent>
            <UI.DropdownMenuItem>{text('زیرگزینه', 'Nested option')}</UI.DropdownMenuItem>
          </UI.DropdownMenuSubContent>
        </UI.DropdownMenuSub>
      </UI.DropdownMenuContent>
    </UI.DropdownMenu>
  );
};
export const CustomSelect: Story = () => {
  const text = useStoryText();
  return (
    <UI.Select
      defaultValue="one"
      items={[
        { label: text('گزینه یک', 'Option one'), value: 'one' },
        { label: text('گزینه دو', 'Option two'), value: 'two' },
      ]}
    >
      <UI.SelectTrigger aria-label={text('انتخاب گزینه', 'Choose option')}>
        <UI.SelectValue />
      </UI.SelectTrigger>
      <UI.SelectContent>
        <UI.SelectGroup>
          <UI.SelectLabel>{text('گزینه‌ها', 'Options')}</UI.SelectLabel>
          <UI.SelectItem value="one">{text('گزینه یک', 'Option one')}</UI.SelectItem>
          <UI.SelectItem value="two">{text('گزینه دو', 'Option two')}</UI.SelectItem>
          <UI.SelectItem value="disabled" disabled>
            {text('غیرفعال', 'Disabled')}
          </UI.SelectItem>
        </UI.SelectGroup>
      </UI.SelectContent>
    </UI.Select>
  );
};
export const Tabs: Story = () => (
  <div className="space-y-8">
    {(['default', 'line', 'underline', 'pills', 'boxed'] as const).flatMap((variant) =>
      (['horizontal', 'vertical'] as const).map((orientation) => (
        <UI.Tabs key={variant + orientation} defaultValue="one" orientation={orientation}>
          <UI.TabsList variant={variant} aria-label={variant + ' ' + orientation}>
            <UI.TabsTrigger value="one">One</UI.TabsTrigger>
            <UI.TabsTrigger value="two">Two</UI.TabsTrigger>
            <UI.TabsTrigger value="disabled" disabled>
              Disabled
            </UI.TabsTrigger>
          </UI.TabsList>
          <UI.TabsContent value="one">
            {variant} · {orientation} · One
          </UI.TabsContent>
          <UI.TabsContent value="two">Two</UI.TabsContent>
        </UI.Tabs>
      ))
    )}
  </div>
);
export const ScrollingTabs: Story = () => {
  const text = useStoryText();
  const [value, setValue] = useState<unknown>(0);
  return (
    <UI.Tabs value={value} onValueChange={setValue} className="max-w-lg">
      <UI.ScrollableTabsList
        variant="underline"
        aria-label={text('خدمات نمونه', 'Sample services')}
        previousLabel={text('نمایش زبانه‌های قبلی', 'Show previous tabs')}
        nextLabel={text('نمایش زبانه‌های بعدی', 'Show next tabs')}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <UI.TabsTrigger key={index} value={index}>
            {text('خدمت ', 'Service ') + (index + 1)}
          </UI.TabsTrigger>
        ))}
      </UI.ScrollableTabsList>
      {Array.from({ length: 12 }, (_, index) => (
        <UI.TabsContent key={index} value={index}>
          {text('جزئیات خدمت ', 'Service details ') + (index + 1)}
        </UI.TabsContent>
      ))}
    </UI.Tabs>
  );
};
export const Commands: Story = () => {
  const text = useStoryText();
  const [selection, setSelection] = useState('');
  return (
    <div className="max-w-lg space-y-3">
      <UI.Command>
        <UI.CommandInput
          placeholder={text('جستجو', 'Search')}
          aria-label={text('جستجوی اقدام', 'Find action')}
        />
        <UI.CommandList>
          <UI.CommandEmpty>{text('نتیجه‌ای یافت نشد', 'No results')}</UI.CommandEmpty>
          <UI.CommandGroup heading={text('گزینه‌ها', 'Options')}>
            <UI.CommandItem onSelect={setSelection}>
              Electricity<UI.CommandShortcut>⌘E</UI.CommandShortcut>
            </UI.CommandItem>
            <UI.CommandItem onSelect={setSelection}>Solar</UI.CommandItem>
          </UI.CommandGroup>
          <UI.CommandSeparator />
          <UI.CommandItem disabled>Disabled</UI.CommandItem>
        </UI.CommandList>
      </UI.Command>
      <p role="status">{selection}</p>
    </div>
  );
};

export const Toasts: Story = () => {
  const text = useStoryText();
  return (
    <UI.BaseToaster closeLabel={text('بستن اعلان', 'Close notification')}>
      <UI.Button
        onClick={() =>
          UI.baseToast.add({
            title: text('انجام شد', 'Completed'),
            description: text('عملیات نمایشی تکمیل شد.', 'The sample action completed.'),
          })
        }
      >
        {text('نمایش اعلان', 'Show notification')}
      </UI.Button>
    </UI.BaseToaster>
  );
};

export const SonnerNotifications: Story = () => {
  const text = useStoryText(),
    theme = useContext(StoryTheme),
    locale = useContext(StoryLocale);
  return (
    <>
      <Toaster theme={theme} dir={locale === 'fa' ? 'rtl' : 'ltr'} closeButton />
      <div className="flex flex-wrap gap-3">
        {(['success', 'info', 'warning', 'error'] as const).map((kind) => (
          <UI.Button
            key={kind}
            onClick={() => toast[kind](text('اعلان نمونه', 'Sample notification'))}
          >
            {kind}
          </UI.Button>
        ))}
        <UI.Button
          onClick={() =>
            toast.promise(Promise.resolve('Sample'), {
              loading: text('در حال دریافت', 'Loading'),
              success: text('انجام شد', 'Completed'),
              error: text('ناموفق', 'Failed'),
            })
          }
        >
          {text('اعلان کار', 'Job notification')}
        </UI.Button>
      </div>
    </>
  );
};

export const CommandWindow: Story = () => {
  const text = useStoryText();
  const [open, setOpen] = useState(false);
  return (
    <>
      <UI.Button onClick={() => setOpen(true)}>
        {text('باز کردن جستجوی اقدام', 'Open command search')}
      </UI.Button>
      <UI.CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={text('جستجوی اقدام', 'Command search')}
        description={text('یک اقدام نمایشی را انتخاب کنید.', 'Choose a sample action.')}
        showCloseButton
        closeLabel={text('بستن', 'Close')}
      >
        <UI.Command>
          <UI.CommandInput
            aria-label={text('جستجو', 'Search')}
            placeholder={text('جستجو', 'Search')}
          />
          <UI.CommandList>
            <UI.CommandEmpty>{text('نتیجه‌ای یافت نشد', 'No results')}</UI.CommandEmpty>
            <UI.CommandItem onSelect={() => setOpen(false)}>
              {text('مشاهده نمونه', 'View sample')}
            </UI.CommandItem>
          </UI.CommandList>
        </UI.Command>
      </UI.CommandDialog>
    </>
  );
};
