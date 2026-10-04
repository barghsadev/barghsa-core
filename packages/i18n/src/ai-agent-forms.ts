import type { Locale } from './app.js';
const en = {
  title: 'Enter an agent title from 1 to 120 characters.',
  description: 'Enter a description up to 2000 characters.',
  modelId: 'Select a currently available model.',
  systemPrompt: 'Enter a system prompt up to 8000 characters.',
  temperature: 'Enter a temperature from 0 to 2, or leave it empty for the model default.',
  maxTokens:
    'Enter a whole response limit from 1 to 8192 tokens, or leave it empty for the model default.',
  linkMode: 'Select how the knowledge bases are combined.',
  enabled: 'Select whether this agent is enabled.',
  kbIds: 'Select at most 200 currently available knowledge bases.',
  policyIds: 'Select at most 200 currently available policies.',
  kbGroupIds: 'Select at most 200 currently available knowledge base groups.',
  policyGroupIds: 'Select at most 200 currently available policy groups.',
  agentId: 'Select an available agent, or choose unassigned.',
  unavailable: 'Validation could not load. Your entries are preserved; try again.',
  invalid: 'Check the highlighted agent settings.',
  changed: 'Saved agent settings changed. Your entries are preserved; reset before continuing.',
  uncertain: 'The save could not be verified. Refresh and reset before saving again.',
  reset: 'Reset to saved settings',
  linkedKbs: 'Direct knowledge base links',
  linkedPolicies: 'Direct policy links',
  promptHelp:
    'Markdown headings, lists, links and code are highlighted. Instructions are saved as entered.',
  slotsTable: 'Agent slot assignments',
  slot: 'Slot',
  lastChanged: 'Last changed',
  assignment: 'Assignment',
};
const fa: Record<keyof typeof en, string> = {
  title: 'عنوان عامل را با ۱ تا ۱۲۰ نویسه وارد کنید.',
  description: 'توضیحات را حداکثر با ۲۰۰۰ نویسه وارد کنید.',
  modelId: 'یک مدل موجود را انتخاب کنید.',
  systemPrompt: 'دستور سیستم را حداکثر با ۸۰۰۰ نویسه وارد کنید.',
  temperature: 'دمای پاسخ را از ۰ تا ۲ وارد کنید یا برای مقدار پیش‌فرض مدل خالی بگذارید.',
  maxTokens:
    'سقف پاسخ را به صورت عدد صحیح از ۱ تا ۸۱۹۲ توکن وارد کنید یا برای مقدار پیش‌فرض مدل خالی بگذارید.',
  linkMode: 'روش ترکیب پایگاه‌های دانش را انتخاب کنید.',
  enabled: 'وضعیت فعال بودن عامل را انتخاب کنید.',
  kbIds: 'حداکثر ۲۰۰ پایگاه دانش موجود را انتخاب کنید.',
  policyIds: 'حداکثر ۲۰۰ سیاست موجود را انتخاب کنید.',
  kbGroupIds: 'حداکثر ۲۰۰ گروه پایگاه دانش موجود را انتخاب کنید.',
  policyGroupIds: 'حداکثر ۲۰۰ گروه سیاست موجود را انتخاب کنید.',
  agentId: 'یک عامل موجود را انتخاب کنید یا تخصیص را خالی بگذارید.',
  unavailable: 'اعتبارسنجی بارگیری نشد. داده‌های شما حفظ شده است؛ دوباره تلاش کنید.',
  invalid: 'تنظیمات مشخص‌شده عامل را بررسی کنید.',
  changed:
    'تنظیمات ذخیره‌شده عامل تغییر کرده است. داده‌های شما حفظ شده است؛ پیش از ادامه بازنشانی کنید.',
  uncertain: 'ذخیره تأیید نشد. پیش از ذخیره دوباره، تازه‌سازی و بازنشانی کنید.',
  reset: 'بازنشانی به تنظیمات ذخیره‌شده',
  linkedKbs: 'پیوندهای مستقیم پایگاه دانش',
  linkedPolicies: 'پیوندهای مستقیم سیاست',
  promptHelp:
    'عنوان‌ها، فهرست‌ها، پیوندها و کدهای Markdown مشخص می‌شوند. دستورها همان‌گونه که وارد شده‌اند ذخیره می‌شوند.',
  slotsTable: 'تخصیص‌های جایگاه عامل',
  slot: 'جایگاه',
  lastChanged: 'آخرین تغییر',
  assignment: 'تخصیص',
};
export function aiAgentFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
