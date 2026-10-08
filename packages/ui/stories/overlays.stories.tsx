import { useContext, useState } from 'react';
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
    {(['default', 'line'] as const).flatMap((variant) =>
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
