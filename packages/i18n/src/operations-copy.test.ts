import { expect, it } from 'vitest';
import {
  isStandardMaintenanceNotice,
  standardMaintenanceNotice,
  tPublicMaintenance,
} from './maintenance-public.js';
import { retentionText } from './operational-retention.js';
import { storageRecoveryText } from './storage-policy-forms.js';
import { verificationConfigText } from './verification-config.js';

it('recognizes a standard public maintenance notice only when both messages match', () => {
  expect(tPublicMaintenance('description', 'en')).toBe(standardMaintenanceNotice.en);
  expect(tPublicMaintenance('description', 'fa')).toBe(standardMaintenanceNotice.fa);
  expect(isStandardMaintenanceNotice({ ...standardMaintenanceNotice })).toBe(true);
  expect(isStandardMaintenanceNotice(null)).toBe(false);
  expect(isStandardMaintenanceNotice({ ...standardMaintenanceNotice, en: 'Custom notice' })).toBe(
    false
  );
  expect(isStandardMaintenanceNotice({ ...standardMaintenanceNotice, fa: 'پیام سفارشی' })).toBe(
    false
  );
});

it('explains which parts of a verification or rate-limit change take effect', () => {
  expect(verificationConfigText('policyRestoreReview', 'en')).toContain(
    'Activation is a separate step.'
  );
  expect(verificationConfigText('policyRestoreReview', 'fa')).toContain(
    'فعال‌سازی در مرحله‌ای جداگانه'
  );
  expect(verificationConfigText('rateRecoveryActivateReview', 'en')).toContain(
    'emergency restriction and request counters are preserved'
  );
  expect(verificationConfigText('rateRecoveryActivateReview', 'fa')).toContain(
    'محدودیت اضطراری فعلی و شمارنده‌های درخواست حفظ می‌شوند'
  );
});

it('distinguishes saving a retention policy from applying it', () => {
  expect(retentionText('recoveryActivateConfirm', 'en')).toContain(
    'for the infrastructure operator to apply'
  );
  expect(retentionText('recoveryActivateConfirm', 'fa')).toContain(
    'تا مسئول زیرساخت آن را اعمال کند'
  );
  expect(retentionText('unknown', 'en')).toBe('admin.retention.unknown');
});

it('uses cleanup-specific recovery copy and shares the revision label', () => {
  expect(storageRecoveryText('recoveryTitle', 'en')).toBe('Restore storage settings');
  expect(storageRecoveryText('recoveryTitle', 'fa')).toBe('بازیابی تنظیمات ذخیره‌سازی');
  expect(storageRecoveryText('recoveryTitle', 'en', 'cleanup')).toBe(
    'Restore multipart cleanup policy'
  );
  expect(storageRecoveryText('recoveryTitle', 'fa', 'cleanup')).toBe(
    'بازیابی سیاست پاک‌سازی بارگذاری‌های ناتمام'
  );
  expect(storageRecoveryText('recoveryRevision', 'en', 'cleanup')).toBe('Version {version}');
  expect(storageRecoveryText('recoveryRevision', 'fa', 'cleanup')).toBe('نسخهٔ {version}');
  expect(storageRecoveryText('unknown', 'en', 'cleanup')).toBeUndefined();
});
