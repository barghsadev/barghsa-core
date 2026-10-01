export const knowledgeBase = {
  id: '01900000-0000-7000-8000-000000000001',
  title: 'Tariff knowledge',
  description: 'Meter guidance',
  audience: 'admin' as const,
  sourceType: 'url' as const,
  sourceConfig: { urls: ['https://guide.example.test'] },
  chunkingStrategy: { size: 800, overlap: 100 },
  vectorEmbeddingModel: null,
  contentState: 'ready' as const,
  isEnabled: true,
  documentCount: 0,
};
export const knowledgeGroup = {
  id: '01900000-0000-7000-8000-000000000002',
  title: 'Support knowledge',
  description: 'Support collection',
  memberCount: 0,
};
export const knowledgeDetail = { ...knowledgeBase, documents: [] };
export const policyEntry = {
  id: '01900000-0000-7000-8000-000000000003',
  title: 'Energy topics',
  description: 'Energy guidance',
  policyType: 'allowed_topics' as const,
  rules: { topics: ['energy'] },
  enabled: true,
  priority: 100,
};
export const policySecond = {
  ...policyEntry,
  id: '01900000-0000-7000-8000-000000000004',
  title: 'Billing topics',
};
export const policyGroup = {
  id: '01900000-0000-7000-8000-000000000005',
  title: 'Support policies',
  description: 'Policy collection',
  memberCount: 1,
};
