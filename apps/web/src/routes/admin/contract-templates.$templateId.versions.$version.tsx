import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';
import { ContractTemplateRouteWorkspace } from '../../components/ContractTemplateRouteWorkspace.js';

const Preview = lazyRouteComponent(() => import('../../pages/ContractTemplateVersionPage.js'));

export const Route = createFileRoute('/admin/contract-templates/$templateId/versions/$version')({
  component: TemplateVersionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplateVersionRoute() {
  const { templateId: id, version } = Route.useParams();
  const templateId = adminEditorId(id);
  if (templateId && version === 'new')
    return <ContractTemplateRouteWorkspace view="upload" templateId={templateId} />;
  const versionNumber = Number(version);
  if (!templateId || !/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(versionNumber)) {
    throw notFound();
  }
  return (
    <Preview key={templateId + version} templateId={templateId} versionNumber={versionNumber} />
  );
}
