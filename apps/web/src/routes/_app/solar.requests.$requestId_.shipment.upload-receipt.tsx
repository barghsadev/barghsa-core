import { createFileRoute } from '@tanstack/react-router';

// The shipment route owns the draft through both pages.
export const Route = createFileRoute('/_app/solar/requests/$requestId_/shipment/upload-receipt')(
  {}
);
