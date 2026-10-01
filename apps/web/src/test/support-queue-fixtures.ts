export const supportTicket = {
  id: '22222222-2222-4222-8222-222222222222',
  subject: 'Delivery question',
  body: 'Please explain delivery',
  category: 'orders',
  priority: 'normal',
  status: 'in_progress',
  userId: 'customer',
  profileId: null,
  assignedTo: 'staff',
  assignedTeamId: null,
  createdAt: '2026-08-31T12:00:00Z',
  updatedAt: '2026-09-01T01:00:00Z',
  attachments: [],
  relatedEntityType: null,
  relatedEntityId: null,
};
export const supportQueue = {
  data: [supportTicket],
  totalPages: 3,
  responseTargetHours: 24,
  viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
};
export const supportPeople = [
  { id: 'staff', name: 'Support agent' },
  { id: 'other', name: 'Other agent' },
];
export const supportTeams = [{ id: 'team', name: 'Delivery team', members: ['staff', 'other'] }];
export const supportComments = [
  {
    id: 'public',
    authorId: 'staff',
    body: 'Public answer',
    visibility: 'public',
    createdAt: supportTicket.updatedAt,
  },
  {
    id: 'private',
    authorId: 'staff',
    body: 'Private staff reasoning',
    visibility: 'internal',
    createdAt: supportTicket.updatedAt,
  },
];
