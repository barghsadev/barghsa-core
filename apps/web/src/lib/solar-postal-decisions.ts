export const solarPostalDecisions = {
  'confirm-received': {
    title: 'postal_confirm-received',
    help: 'confirmReceiptHelp',
    stage: 'shipment',
  },
  'mark-incomplete': {
    title: 'postal_mark-incomplete',
    help: 'markIncompleteHelp',
    stage: 'shipment',
    reason: 'incompleteReason',
    example: 'shipmentNoteExample',
  },
  'mark-not-received': {
    title: 'postal_mark-not-received',
    help: 'markNotReceivedHelp',
    stage: 'shipment',
    reason: 'notReceivedReason',
    example: 'missingShipmentExample',
  },
  'start-final-review': {
    title: 'solarStartFinalReview',
    help: 'startFinalReviewHelp',
    stage: 'received',
  },
  'final-approve': { title: 'solarFinalApprove', help: 'finalApprovalHelp', stage: 'final' },
  'final-reject': {
    title: 'solarFinalReject',
    help: 'finalRejectionHelp',
    stage: 'final',
    reason: 'finalRejectionReason',
    example: 'finalRejectionExample',
  },
  'close-no-contract': {
    title: 'solarCloseNoContract',
    help: 'closeWithoutContractHelp',
    stage: 'closure',
    reason: 'closureReason',
    example: 'closureExample',
  },
} as const;

export type SolarPostalOperation = keyof typeof solarPostalDecisions;

export function availablePostalDecision(
  operation: SolarPostalOperation,
  row: {
    postal_status: string;
    request_status: string;
  }
) {
  switch (solarPostalDecisions[operation].stage) {
    case 'shipment':
      return row.postal_status === 'shipped';
    case 'received':
      return row.request_status === 'postal_documents_received';
    case 'final':
      return row.request_status === 'final_review';
    case 'closure':
      return ['final_review', 'approved'].includes(row.request_status);
  }
}
