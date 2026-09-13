import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@barghsa/ui/styles.css';
import {
  Button,
  Input,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  StatusBadge,
  PageHeader,
  ProgressStepper,
  Timeline,
  FinancialReviewSummary,
  WaitingForBarghsa,
  NoDeadEndBanner,
  LoadingSkeleton,
  ConfirmDialog,
  Pagination,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Progress,
  EmptyState,
} from '@barghsa/ui';
import { DirectionProvider } from '@barghsa/ui/direction-provider';
import { Search, ArrowUpRight } from 'lucide-react';

/** Development-only catalogue. These examples never appear in product navigation. */
function Catalogue() {
  const [fa, setFa] = useState(true),
    [dark, setDark] = useState(false),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(5);
  const text = (persian: string, english: string) => (fa ? persian : english);
  const money = (value: number) => new Intl.NumberFormat(fa ? 'fa' : 'en').format(value) + ' IRR';
  const changeLocale = () => {
    document.documentElement.lang = fa ? 'en' : 'fa';
    document.documentElement.dir = fa ? 'ltr' : 'rtl';
    setFa(!fa);
  };
  return (
    <DirectionProvider direction={fa ? 'rtl' : 'ltr'}>
      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-10">
        <PageHeader
          eyebrow="BARGHSA / DESIGN SYSTEM"
          title={text('سیستم طراحی برقسا', 'Barghsa design system')}
          description={text(
            'نمونه‌های نمایشی، بدون اتصال به داده‌های واقعی',
            'Component examples using sample data, with no live account connection.'
          )}
          actions={
            <>
              <Button variant="outline" onClick={changeLocale}>
                {text('English', 'فارسی')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  document.documentElement.classList.toggle('dark', !dark);
                  setDark(!dark);
                }}
              >
                {text('تغییر پوسته', 'Toggle theme')}
              </Button>
            </>
          }
        />
        <section className="flex flex-col gap-5">
          <h2 className="text-xl font-semibold">{text('رنگ و وضعیت', 'Color & status')}</h2>
          <div className="flex flex-wrap gap-3">
            {(['default', 'success', 'warning', 'destructive', 'info', 'purple'] as const).map(
              (tone, i) => (
                <StatusBadge
                  key={tone}
                  tone={tone}
                  label={text(
                    ['پیش‌نویس', 'تأیید شده', 'در انتظار بررسی', 'رد شده', 'در حال پردازش', 'ویژه'][
                      i
                    ]!,
                    ['Draft', 'Verified', 'Awaiting review', 'Rejected', 'Processing', 'Premium'][
                      i
                    ]!
                  )}
                />
              )
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {['bg-background', 'bg-card', 'bg-primary', 'bg-sidebar'].map((color) => (
              <div key={color}>
                <div className={`h-20 rounded-xl border ${color}`} />
                <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
                  {color}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-5">
          <h2 className="text-xl font-semibold">{text('کنترل‌ها و فرم‌ها', 'Controls & forms')}</h2>
          <div className="flex flex-wrap gap-3">
            {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(
              (variant, i) => (
                <Button key={variant} variant={variant}>
                  {text(
                    ['ذخیره تغییرات', 'اقدام دوم', 'انصراف', 'جزئیات', 'حذف', 'بیشتر'][i]!,
                    ['Save changes', 'Secondary', 'Cancel', 'Details', 'Remove', 'Read more'][i]!
                  )}
                </Button>
              )
            )}
            <Button loading>{text('در حال ذخیره', 'Saving')}</Button>
            <Button disabled>{text('غیرفعال', 'Disabled')}</Button>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-name">{text('نام پروفایل', 'Profile name')}</Label>
              <Input
                id="demo-name"
                placeholder={text('نام شرکت یا شخص', 'Company or individual name')}
              />
              <p className="text-xs text-muted-foreground">
                {text(
                  'نامی که در فضای کاری نمایش داده می‌شود.',
                  'The name displayed in the workspace.'
                )}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-error">{text('کد پستی', 'Postal code')}</Label>
              <Input
                id="demo-error"
                variant="error"
                aria-describedby="demo-error-description"
                defaultValue="123"
              />
              <p id="demo-error-description" className="text-xs text-destructive">
                {text('کد پستی باید ۱۰ رقم باشد.', 'Enter a 10-digit postal code.')}
              </p>
            </div>
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={text('جستجو', 'Search')}
                placeholder={text('جستجو در سفارش‌ها', 'Search orders')}
              />
            </InputGroup>
            <InputGroup>
              <InputGroupInput
                aria-label={text('مقدار انرژی', 'Energy quantity')}
                inputMode="decimal"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>kWh</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </div>
        </section>
        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{text('خلاصه درخواست', 'Request summary')}</CardTitle>
              <CardDescription>
                {text(
                  'سطح ساده برای نمایش داده‌ها',
                  'A restrained surface for related information'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={65} aria-label={text('پیشرفت درخواست', 'Request progress')} />
            </CardContent>
            <CardFooter>
              <Button variant="outline">
                {text('مشاهده جزئیات', 'View details')}
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </CardFooter>
          </Card>
          <FinancialReviewSummary
            title={text('پیش‌نمایش پرداخت', 'Payment preview')}
            rows={[
              {
                id: 'profile',
                label: text('پروفایل', 'Profile'),
                value: text('شرکت نمونه', 'Example company'),
              },
              { id: 'subtotal', label: text('مبلغ پایه', 'Subtotal'), value: money(1000000) },
              { id: 'vat', label: text('مالیات', 'VAT'), value: money(100000) },
            ]}
            total={{ label: text('جمع کل', 'Total'), value: money(1100000) }}
            notice={text(
              'داده نمونه. مبالغ واقعی فقط از سرور دریافت می‌شوند.',
              'Sample data. Actual amounts must come from the server.'
            )}
          />
        </section>
        <section className="flex flex-col gap-6">
          <h2 className="text-xl font-semibold">{text('مراحل و تاریخچه', 'Progress & history')}</h2>
          <ProgressStepper
            label={text('مراحل سفارش', 'Order stages')}
            steps={[
              { id: 'submit', label: text('ثبت درخواست', 'Submitted'), state: 'complete' },
              { id: 'review', label: text('بررسی درخواست', 'Under review'), state: 'current' },
              { id: 'done', label: text('تکمیل', 'Complete'), state: 'pending' },
            ]}
          />
          <Timeline
            label={text('تاریخچه درخواست', 'Request history')}
            items={[
              {
                id: 'one',
                title: text('درخواست ثبت شد', 'Request submitted'),
                description: text('درخواست برای بررسی ارسال شد.', 'Sent to the team for review.'),
                dateTime: '2026-09-13T08:00:00Z',
                dateLabel: text('امروز، ۱۱:۳۰', 'Today, 11:30'),
              },
              {
                id: 'two',
                title: text('مدارک دریافت شد', 'Documents received'),
                dateTime: '2026-09-13T08:15:00Z',
                dateLabel: text('امروز، ۱۱:۴۵', 'Today, 11:45'),
              },
            ]}
          />
        </section>
        <section className="flex flex-col gap-5">
          <h2 className="text-xl font-semibold">
            {text('انتظار، خطا و بارگذاری', 'Waiting, errors & loading')}
          </h2>
          <WaitingForBarghsa
            title={text('در انتظار برقسا', 'Waiting for Barghsa')}
            description={text(
              'درخواست شما برای بررسی ارسال شده است.',
              'Your request is with the review team.'
            )}
            submittedAt={text('ثبت شده در ۲۲ شهریور', 'Submitted on 13 September')}
            help={
              <a href="#demo-help" className="underline">
                {text('مشاهده درخواست پشتیبانی', 'View support request')}
              </a>
            }
          />
          <NoDeadEndBanner
            title={text('سرویس در دسترس نیست', 'Service unavailable')}
            description={text(
              'دریافت اطلاعات انجام نشد.',
              'We could not retrieve the information.'
            )}
            responsibleTeam={text(
              'مسئول پیگیری: پشتیبانی برقسا',
              'Responsible team: Barghsa support'
            )}
            action={<Button variant="outline">{text('تلاش مجدد', 'Try again')}</Button>}
            help={
              <a id="demo-help" href="#demo-help" className="underline">
                {text('تماس با پشتیبانی', 'Contact support')}
              </a>
            }
          />
          <EmptyState
            title={text('هنوز سفارشی ندارید', 'No orders yet')}
            description={text(
              'سفارش‌های ثبت‌شده در این بخش نمایش داده می‌شوند.',
              'Submitted orders appear here.'
            )}
          />
          <LoadingSkeleton label={text('در حال بارگذاری', 'Loading')} variant="table" />
        </section>
        <section className="flex flex-wrap items-center justify-between gap-6">
          <Pagination
            page={page}
            pageCount={20}
            onPageChange={setPage}
            label={text('صفحه‌بندی', 'Pagination')}
            previousLabel={text('صفحه قبل', 'Previous page')}
            nextLabel={text('صفحه بعد', 'Next page')}
            pageLabel={(n) => text(`صفحه ${n}`, `Page ${n}`)}
            formatPage={(n) => new Intl.NumberFormat(fa ? 'fa' : 'en').format(n)}
          />
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {text('نمونه تأیید حذف', 'Preview confirmation')}
          </Button>
        </section>
        <ConfirmDialog
          open={open}
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
          title={text('حذف رکورد نمونه', 'Remove sample record')}
          description={text(
            'این فقط نمونه نمایشی است و هیچ داده‌ای حذف نمی‌شود.',
            'This is a demonstration. No data will be removed.'
          )}
          confirmLabel={text('حذف', 'Remove')}
          cancelLabel={text('انصراف', 'Cancel')}
          destructive
          confirmation={{
            phrase: fa ? 'حذف' : 'REMOVE',
            label: text('برای ادامه، «حذف» را بنویسید.', 'Type REMOVE to continue.'),
          }}
        />
      </main>
    </DirectionProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Catalogue />);
