import { createFileRoute } from '@tanstack/react-router';

// The channel layout supplies the form and owns its data across provider routes.
export const Route = createFileRoute('/admin/providers/$channel/new')({});
