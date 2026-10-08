import { useState } from 'react';
import type { Story } from '@ladle/react';
import * as UI from '../src/index';
import { useStoryText } from './story-context';

export const Accordions: Story = () => {
  const text = useStoryText();
  const [value, setValue] = useState<string[]>(['faq']);
  return (
    <div className="max-w-lg space-y-8">
      {([false, true] as const).map((multiple) => (
        <section key={String(multiple)} aria-label={multiple ? 'multiple' : 'single'}>
          <h2 className="font-semibold">
            {multiple
              ? text('چند بخش باز', 'Multiple sections')
              : text('یک بخش باز', 'One section')}
          </h2>
          <UI.Accordion
            multiple={multiple}
            {...(!multiple ? { value, onValueChange: setValue } : {})}
          >
            {['faq', 'settings', 'order', 'disabled'].map((key) => (
              <UI.AccordionItem key={key} value={key} disabled={key === 'disabled'}>
                <UI.AccordionTrigger>
                  {key === 'faq'
                    ? text('پرسش‌های رایج', 'FAQ')
                    : key === 'settings'
                      ? text('تنظیمات', 'Settings')
                      : key === 'order'
                        ? text('جزئیات سفارش', 'Order details')
                        : text('غیرفعال', 'Disabled')}
                </UI.AccordionTrigger>
                <UI.AccordionContent>
                  {text(
                    'اطلاعات این بخش در اینجا نمایش داده می‌شود.',
                    'The section information appears here.'
                  )}
                </UI.AccordionContent>
              </UI.AccordionItem>
            ))}
          </UI.Accordion>
        </section>
      ))}
    </div>
  );
};

export const ProgressStates: Story = () => {
  const text = useStoryText();
  return (
    <div className="max-w-lg space-y-8">
      {(['default', 'success', 'warning'] as const).map((variant) => (
        <UI.Progress
          key={variant}
          variant={variant}
          value={variant === 'success' ? 100 : 65}
          striped={variant === 'warning'}
        >
          <UI.ProgressLabel>
            {variant === 'default'
              ? text('بارگذاری سند', 'Document upload')
              : variant === 'success'
                ? text('تکمیل سفارش', 'Order complete')
                : text('در حال انجام', 'In progress')}
          </UI.ProgressLabel>
          <UI.ProgressValue />
        </UI.Progress>
      ))}
      <UI.Progress value={null} aria-label={text('در انتظار پاسخ', 'Waiting for response')} />
      <UI.Progress value={25} aria-label={text('مسیر سفارشی', 'Custom track')}>
        <UI.ProgressTrack className="h-2">
          <UI.ProgressIndicator />
        </UI.ProgressTrack>
      </UI.Progress>
    </div>
  );
};

export const BooleanStates: Story = () => {
  const text = useStoryText();
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(false);
  const [submissions, setSubmissions] = useState(0);
  return (
    <form
      className="max-w-lg space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmissions((n) => n + 1);
      }}
    >
      <div className="flex items-center gap-3">
        <UI.Checkbox id="choice" checked={checked} onCheckedChange={setChecked} />
        <UI.Label htmlFor="choice">{text('نمایش جزئیات', 'Show details')}</UI.Label>
      </div>
      <div className="flex items-center gap-3">
        <UI.Checkbox id="mixed-choice" indeterminate />
        <UI.Label htmlFor="mixed-choice">{text('انتخاب بخشی', 'Partial selection')}</UI.Label>
      </div>
      <div className="flex items-center gap-3">
        <UI.Checkbox id="invalid-choice" aria-invalid aria-describedby="choice-error" />
        <UI.Label htmlFor="invalid-choice">{text('انتخاب الزامی', 'Required choice')}</UI.Label>
      </div>
      <p id="choice-error" className="text-sm text-destructive">
        {text('یک گزینه انتخاب کنید.', 'Choose an option.')}
      </p>
      <div className="flex items-center gap-3">
        <UI.Switch id="setting" checked={on} onCheckedChange={setOn} />
        <UI.Label htmlFor="setting">{text('اعلان‌ها', 'Notifications')}</UI.Label>
      </div>
      <UI.Switch disabled checked aria-label={text('تنظیم غیرفعال', 'Disabled setting')} />
      <UI.Switch readOnly checked aria-label={text('تنظیم فقط خواندنی', 'Read-only setting')} />
      {['vertical', 'horizontal'].map((layout) => (
        <UI.RadioGroup
          key={layout}
          defaultValue="one"
          aria-label={layout}
          className={layout === 'horizontal' ? 'flex flex-wrap gap-5' : undefined}
          aria-invalid
          aria-describedby="radio-error"
        >
          {['one', 'two', 'disabled'].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <UI.RadioGroupItem
                id={layout + item}
                value={item}
                disabled={item === 'disabled'}
                aria-invalid
              />
              <UI.Label htmlFor={layout + item}>
                {item === 'one'
                  ? text('گزینه یک', 'Option one')
                  : item === 'two'
                    ? text('گزینه دو', 'Option two')
                    : text('غیرفعال', 'Disabled')}
              </UI.Label>
            </div>
          ))}
        </UI.RadioGroup>
      ))}
      <p id="radio-error" className="text-sm text-destructive">
        {text('انتخاب را بررسی کنید.', 'Check the selection.')}
      </p>
      <output aria-label={text('ارسال فرم', 'Form submissions')}>{submissions}</output>
    </form>
  );
};
