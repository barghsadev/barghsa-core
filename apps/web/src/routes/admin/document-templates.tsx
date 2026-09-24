import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/document-templates')({
  component: lazyRouteComponent(() => import('../../pages/AdminDocumentTemplatesPage.js')),
});
