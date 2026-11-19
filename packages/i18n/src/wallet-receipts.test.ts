import { expect, it } from 'vitest';
import { tWalletReceipts } from './wallet-receipts.js';

it.each([
  {
    locale: 'fa',
    title: 'سابقه و بازیابی آستانه',
    confirmation:
      'آستانه بررسی‌شده به‌عنوان نسخه جدید برای عملیات مالی بعدی فعال می‌شود. درخواست‌های تأیید موجود همچنان به تصمیم نیاز دارند.',
  },
  {
    locale: 'en',
    title: 'Threshold history and recovery',
    confirmation:
      'The reviewed threshold becomes a new version for future financial actions. Existing pending approvals still require a decision.',
  },
] as const)(
  'describes threshold recovery and pending approvals in $locale',
  ({ locale, title, confirmation }) => {
    expect(tWalletReceipts('admin.receiptThreshold.recoveryTitle', locale)).toBe(title);
    expect(tWalletReceipts('admin.receiptThreshold.recoveryActivateConfirm', locale)).toBe(
      confirmation
    );
  }
);
