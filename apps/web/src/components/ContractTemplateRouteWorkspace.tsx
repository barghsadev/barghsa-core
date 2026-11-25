import { lazyRouteComponent, useNavigate } from '@tanstack/react-router';

import {
  contractTemplateRoutes,
  type ContractTemplateView,
} from '../lib/template-catalogue-routes.js';

const Page = lazyRouteComponent(() => import('../pages/AdminContractTemplatesPage.js'));

export function ContractTemplateRouteWorkspace({
  view,
  templateId,
}: {
  view: ContractTemplateView;
  templateId?: string;
}) {
  const navigate = useNavigate();
  const routes = contractTemplateRoutes;
  return (
    <Page
      key={view + (templateId ?? '')}
      view={view}
      {...(templateId ? { templateId } : {})}
      onSettled={(id, version) => {
        if (id && version !== undefined) {
          void navigate({
            to: routes.version,
            params: { templateId: id, version: String(version) },
            replace: true,
          });
        } else if (id) {
          void navigate({ to: routes.detail, params: { templateId: id }, replace: true });
        } else {
          void navigate({ to: routes.list, replace: true });
        }
      }}
    />
  );
}
