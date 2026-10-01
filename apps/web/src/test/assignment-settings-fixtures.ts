export const assignmentAgent = {
  id: '01900000-0000-7000-8000-000000000001',
  title: 'Local support',
  enabled: false,
  updatedAt: '2026-10-01T00:00:00Z',
};
export const otherAssignmentAgent = {
  ...assignmentAgent,
  id: '01900000-0000-7000-8000-000000000002',
  title: 'Customer guide',
  enabled: true,
};
const keys = [
  'individual_chatbot',
  'legal_entity_chatbot',
  'staff_chatbot',
  'website_chatbot',
  'telegram_chatbot',
];
export function assignmentSlots() {
  return keys.map((slotKey) => ({
    slotKey,
    label: slotKey,
    agent: slotKey === 'staff_chatbot' ? assignmentAgent : null,
    alsoUsedIn: [] as string[],
    updatedAt: '2026-10-01T00:00:00Z',
  }));
}
