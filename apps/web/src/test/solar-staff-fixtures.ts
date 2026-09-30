export const firstSolar = '84000000-0000-4000-8000-000000000001';
export const olderSolar = '84000000-0000-4000-8000-000000000002';
export const solarProfile = '84000000-0000-4000-8000-000000000003';
export function solarRequest(id = firstSolar) {
  return {
    id,
    profile_id: solarProfile,
    profile_name: id === firstSolar ? 'First solar buyer' : 'Older solar buyer',
    status: 'documents_under_review',
    building_type: 'building_apartment',
    document_count: 1,
    created_at: '2026-09-23T10:00:00.000Z',
  };
}
export function solarFile(id = firstSolar) {
  return {
    id,
    request_id: id,
    document_id: id,
    file_name: id === firstSolar ? 'first.pdf' : 'older.pdf',
    uploaded_by: solarProfile,
    uploaded_by_name: 'Solar buyer',
    uploaded_at: '2026-09-23T10:00:00.000Z',
    staff_status: 'pending',
    staff_reason: null,
    state: 'SubmittedForReview',
    revision: 1,
  };
}
export function solarDocuments(id = firstSolar) {
  return { request: solarRequest(id), documents: [solarFile(id)], requestedDocuments: [] };
}
export function solarPostal(id = firstSolar) {
  return {
    ...solarRequest(id),
    request_status: 'waiting_for_postal_submission',
    postal_status: 'shipped',
    courier: 'Post',
    tracking_number: 'TRACK-1',
    send_date: '2026-09-23',
    receipt_image_id: null,
    staff_notes: null,
  };
}
export const solarGuidance = {
  fa: 'راهنمای کارشناسان',
  en: 'Staff guidance',
  suggestions: [],
  originals: [],
  destinationAddress: 'Solar Street',
  contactDetails: 'Staff contact',
};
