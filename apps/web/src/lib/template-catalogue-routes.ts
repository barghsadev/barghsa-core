export type NotificationTemplateView =
  'list' | 'compare' | 'new' | 'detail' | 'edit' | 'copy' | 'preview' | 'publish';
export const notificationTemplateActions = {
  edit: 'edit',
  copy: 'new-version',
  preview: 'preview',
  publish: 'publish',
} as const;
export const notificationTemplateRoutes = {
  detail: '/admin/notifications/$templateId',
  action: '/admin/notifications/$templateId/$action',
} as const;

export type DocumentTemplateView = 'list' | 'new' | 'detail' | 'edit' | 'version' | 'publish';
export const documentTemplateRoutes = {
  list: '/admin/document-templates',
  new: '/admin/document-templates/new',
  detail: '/admin/document-templates/$templateId',
  edit: '/admin/document-templates/$templateId/edit',
  version: '/admin/document-templates/$templateId/versions/$version',
} as const;

export type ContractTemplateView = 'list' | 'new' | 'detail' | 'edit' | 'upload';
export const contractTemplateRoutes = {
  list: '/admin/contract-templates',
  new: '/admin/contract-templates/new',
  detail: '/admin/contract-templates/$templateId',
  edit: '/admin/contract-templates/$templateId/edit',
  version: '/admin/contract-templates/$templateId/versions/$version',
} as const;
