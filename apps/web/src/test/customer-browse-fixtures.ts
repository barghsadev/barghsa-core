export const browseProfileId = '86000000-0000-4000-8000-000000000001';
export const browseProductId = '86000000-0000-4000-8000-000000000002';
export const browseRequestId = '86000000-0000-4000-8000-000000000003';
export const browseProfiles = {
  activeProfileId: browseProfileId,
  profiles: [
    {
      id: browseProfileId,
      profileType: 'INDIVIDUAL',
      firstName: 'Test',
      lastName: 'Buyer',
      status: 'ACTIVE',
    },
  ],
};
export const browseElectricity = ['thermal', 'green', 'free_market', 'energy_saving'].map(
  (systemKey) => ({
    id: systemKey,
    systemKey,
    title: { en: `${systemKey} electricity`, fa: `برق ${systemKey}` },
    description: null,
    status: 'active',
    price: '15000',
    limits: { minKwh: '0', maxKwh: '0' },
    orderable: true,
    simpleOrderable: systemKey === 'thermal',
    simpleOrderBlockReasons: [],
  })
);
export const browseSavingPlan = {
  id: browseProductId,
  title: { en: 'Efficient home', fa: 'خانه کم‌مصرف' },
  description: { en: 'Reduce usage', fa: 'کاهش مصرف' },
  price: '15000',
  status: 'active',
  available: true,
  hardware: [
    {
      id: 'hardware-1',
      title: { en: 'Controller', fa: 'کنترلگر' },
      description: null,
      price: '25000',
      status: 'active',
      stock_tracking: true,
      available_count: 2,
    },
  ],
  agreement: {
    versionId: 'terms-1',
    title: 'Published terms',
    body: 'Accepted text',
    effectiveFrom: '2026-09-23T00:00:00Z',
  },
};
export const browseConsultation = {
  id: browseProductId,
  systemKey: null,
  title: { en: 'Generation consultation', fa: 'مشاوره تولید برق' },
  description: null,
};
export const browseConsultationHistory = {
  requests: [
    {
      id: browseRequestId,
      status: 'submitted',
      product_snapshot: { title: { en: 'Previous consultation', fa: 'مشاوره قبلی' } },
      submitted_at: '2026-09-30T09:00:00Z',
      staff_owner_username: null,
      staff_team: null,
      expected_next_step: null,
      invoice_id: null,
      invoice_state: null,
      accepted_at: null,
      offer_valid_until: null,
      refund_pending: false,
    },
  ],
  nextBefore: null,
};
