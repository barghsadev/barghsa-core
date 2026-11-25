import { createFileRoute } from '@tanstack/react-router';

// The parent keeps the shared editor, preview, and draft state mounted.
export const Route = createFileRoute('/admin/branding/edit')({});
