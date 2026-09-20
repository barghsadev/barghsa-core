/** Optional durable owner around actual provider I/O, after local preflight. */
export type DeliveryExecutor = (
  provider: { id: string; transport: 'smtp' | 'resend' | 'smsir' },
  send: () => Promise<string>
) => Promise<string>;

/** The provider explicitly refused acceptance; retrying cannot duplicate this send. */
export class DeliveryRejected extends Error {}
