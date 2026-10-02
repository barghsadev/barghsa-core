import '@barghsa/ui/styles.css';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import {
  Form,
  FormInput,
  FormTextarea,
  FormPhoneInput,
  FormSelect,
  FormCheckbox,
  FormSwitch,
  FormRadioGroup,
  FormCombobox,
  FormSlider,
  FormDatePicker,
  FormDateRangePicker,
  FormSubmit,
  useZodForm,
  useWatch,
  setServerFieldErrors,
} from '../../../../../packages/ui/src/form/index';
import { DirectionProvider } from '../../../../../packages/ui/src/direction-provider';
import { Button } from '../../../../../packages/ui/src/components/ui/button';

const params = new URLSearchParams(location.search);
const locale = params.has('fa') ? 'fa' : 'en';
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
document.documentElement.classList.toggle('dark', locale === 'fa');
const labels =
  locale === 'fa'
    ? {
        text: 'نام',
        note: 'توضیحات',
        phone: 'شماره همراه',
        select: 'نوع درخواست',
        checkbox: 'تأیید اطلاعات',
        switch: 'اعلان‌ها',
        radio: 'روش تحویل',
        combo: 'شهر',
        multi: 'شهرهای دیگر',
        slider: 'مقدار',
        sliders: 'بازه مقدار',
        date: 'تاریخ تحویل',
        range: 'بازه تحویل',
        alpha: 'شیراز',
        beta: 'تهران',
        inactive: 'غیرفعال',
        guidance: 'این مقدار در فرم ذخیره می‌شود.',
        empty: 'گزینه‌ای یافت نشد.',
        remove: 'حذف',
        save: 'ذخیره',
        finish: 'پایان ذخیره',
        reset: 'بازنشانی',
        error: 'این مقدار را اصلاح کنید.',
        check: 'بررسی',
        title: 'فیلدهای فرم',
        draft: 'پیش‌نویس',
        saved: 'ذخیره شده',
        attempts: 'تعداد ارسال',
      }
    : {
        text: 'Name',
        note: 'Notes',
        phone: 'Phone',
        select: 'Request type',
        checkbox: 'Confirm details',
        switch: 'Notifications',
        radio: 'Delivery method',
        combo: 'City',
        multi: 'Other cities',
        slider: 'Quantity',
        sliders: 'Quantity range',
        date: 'Delivery date',
        range: 'Delivery range',
        alpha: 'Shiraz',
        beta: 'Tehran',
        inactive: 'Inactive',
        guidance: 'This value is stored in the form.',
        empty: 'No matching options.',
        remove: 'Remove',
        save: 'Save',
        finish: 'Finish save',
        reset: 'Reset',
        error: 'Correct this value.',
        check: 'Check',
        title: 'Form fields',
        draft: 'Draft',
        saved: 'Saved',
        attempts: 'Submission count',
      };
const schema = z.object({
  text: z.string().trim().min(1, labels.error),
  note: z.string().min(1, labels.error),
  phone: z.string().min(1, labels.error),
  select: z.string().min(1, labels.error),
  checkbox: z.boolean(),
  switch: z.boolean(),
  radio: z.string().min(1, labels.error),
  combo: z.string().min(1, labels.error),
  multi: z.array(z.string()).min(1, labels.error),
  slider: z.number().min(1, labels.error),
  sliders: z.array(z.number()).length(2, labels.error),
  date: z.date().nullable().refine(Boolean, labels.error),
  range: z
    .object({ from: z.date(), to: z.date({ error: labels.error }) })
    .nullable()
    .refine((value) => Boolean(value?.to), labels.error),
});
type Values = z.input<typeof schema>;
const defaults: Values = {
  text: 'Retained name',
  note: 'Retained note',
  phone: '+98 912 123 4567',
  select: 'alpha',
  checkbox: true,
  switch: true,
  radio: 'alpha',
  combo: 'alpha',
  multi: ['alpha'],
  slider: 10,
  sliders: [10, 20],
  date: new Date('2026-03-22T00:00:00Z'),
  range: { from: new Date('2026-03-21T00:00:00Z'), to: new Date('2026-03-23T00:00:00Z') },
};
const names = Object.keys(defaults) as (keyof Values)[];
const options = [
  { value: 'inactive', label: labels.inactive, disabled: true },
  { value: 'alpha', label: labels.alpha },
  { value: 'beta', label: labels.beta },
];
function Fixture() {
  const form = useZodForm(schema, {
    defaultValues: {
      ...defaults,
      range: params.has('partial-range') ? { from: defaults.range!.from } : defaults.range,
    },
  });
  const values = useWatch({ control: form.control });
  const [saved, setSaved] = useState<Values | null>(null);
  const [attempts, setAttempts] = useState(0);
  const finish = useRef<(() => void) | null>(null);
  const common = { control: form.control, description: labels.guidance };
  const dateProps = {
    locale,
    timezone: 'UTC',
    minDate: new Date('2026-03-21T00:00:00Z'),
    maxDate: new Date('2026-03-23T00:00:00Z'),
  } as const;
  return (
    <DirectionProvider direction={locale === 'fa' ? 'rtl' : 'ltr'}>
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
        <h1 className="text-xl font-semibold">{labels.title}</h1>
        <Form {...form}>
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit(async (submitted) => {
              setAttempts((value) => value + 1);
              await new Promise<void>((resolve) => {
                finish.current = resolve;
              });
              finish.current = null;
              setSaved(submitted);
            })}
          >
            <FormInput {...common} id="text" name="text" label={labels.text} />
            <FormTextarea {...common} id="note" name="note" label={labels.note} />
            <FormPhoneInput {...common} id="phone" name="phone" label={labels.phone} />
            <FormSelect
              {...common}
              id="select"
              name="select"
              label={labels.select}
              options={options}
              placeholder={labels.empty}
            />
            <FormCheckbox {...common} id="checkbox" name="checkbox" label={labels.checkbox} />
            <FormSwitch {...common} id="switch" name="switch" label={labels.switch} />
            <FormRadioGroup
              {...common}
              id="radio"
              name="radio"
              label={labels.radio}
              options={options}
            />
            <FormCombobox
              {...common}
              id="combo"
              name="combo"
              label={labels.combo}
              options={options}
              emptyMessage={labels.empty}
            />
            <FormCombobox
              {...common}
              id="multi"
              name="multi"
              label={labels.multi}
              options={options}
              emptyMessage={labels.empty}
              multiple
              removeLabel={(label) => `${labels.remove} ${label}`}
            />
            <FormSlider {...common} id="slider" name="slider" label={labels.slider} />
            <FormSlider
              {...common}
              id="sliders"
              name="sliders"
              label={labels.sliders}
              inputProps={{
                thumbLabels: locale === 'fa' ? ['کمینه', 'بیشینه'] : ['Minimum', 'Maximum'],
              }}
            />
            <FormDatePicker
              {...common}
              id="date"
              name="date"
              label={labels.date}
              inputProps={dateProps}
            />
            <FormDateRangePicker
              {...common}
              id="range"
              name="range"
              label={labels.range}
              inputProps={dateProps}
            />
            <FormSubmit>{labels.save}</FormSubmit>
          </form>
        </Form>
        <Button onClick={() => finish.current?.()}>{labels.finish}</Button>
        <Button
          variant="outline"
          disabled={form.formState.isSubmitting}
          onClick={() => {
            form.reset(defaults);
            setSaved(null);
          }}
        >
          {labels.reset}
        </Button>
        <div className="flex flex-wrap gap-2">
          {names.map((name) => (
            <Button
              key={name}
              size="sm"
              variant="outline"
              disabled={form.formState.isSubmitting}
              onClick={() => {
                form.clearErrors();
                setServerFieldErrors(form, { [name]: labels.error }, [name], labels.error);
              }}
            >
              {labels.check} {labels[name]}
            </Button>
          ))}
        </div>
        <output aria-label={labels.draft} className="break-all text-xs">
          {JSON.stringify(values)}
        </output>
        <output aria-label={labels.saved} className="break-all text-xs">
          {saved && JSON.stringify(saved)}
        </output>
        <output aria-label={labels.attempts}>{attempts}</output>
      </main>
    </DirectionProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
