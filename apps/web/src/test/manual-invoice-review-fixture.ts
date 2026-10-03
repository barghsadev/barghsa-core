export interface ManualReviewCommand {
  profileId: string;
  idempotencyKey: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    vatRate: number;
    isTaxable: boolean;
  }>;
}
export function manualInvoiceReviewFixture(command: ManualReviewCommand) {
  const lines = command.lines.map((line) => {
    const subtotal = BigInt(line.quantity) * BigInt(line.unitPrice);
    return {
      ...line,
      lineTotal: subtotal.toString(),
      vatAmount: (line.isTaxable
        ? (subtotal * BigInt(line.vatRate) + 5000n) / 10000n
        : 0n
      ).toString(),
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.lineTotal), 0n);
  const vat = lines.reduce((sum, line) => sum + BigInt(line.vatAmount), 0n);
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'invoice.manual-issue',
      profileId: command.profileId,
      resourceId: command.idempotencyKey,
    },
    data: {
      currency: 'IRR',
      profile: { id: command.profileId, title: 'Customer', profileType: 'LEGAL' },
      contractId: null,
      lines,
      totals: {
        subtotal: subtotal.toString(),
        vat: vat.toString(),
        discount: '0',
        total: (subtotal + vat).toString(),
      },
      dueRule: { source: 'config', configDays: 7, periodId: null, serviceType: 'manual' },
      outcome: 'issue_unpaid_invoice',
    },
  };
}
