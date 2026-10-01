import type { BrandConfigDto } from '../lib/branding-settings.js';
export const brandSettings = {
  appTitle: 'Published brand',
  appTitleFa: 'برند منتشرشده',
  supportEmail: 'support@example.test',
  supportPhone: '+982112345678',
  supportMobile: '+989121234567',
  slogan: 'Clear service',
  primaryColor: '#176b5b',
  secondaryColor: '#547467',
  accentColor: '#d6a74e',
  backgroundColor: '#f6f7f4',
  darkBackgroundColor: '#15201c',
  fontFamily: 'vazirmatn' as const,
  borderRadiusRem: 0.75,
  spacingScale: 1,
  logoUrl: null,
  faviconUrl: null,
  darkMode: false,
  numberStyle: 'locale' as const,
};
export const publishedBrand: BrandConfigDto = {
  id: '01900000-0000-7000-8000-000000000002',
  config: brandSettings,
  version: 2,
  status: 'active',
  createdBy: 'staff-editor',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
export const previousBrand: BrandConfigDto = {
  ...publishedBrand,
  id: '01900000-0000-7000-8000-000000000001',
  config: { ...brandSettings, appTitle: 'Previous brand', appTitleFa: 'برند پیشین' },
  version: 1,
  status: 'superseded',
};
export const draftBrand: BrandConfigDto = {
  ...publishedBrand,
  id: '01900000-0000-7000-8000-000000000003',
  config: { ...brandSettings, appTitle: 'Saved draft' },
  version: 3,
  status: 'draft',
};
