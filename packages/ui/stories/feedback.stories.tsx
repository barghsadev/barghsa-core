import { useContext, useRef, useState } from 'react';
import type { Story } from '@ladle/react';
import { InfoIcon } from 'lucide-react';
import * as UI from '../src/index';
import { StoryLocale, useStoryText } from './story-context';

export const Textareas: Story = () => {
  const text = useStoryText(),
    locale = useContext(StoryLocale);
  const [value, setValue] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [submissions, setSubmissions] = useState(0);
  const counter = (count: number, limit: number) => {
    const format = new Intl.NumberFormat(locale);
    return text(
      `${format.format(count)} از ${format.format(limit)} نویسه`,
      `${format.format(count)} of ${format.format(limit)} characters`
    );
  };
  return (
    <form
      className="max-w-lg space-y-5"
      onReset={() => setValue('')}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmissions((n) => n + 1);
      }}
    >
      <UI.Label htmlFor="message">{text('متن درخواست', 'Request message')}</UI.Label>
      <UI.TextareaWithCounter
        id="message"
        ref={messageRef}
        maxLength={600}
        counterLabel={counter}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby="message-help"
      />
      <p id="message-help" className="text-sm text-muted-foreground">
        {text('شرح درخواست را بنویسید.', 'Describe your request.')}
      </p>
      <UI.Label htmlFor="note">{text('یادداشت', 'Note')}</UI.Label>
      <UI.TextareaWithCounter
        id="note"
        maxLength={30}
        counterLabel={counter}
        defaultValue="sample"
      />
      <UI.Label htmlFor="invalid-note">{text('یادداشت نامعتبر', 'Invalid note')}</UI.Label>
      <UI.Textarea id="invalid-note" aria-invalid aria-describedby="note-error" />
      <p id="note-error" className="text-sm text-destructive">
        {text('این مقدار را اصلاح کنید.', 'Correct this value.')}
      </p>
      <UI.Textarea disabled defaultValue="sample" aria-label={text('غیرفعال', 'Disabled')} />
      <UI.Textarea readOnly value="sample" aria-label={text('فقط خواندنی', 'Read-only')} />
      <div className="flex gap-3">
        <UI.Button type="reset" variant="outline">
          {text('بازنشانی', 'Reset')}
        </UI.Button>
        <UI.Button type="submit">{text('ارسال', 'Submit')}</UI.Button>
        <UI.Button type="button" variant="outline" onClick={() => messageRef.current?.focus()}>
          {text('تمرکز بر درخواست', 'Focus request')}
        </UI.Button>
      </div>
      <output aria-label={text('ارسال فرم', 'Form submissions')}>{submissions}</output>
    </form>
  );
};

export const Alerts: Story = () => {
  const text = useStoryText();
  const [dismissed, setDismissed] = useState(false);
  const [retries, setRetries] = useState(0);
  return (
    <div className="max-w-lg space-y-5">
      {(['info', 'success', 'warning', 'error', 'critical'] as const).map((variant) => (
        <UI.Alert key={variant} variant={variant} aria-label={variant}>
          <InfoIcon aria-hidden="true" />
          <UI.AlertTitle>
            {variant === 'info'
              ? text('راهنما', 'Information')
              : variant === 'success'
                ? text('تکمیل شد', 'Completed')
                : variant === 'warning'
                  ? text('نیاز به بررسی', 'Review needed')
                  : variant === 'error'
                    ? text('ارسال ناموفق', 'Delivery failed')
                    : text('اختلال سرویس', 'Service outage')}
          </UI.AlertTitle>
          <UI.AlertDescription>
            {text(
              'وضعیت را بررسی کنید و در صورت نیاز با پشتیبانی تماس بگیرید.',
              'Review the status and contact support if needed.'
            )}
          </UI.AlertDescription>
        </UI.Alert>
      ))}
      {!dismissed && (
        <UI.Alert variant="warning" aria-label={text('اعلان قابل بستن', 'Dismissible notice')}>
          <InfoIcon aria-hidden="true" />
          <UI.AlertTitle>
            {text('اتصال موقتاً در دسترس نیست', 'Connection temporarily unavailable')}
          </UI.AlertTitle>
          <UI.AlertDescription>
            {text('اطلاعات شما حفظ شده است.', 'Your information is preserved.')}
          </UI.AlertDescription>
          <UI.AlertAction>
            <UI.Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRetries((n) => n + 1)}
            >
              {text('تلاش دوباره', 'Retry')}
            </UI.Button>
          </UI.AlertAction>
          <UI.AlertDismiss
            dismissLabel={text('بستن اعلان', 'Dismiss notice')}
            onDismiss={() => setDismissed(true)}
          />
        </UI.Alert>
      )}
      <output aria-label={text('تعداد تلاش‌ها', 'Retry count')}>{retries}</output>
      <UI.NoDeadEndBanner
        title={text('در انتظار تأیید پروفایل', 'Waiting for profile verification')}
        description={text('درخواست شما ثبت شده است.', 'Your request is recorded.')}
        responsibleTeam={text('تیم مسئول: پشتیبانی', 'Responsible team: Support')}
        action={
          <UI.Button type="button" variant="outline">
            {text('مشاهده جزئیات', 'View details')}
          </UI.Button>
        }
        help={
          <a href="#help" className="underline">
            {text('راهنمای پیگیری', 'Follow-up help')}
          </a>
        }
      />
    </div>
  );
};
