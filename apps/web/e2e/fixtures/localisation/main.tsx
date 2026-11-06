import '@barghsa/ui/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronRight, ArrowUpDown, ArrowRight } from 'lucide-react';
import {
  Button,
  DateTimePicker,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@barghsa/ui';
import { DateDisplay, DateTimeDisplay, RelativeTime } from '../../../src/components/DateDisplay';
import { Icon } from '../../../src/components/Icon';
import { LanguageSwitcher } from '../../../src/components/LanguageSwitcher';
import { AccountUserProvider } from '../../../src/hooks/useAccountUser';
import { useAccountTime } from '../../../src/hooks/useAccountTime';
import { useFlippedPlacement } from '../../../src/hooks/useFlippedPlacement';
import { useNumberFormatting } from '../../../src/hooks/useNumberFormatting';
import { useLocale } from '../../../src/hooks/useLocale';
import { restoreEntryLocale } from '../../../src/lib/entry-locale';
import { BrandThemeProvider } from '../../../src/providers/BrandThemeProvider';
import { QueryProvider } from '../../../src/providers/QueryProvider';
import { UiDirectionProvider } from '../../../src/providers/UiDirectionProvider';

restoreEntryLocale();
function Examples({ onSwitchAccount }: { onSwitchAccount: () => void }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const clock = useAccountTime(locale);
  const placement = useFlippedPlacement('left');
  const [date, setDate] = useState<Date | undefined>(
    () => new Date(new URLSearchParams(location.search).get('date') ?? '2026-03-20T21:00:00Z')
  );
  const [relative] = useState(() => new Date(Date.now() - 120_000));
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1>{locale === 'fa' ? 'تقویم و زبان' : 'Calendar and language'}</h1>
      <LanguageSwitcher />
      <Button onClick={onSwitchAccount}>Switch account</Button>
      <section className="space-y-3" aria-label="Timestamp displays">
        <output aria-label="Exact IRR amount" data-value="9007199254740993">
          {numbers.irrDigits('9007199254740993')}
        </output>
        <DateDisplay date={date ?? null} format="yyyy/MM/dd" data-testid="calendar-date" />
        <DateTimeDisplay date={date ?? null} format="yyyy/MM/dd" data-testid="account-time" />
        <DateDisplay date="2026-03-21" timezone="UTC" data-testid="ambiguous-date" />
        <DateDisplay date={date ?? null} timezone="Mars/Base" data-testid="invalid-timezone" />
        <RelativeTime date={relative} data-testid="relative-time" />
      </section>
      <DateTimePicker
        label="Delivery"
        locale={locale}
        timezone={clock.timezone}
        disabled={clock.status !== 'ready'}
        value={date}
        onChange={setDate}
      />
      <output aria-label="Captured instant">{date?.toISOString()}</output>
      <div className="flex gap-4">
        <Icon icon={ChevronRight} role="img" aria-label="Next section" />
        <Icon icon={ArrowUpDown} role="img" aria-label="Both directions" />
        <Icon icon={ArrowRight} flipInRtl={false} role="img" aria-label="Physical east" />
      </div>
      <output aria-label="Logical placement">{placement}</output>
      <section className="flex min-h-64 items-center justify-center">
        <Popover>
          <PopoverTrigger render={<Button />}>Open directional help</PopoverTrigger>
          <PopoverContent side={placement} className="w-48">
            <PopoverTitle>{locale === 'fa' ? 'راهنما' : 'Guidance'}</PopoverTitle>
          </PopoverContent>
        </Popover>
      </section>
    </main>
  );
}
function RelativeExample() {
  const [date] = useState(() => new Date(Date.now() - 120_000));
  return (
    <main>
      <h1>Relative time</h1>
      <RelativeTime date={date} data-testid="relative-time" />
    </main>
  );
}
function Fixture() {
  const [actor, setActor] = useState('display-owner-a');
  return (
    <AccountUserProvider value={actor}>
      <Examples
        onSwitchAccount={() =>
          setActor(actor === 'display-owner-a' ? 'display-owner-b' : 'display-owner-a')
        }
      />
    </AccountUserProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryProvider>
    <BrandThemeProvider>
      <UiDirectionProvider>
        {new URLSearchParams(location.search).has('relative') ? <RelativeExample /> : <Fixture />}
      </UiDirectionProvider>
    </BrandThemeProvider>
  </QueryProvider>
);
