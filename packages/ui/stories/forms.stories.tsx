import { useContext, useState } from 'react';
import type { Story } from '@ladle/react';
import { z } from 'zod';
import * as Form from '../src/form/index';
import { Button } from '../src/components/ui/button';
import { StoryLocale, useStoryText } from './story-context';
export const BoundFields: Story = () => {
  const locale = useContext(StoryLocale),
    text = useStoryText();
  const error = text('مقدار را اصلاح کنید.', 'Correct this value.');
  const schema = z.object({
    name: z.string().trim().min(1, error),
    notes: z.string(),
    phone: z.string(),
    choice: z.string(),
    confirmed: z.boolean(),
    notify: z.boolean(),
    delivery: z.string(),
    city: z.string(),
    cities: z.array(z.string()),
    quantity: z.number(),
    limits: z.array(z.number()),
    date: z.date().nullable(),
    range: z.object({ from: z.date(), to: z.date().optional() }).nullable(),
  });
  const form = Form.useZodForm(schema, {
    defaultValues: {
      name: 'Sample name',
      notes: 'Sample notes',
      phone: '+989121234567',
      choice: 'one',
      confirmed: false,
      notify: true,
      delivery: 'one',
      city: 'one',
      cities: ['one'],
      quantity: 25,
      limits: [20, 80],
      date: new Date('2026-10-08T08:00:00Z'),
      range: null,
    },
  });
  const [saved, setSaved] = useState<z.output<typeof schema> | null>(null);
  const common = {
    control: form.control,
    description: text('این مقدار نمایشی است.', 'This value is sample data.'),
  };
  const options = [
    { value: 'one', label: text('گزینه یک', 'Option one') },
    { value: 'two', label: text('گزینه دو', 'Option two') },
    { value: 'disabled', label: text('غیرفعال', 'Disabled'), disabled: true },
  ];
  return (
    <div className="max-w-xl space-y-5">
      <Form.Form {...form}>
        <form className="space-y-5" noValidate onSubmit={form.handleSubmit(setSaved)}>
          <Form.FormInput {...common} name="name" label={text('نام', 'Name')} />
          <Form.FormTextarea {...common} name="notes" label={text('یادداشت', 'Notes')} />
          <Form.FormPhoneInput {...common} name="phone" label={text('همراه', 'Phone')} />
          <Form.FormSelect
            {...common}
            name="choice"
            label={text('نوع', 'Type')}
            options={options}
          />
          <Form.FormCheckbox
            {...common}
            name="confirmed"
            label={text('تأیید اطلاعات', 'Confirm details')}
          />
          <Form.FormSwitch {...common} name="notify" label={text('اعلان‌ها', 'Notifications')} />
          <Form.FormRadioGroup
            {...common}
            name="delivery"
            label={text('تحویل', 'Delivery')}
            options={options}
          />
          <Form.FormCombobox
            {...common}
            name="city"
            label={text('شهر', 'City')}
            options={options}
            emptyMessage={text('نتیجه‌ای یافت نشد', 'No results')}
          />
          <Form.FormCombobox
            {...common}
            name="cities"
            label={text('شهرهای دیگر', 'Other cities')}
            options={options}
            emptyMessage={text('نتیجه‌ای یافت نشد', 'No results')}
            multiple
            removeLabel={(label) => text('حذف ', 'Remove ') + label}
          />
          <Form.FormSlider {...common} name="quantity" label={text('مقدار', 'Quantity')} />
          <Form.FormSlider
            {...common}
            name="limits"
            label={text('بازه مقدار', 'Quantity range')}
            inputProps={{ thumbLabels: [text('شروع', 'Start'), text('پایان', 'End')] }}
          />
          <Form.FormDatePicker
            {...common}
            name="date"
            label={text('تاریخ', 'Date')}
            inputProps={{ locale, timezone: 'Asia/Tehran' }}
          />
          <Form.FormDateRangePicker
            {...common}
            name="range"
            label={text('بازه تاریخ', 'Date range')}
            inputProps={{ locale, timezone: 'Asia/Tehran' }}
          />
          <div className="flex flex-wrap gap-3">
            <Form.FormSubmit>
              {text('بررسی و ثبت نمایشی', 'Validate and save sample')}
            </Form.FormSubmit>
            <Button type="button" variant="outline" onClick={() => form.reset()}>
              {text('بازنشانی', 'Reset')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => Form.setServerFieldErrors(form, { name: error }, ['name'], error)}
            >
              {text('نمایش خطای سرور', 'Show server error')}
            </Button>
          </div>
        </form>
      </Form.Form>
      <output>{saved ? JSON.stringify(saved) : text('هنوز ثبت نشده', 'Not saved yet')}</output>
    </div>
  );
};

export const WizardSteps: Story = () => {
  const text = useStoryText();
  const [step, setStep] = useState(1);
  const [saved, setSaved] = useState(false);
  const schema = z.object({
    first: z.string().trim().min(1, text('نام را بنویسید', 'Enter a name')),
    last: z.string().trim().min(1, text('نام خانوادگی را بنویسید', 'Enter a family name')),
  });
  const form = Form.useZodForm(schema, { defaultValues: { first: '', last: '' } });
  return (
    <div className="max-w-lg space-y-4">
      <p>{text('مرحله ', 'Step ') + step}</p>
      <Form.FormStep
        form={form}
        fields={step === 1 ? ['first'] : ['last']}
        stepKey={step}
        onNext={() => setStep(2)}
        onSubmit={() => setSaved(true)}
      >
        {({ next, submit, pending }) => (
          <div className="space-y-4">
            <Form.FormInput
              control={form.control}
              name={step === 1 ? 'first' : 'last'}
              label={step === 1 ? text('نام', 'Name') : text('نام خانوادگی', 'Family name')}
            />
            <Button disabled={pending} onClick={() => void (step === 1 ? next() : submit())}>
              {step === 1 ? text('بعدی', 'Next') : text('ثبت نمونه', 'Save sample')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                form.reset();
                setStep(1);
                setSaved(false);
              }}
            >
              {text('شروع دوباره', 'Start again')}
            </Button>
          </div>
        )}
      </Form.FormStep>
      <output>
        {saved ? text('نمونه ثبت شد', 'Sample saved') : text('هنوز ثبت نشده', 'Not saved yet')}
      </output>
    </div>
  );
};
