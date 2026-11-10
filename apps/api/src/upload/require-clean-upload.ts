import { ConflictException } from '@nestjs/common';

/** Consume only bytes covered by the recorded verdict when scanning is configured. */
export function requireCleanUpload(metadata: unknown, sha256: string): void {
  const scan = metadata as {
    scanJobId?: unknown;
    scanState?: unknown;
    scanSha256?: unknown;
  } | null;
  if (
    !process.env['DOCUMENT_CLAMAV_HOST']?.trim() &&
    !scan?.scanJobId &&
    scan?.scanState !== 'Quarantined'
  )
    return;
  if (
    typeof scan?.scanJobId !== 'string' ||
    scan.scanState !== 'Available' ||
    scan.scanSha256 !== sha256
  )
    throw new ConflictException('A clean scan is required for this file');
}
