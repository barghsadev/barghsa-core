export const crmProfileId = '11111111-1111-4111-8111-111111111111';
export const crmCaseId = '22222222-2222-4222-8222-222222222222';
export const crmUser = {
  userId: 'customer',
  username: 'customer@example.test',
  registrationDate: '2026-08-01T00:00:00Z',
  lastLogin: null,
  profileCount: 1,
  hasVerifiedProfile: false,
  profiles: [
    {
      id: crmProfileId,
      profileType: 'INDIVIDUAL',
      status: 'PENDING_VERIFICATION',
      title: 'Customer profile',
    },
  ],
};
export const crmCase = {
  id: crmCaseId,
  profileId: crmProfileId,
  fieldName: 'first_name',
  requestedValue: 'Corrected',
  reason: 'Evidence checked',
  status: 'Under Review',
  createdBy: 'creator',
};
export const crmCaseDetail = {
  ...crmCase,
  currentValue: 'Original',
  evidenceUrls: ['verification-evidence/fixed'],
  evidenceDownloadUrls: ['https://storage.example.test/fixed'],
  reviewerNotes: null,
};
export const crmCorrectionProfile = {
  profile: { id: crmProfileId, profileType: 'INDIVIDUAL', archived: false },
  viewerPermissions: { canEditIdentity: true },
};
export const crmQueue = {
  cases: [crmCase],
  total: 1,
  viewer: { userId: 'reviewer', canReview: true, canCreate: true },
};
