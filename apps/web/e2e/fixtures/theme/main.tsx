import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../../../packages/ui/src/components/ui/button';
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from '../../../../../packages/ui/src/components/ui/alert';
import { BrandThemeProvider } from '../../../src/providers/BrandThemeProvider';
import { UiDirectionProvider } from '../../../src/providers/UiDirectionProvider';
import { Input } from '../../../../../packages/ui/src/components/ui/input';
import { Textarea } from '../../../../../packages/ui/src/components/ui/textarea';
import { Checkbox } from '../../../../../packages/ui/src/components/ui/checkbox';
import {
  RadioGroup,
  RadioGroupItem,
} from '../../../../../packages/ui/src/components/ui/radio-group';
import { Switch } from '../../../../../packages/ui/src/components/ui/switch';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../../../../packages/ui/src/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../../../../packages/ui/src/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../../../../packages/ui/src/components/ui/dropdown-menu';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../../../../packages/ui/src/components/ui/native-select';
import { Slider } from '../../../../../packages/ui/src/components/ui/slider';
import { ScrollArea } from '../../../../../packages/ui/src/components/ui/scroll-area';
import { Separator } from '../../../../../packages/ui/src/components/ui/separator';
import { Badge } from '../../../../../packages/ui/src/components/ui/badge';
import {
  Avatar,
  AvatarFallback,
  AvatarBadge,
} from '../../../../../packages/ui/src/components/ui/avatar';
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '../../../../../packages/ui/src/components/ui/progress';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandShortcut,
  CommandEmpty,
  CommandDialog,
} from '../../../../../packages/ui/src/components/ui/command';
import { Toaster, toast } from '../../../../../packages/ui/src/components/ui/toast';
import { Skeleton } from '../../../../../packages/ui/src/components/ui/skeleton';
import { PageLoading } from '../../../../../packages/ui/src/components/ui/page-states';
function Auxiliary() {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState('');
  const closeLabel = locale === 'fa' ? 'بستن' : 'Close';
  return (
    <Toaster closeLabel={closeLabel} timeout={0}>
      <section aria-label="Auxiliary controls" className="flex w-full max-w-md flex-col gap-6">
        <Avatar size="lg">
          <AvatarFallback>AB</AvatarFallback>
          <AvatarBadge aria-label="Available" />
        </Avatar>
        <Progress value={25}>
          <ProgressLabel>Upload</ProgressLabel>
          <ProgressValue />
        </Progress>
        <Command label="Actions">
          <CommandInput aria-label="Find action" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            <CommandItem value="alpha" onSelect={setSelected}>
              Alpha<CommandShortcut>A</CommandShortcut>
            </CommandItem>
            <CommandItem value="beta" onSelect={setSelected}>
              Beta
            </CommandItem>
            <CommandItem value="disabled" disabled>
              Unavailable action
            </CommandItem>
          </CommandList>
        </Command>
        <output aria-label="Selected command">{selected}</output>
        <Button onClick={() => setOpen(true)}>Open commands</Button>
        <CommandDialog
          open={open}
          onOpenChange={setOpen}
          title={locale === 'fa' ? 'دستورها' : 'Commands'}
          description={locale === 'fa' ? 'یک دستور انتخاب کنید' : 'Choose a command'}
          closeLabel={closeLabel}
          showCloseButton
        >
          <Command label="Dialog actions">
            <CommandInput aria-label="Find dialog action" />
            <CommandList>
              <CommandItem onSelect={() => setOpen(false)}>Run</CommandItem>
            </CommandList>
          </Command>
        </CommandDialog>
        <Button
          onClick={() =>
            toast.add({
              title: locale === 'fa' ? 'ذخیره شد' : 'Saved',
              description: locale === 'fa' ? 'تغییرات ذخیره شدند' : 'Changes saved',
              type: 'success',
            })
          }
        >
          Show toast
        </Button>
        <div aria-label="Placeholder shapes" className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <PageLoading label={locale === 'fa' ? 'در حال بارگذاری' : 'Loading'} />
      </section>
    </Toaster>
  );
}
function Controls() {
  const [submissions, setSubmissions] = React.useState(0);
  return (
    <section aria-label="Shared controls" className="flex flex-col gap-5 w-full max-w-md">
      <label>
        Name
        <Input aria-label="Name" defaultValue="Example" />
      </label>
      <label>
        Invalid name
        <Input
          aria-label="Invalid name"
          aria-invalid="true"
          aria-describedby="name-error"
          aria-errormessage="name-error"
          defaultValue="!"
        />
      </label>
      <p id="name-error" className="text-destructive">
        Check this name.
      </p>
      <label>
        Notes
        <Textarea aria-label="Notes" defaultValue="Example notes" />
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmissions((value) => value + 1);
        }}
      >
        <label className="group/field-label flex gap-2">
          <Checkbox />
          Consent
        </label>{' '}
        <button type="submit">Submit consent</button>
        <output aria-label="Form submissions">{submissions}</output>
      </form>

      <label className="group/field-label flex gap-2">
        <Switch />
        Alerts
      </label>
      <RadioGroup aria-label="Delivery" defaultValue="email">
        <label className="group/field-label flex gap-2">
          <RadioGroupItem value="email" />
          Email
        </label>
        <label className="group/field-label flex gap-2">
          <RadioGroupItem value="sms" />
          SMS
        </label>
      </RadioGroup>
      <Tabs defaultValue="one">
        <TabsList aria-label="Sections">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First section</TabsContent>
        <TabsContent value="two">Second section</TabsContent>
      </Tabs>
      <Select defaultValue="alpha">
        <SelectTrigger aria-label="Category" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="alpha">Alpha</SelectItem>
          <SelectItem value="beta">Beta</SelectItem>
        </SelectContent>
      </Select>
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem defaultChecked>Selected action</DropdownMenuCheckboxItem>
            <DropdownMenuItem variant="destructive">Remove item</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested action</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <label>
        Native category
        <NativeSelect aria-label="Native category" defaultValue="one">
          <NativeSelectOption value="one">One</NativeSelectOption>
          <NativeSelectOption value="two">Two</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="flex gap-2">
        <Checkbox readOnly defaultChecked />
        Read-only consent
      </label>
      <label className="flex gap-2">
        <Checkbox onKeyDown={(event) => event.preventDefault()} />
        Intercepted consent
      </label>
      <label className="flex gap-2">
        <Checkbox disabled />
        Unavailable consent
      </label>
      <Separator />
      <div className="flex h-12">
        <Separator orientation="vertical" />
      </div>
      <Slider aria-label="Volume" defaultValue={50} />
      <Slider defaultValue={[25, 75]} thumbLabels={['Minimum', 'Maximum']} />
      <ScrollArea className="h-24 w-full">
        <div className="p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <p key={i}>Scrollable content {i + 1}</p>
          ))}
        </div>
      </ScrollArea>
      <div className="flex flex-wrap gap-3">
        {(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const).map(
          (variant) => (
            <Badge key={variant} variant={variant} render={<a href="#controls" />}>
              {variant} badge
            </Badge>
          )
        )}
      </div>
      <Input aria-label="Unavailable" disabled />
    </section>
  );
}
const locale = new URLSearchParams(location.search).has('fa') ? 'fa' : 'en';
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
createRoot(document.getElementById('root')!).render(
  <UiDirectionProvider>
    <BrandThemeProvider>
      <main className="flex flex-col gap-4 p-6">
        <h1>Theme checks</h1>
        {(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const).map(
          (variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          )
        )}
        <Alert variant="destructive">
          <AlertTitle>{locale === 'fa' ? 'ذخیره انجام نشد' : 'Could not save'}</AlertTitle>
          <AlertDescription>
            {locale === 'fa' ? 'دوباره تلاش کنید.' : 'Try again.'}
          </AlertDescription>
        </Alert>
        <Controls />
        <Auxiliary />
      </main>
    </BrandThemeProvider>
  </UiDirectionProvider>
);
