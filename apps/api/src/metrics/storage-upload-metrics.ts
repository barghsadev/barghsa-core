import promClient from 'prom-client';

const verifiedUploadBytes = new promClient.Histogram({
  name: 'barghsa_storage_verified_upload_bytes',
  help: 'Bytes of an inspected upload first recorded or accepted into the scan queue',
  buckets: [
    64 * 1024,
    256 * 1024,
    1024 ** 2,
    5 * 1024 ** 2,
    10 * 1024 ** 2,
    25 * 1024 ** 2,
    50 * 1024 ** 2,
    100 * 1024 ** 2,
  ],
});

export function observeVerifiedUpload(bytes: number): void {
  verifiedUploadBytes.observe(bytes);
}
