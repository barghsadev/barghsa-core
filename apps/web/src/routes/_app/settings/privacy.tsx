import { createFileRoute } from '@tanstack/react-router';
import { ProfileLifecyclePanel } from '../../../components/ProfileLifecyclePanel.js';

export const Route = createFileRoute('/_app/settings/privacy')({
  component: ProfileLifecyclePanel,
});
