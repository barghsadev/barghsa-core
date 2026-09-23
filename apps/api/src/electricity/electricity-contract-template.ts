import { ServiceUnavailableException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { CONTRACT_TEMPLATE_PLACEHOLDER_PATTERN } from '@barghsa/shared/admin';
import { readCappedBytes } from '../storage/read-capped-bytes.js';

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const PLACEHOLDERS = ['date', 'customerName', 'amount'] as const;

export interface ElectricityContractTemplateSnapshot {
  templateId: string;
  versionId: string;
  versionNumber: number;
  name: string;
  text: string;
}

/** Read an immutable template version and embed its rendered text in the contract snapshot. */
export async function electricityContractTemplateSnapshot(
  client: Pick<PoolClient, 'query'>,
  storage: StorageProvider | null,
  profileId: string,
  amountIrR: bigint,
  now: Date
): Promise<ElectricityContractTemplateSnapshot | null> {
  const setting = (
    await client.query<{ value: unknown }>(
      "SELECT value FROM app_config WHERE key='electricity.contract_template_version_id'"
    )
  ).rows[0]?.value;
  if (setting === undefined || setting === null) return null;
  if (typeof setting !== 'string')
    throw new ServiceUnavailableException('Invalid contract template configuration');
  const version = (
    await client.query<{
      id: string;
      template_id: string;
      version_number: number;
      name: string;
      storage_key: string;
      file_size: string | number | null;
      placeholders: string[];
    }>(
      `SELECT v.id,v.template_id,v.version_number,t.name,v.storage_key,v.file_size,v.placeholders
       FROM contract_template_versions v JOIN contract_templates t ON t.id=v.template_id
       WHERE v.id=$1::uuid`,
      [setting]
    )
  ).rows[0];
  if (
    !version ||
    !storage ||
    !version.placeholders.every((name) =>
      PLACEHOLDERS.includes(name as (typeof PLACEHOLDERS)[number])
    )
  ) {
    throw new ServiceUnavailableException('Selected contract template is unavailable');
  }
  if (Number(version.file_size) > MAX_TEMPLATE_BYTES) {
    throw new ServiceUnavailableException('Selected contract template is too large');
  }
  const profile = (
    await client.query<{ customer_name: string }>(
      `SELECT COALESCE(NULLIF(lp.legal_name,''),
               NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),
               NULLIF(p.title,''),p.id::text) AS customer_name
       FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1`,
      [profileId]
    )
  ).rows[0];
  if (!profile) throw new ServiceUnavailableException('Contract customer is unavailable');
  let source: string;
  try {
    const object = await storage.getObject(version.storage_key);
    const { bytes, truncated } = await readCappedBytes(object.body, MAX_TEMPLATE_BYTES);
    if (truncated) throw new Error('Template exceeds size limit');
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ServiceUnavailableException('Selected contract template could not be read');
  }
  const values: Record<(typeof PLACEHOLDERS)[number], string> = {
    date: now.toISOString().slice(0, 10),
    customerName: profile.customer_name,
    amount: amountIrR.toString(),
  };
  const text = source.replace(CONTRACT_TEMPLATE_PLACEHOLDER_PATTERN, (_token, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new ServiceUnavailableException(`Unsupported contract template placeholder: ${name}`);
    }
    return values[name as keyof typeof values];
  });
  return {
    templateId: version.template_id,
    versionId: version.id,
    versionNumber: version.version_number,
    name: version.name,
    text,
  };
}
