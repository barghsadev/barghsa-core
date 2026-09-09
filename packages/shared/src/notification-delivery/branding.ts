import type { DeliveryPool } from './email.js';
import { normalizeEmailBranding, type EmailBranding } from '../notifications/email-branding.js';
export * from '../notifications/email-branding.js';

export async function loadEmailBranding(pool: DeliveryPool): Promise<EmailBranding> {
  const { rows } = await pool.query("SELECT config FROM brand_config WHERE status='active'");
  if (rows.length > 1) throw new Error('Active brand configuration is ambiguous');
  return normalizeEmailBranding(rows[0]?.config, process.env.APP_PUBLIC_URL);
}
