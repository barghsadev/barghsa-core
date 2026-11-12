import { parseBrandConfig, type BrandConfig } from '../providers/BrandThemeProvider.js';
export interface BrandConfigDto {
  id: string;
  config: BrandConfig;
  version: number;
  status: 'draft' | 'active' | 'superseded';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const brandCommandFields: Record<keyof BrandConfig, true> = {
  appTitle: true,
  appTitleFa: true,
  supportEmail: true,
  supportPhone: true,
  supportMobile: true,
  slogan: true,
  primaryColor: true,
  secondaryColor: true,
  accentColor: true,
  darkPrimaryColor: true,
  darkSecondaryColor: true,
  darkAccentColor: true,
  backgroundColor: true,
  darkBackgroundColor: true,
  fontFamily: true,
  borderRadiusRem: true,
  spacingScale: true,
  logoUrl: true,
  logoDarkUrl: true,
  faviconUrl: true,
  darkMode: true,
  themeMode: true,
  themeDefault: true,
  numberStyle: true,
};

export function brandConfigCommand(config: BrandConfig): BrandConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => Object.hasOwn(brandCommandFields, key))
  ) as unknown as BrandConfig;
}

export function parseConfigDto(value: unknown): BrandConfigDto {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid branding response');
  const dto = value as Record<string, unknown>,
    config = parseBrandConfig(dto.config);
  if (
    !config ||
    typeof dto.id !== 'string' ||
    !dto.id.length ||
    typeof dto.version !== 'number' ||
    !Number.isSafeInteger(dto.version) ||
    dto.version < 0 ||
    dto.version > 2147483647 ||
    (dto.status !== 'draft' && dto.status !== 'active' && dto.status !== 'superseded') ||
    typeof dto.createdBy !== 'string' ||
    !dto.createdBy.length ||
    typeof dto.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(dto.createdAt)) ||
    typeof dto.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(dto.updatedAt))
  )
    throw new Error('Invalid branding response');
  return { ...dto, config } as unknown as BrandConfigDto;
}
export function validBrandConfig(value: unknown): value is BrandConfigDto {
  try {
    parseConfigDto(value);
    return true;
  } catch {
    return false;
  }
}
export function validBrandHistory(value: unknown): value is BrandConfigDto[] {
  if (!Array.isArray(value) || !value.every(validBrandConfig)) return false;
  const rows = value as BrandConfigDto[];
  return (
    rows.every((row) => row.version > 0) &&
    new Set(rows.map((row) => row.id)).size === rows.length &&
    new Set(rows.map((row) => row.version)).size === rows.length &&
    ['active', 'draft'].every(
      (status) => rows.filter((row) => row.status === status).length <= 1
    ) &&
    rows.every(
      (row) => row.status !== 'draft' || rows.every((other) => other.version <= row.version)
    )
  );
}
export const brandingBasis = (dto: BrandConfigDto) =>
  JSON.stringify([dto.id, dto.version, dto.status, parseBrandConfig(dto.config)]);
export function coherentBrandHistory(current: BrandConfigDto, history: BrandConfigDto[]) {
  if (current.version === 0) return current.id === 'default' && history.length === 0;
  const latest =
    history.find((row) => row.status === 'draft') ?? history.find((row) => row.status === 'active');
  return !!latest && brandingBasis(latest) === brandingBasis(current);
}
export function acceptBrandRevision(
  history: BrandConfigDto[],
  dto: BrandConfigDto
): BrandConfigDto[] {
  return [
    dto,
    ...history
      .filter((row) => row.id !== dto.id)
      .map((row) => (row.status === dto.status ? { ...row, status: 'superseded' as const } : row)),
  ].sort((a, b) => b.version - a.version);
}
